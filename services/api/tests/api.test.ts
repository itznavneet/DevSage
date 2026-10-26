import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import argon2 from "argon2";
import { prisma } from "../src/db";
import { login, register } from "../src/controllers/auth.controller";
import { reindexRepository } from "../src/controllers/repository.controller";
import {
  createConversation,
  createMessage,
  getConversation,
} from "../src/controllers/conversation.controller";
import { askRepository } from "../src/controllers/ai.controller";
import { requireAuth } from "../src/middleware/require-auth";
import { ingestionQueue } from "../src/queues/ingestion.queue";
import { stageAndActivate } from "../src/workers/versioned-ingestion";

function response() {
  const result: {
    statusCode: number;
    body: unknown;
    cookies: Record<string, unknown>;
    status: (code: number) => typeof result;
    json: (value: unknown) => typeof result;
    cookie: (name: string, value: string, options: unknown) => typeof result;
    clearCookie: () => typeof result;
  } = {
    statusCode: 200,
    body: undefined,
    cookies: {},
    status(code) {
      result.statusCode = code;
      return result;
    },
    json(value) {
      result.body = value;
      return result;
    },
    cookie(name, value, options) {
      result.cookies[name] = { value, options };
      return result;
    },
    clearCookie() {
      return result;
    },
  };
  return result;
}

function replaceMethod(target: object, name: string, implementation: (...args: any[]) => any) {
  const object = target as Record<string, unknown>;
  const original = object[name];
  object[name] = implementation;
  return () => {
    object[name] = original;
  };
}

test("registration and login create sessions and reject bad credentials", async () => {
  const user = { id: "user-1", name: "Ada", email: "ada@example.com" };
  const passwordHash = await argon2.hash("correct horse battery staple");
  let userExists = false;
  const restoreFind = replaceMethod(prisma.user, "findUnique", async ({ where }: any) => {
    return userExists && where.email === user.email ? { ...user, passwordHash } : null;
  });
  const restoreCreateUser = replaceMethod(prisma.user, "create", async () => {
    userExists = true;
    return user;
  });
  const restoreCreateSession = replaceMethod(prisma.session, "create", async () => ({}));

  try {
    const registrationResponse = response();
    await register(
      { body: { name: "Ada", email: "ADA@example.com", password: "correct horse battery staple" } } as any,
      registrationResponse as any,
    );
    assert.equal(registrationResponse.statusCode, 201);
    assert.ok(registrationResponse.cookies.devsage_session);

    const loginResponse = response();
    await login(
      { body: { email: user.email, password: "wrong password" } } as any,
      loginResponse as any,
    );
    assert.equal(loginResponse.statusCode, 401);
  } finally {
    restoreFind();
    restoreCreateUser();
    restoreCreateSession();
  }
});

test("requireAuth rejects malformed tokens and accepts an active session", async () => {
  const invalidResponse = response();
  await requireAuth(
    { cookies: { devsage_session: "not-a-token" } } as any,
    invalidResponse as any,
    () => assert.fail("invalid token should not call next"),
  );
  assert.equal(invalidResponse.statusCode, 401);

  const token = "a".repeat(64);
  const restoreSession = replaceMethod(prisma.session, "findUnique", async () => ({
    id: "session-1",
    expiresAt: new Date(Date.now() + 60_000),
    user: { id: "user-1", name: "Ada", email: "ada@example.com" },
  }));
  try {
    const acceptedResponse = response();
    let called = false;
    await requireAuth(
      { cookies: { devsage_session: token } } as any,
      acceptedResponse as any,
      () => { called = true; },
    );
    assert.equal(called, true);
    assert.equal(createHash("sha256").update(token).digest("hex").length, 64);
  } finally {
    restoreSession();
  }
});

test("repository reindex is ownership-scoped", async () => {
  const restoreFind = replaceMethod(prisma.repository, "findFirst", async () => null);
  const restoreAdd = replaceMethod(ingestionQueue, "add", async () => {
    throw new Error("queue must not be called for another user's repository");
  });
  try {
    const result = response();
    await reindexRepository(
      { params: { repositoryId: "repo-owned-by-someone-else" } } as any,
      { ...result, locals: { user: { id: "user-1" } } } as any,
    );
    assert.equal(result.statusCode, 404);
  } finally {
    restoreFind();
    restoreAdd();
    await ingestionQueue.close();
  }
});

test("conversation endpoints enforce ownership", async () => {
  const restoreRepositoryFind = replaceMethod(prisma.repository, "findFirst", async () => null);
  const restoreConversationFind = replaceMethod(prisma.conversation, "findFirst", async () => null);

  try {
    const createResult = response();
    await createConversation(
      { params: { repositoryId: "repo-owned-by-someone-else" }, body: {} } as any,
      { ...createResult, locals: { user: { id: "user-1" } } } as any,
    );
    assert.equal(createResult.statusCode, 404);

    const getResult = response();
    await getConversation(
      { params: { conversationId: "conversation-owned-by-someone-else" } } as any,
      { ...getResult, locals: { user: { id: "user-1" } } } as any,
    );
    assert.equal(getResult.statusCode, 404);

    const messageResult = response();
    await createMessage(
      {
        params: { conversationId: "conversation-owned-by-someone-else" },
        body: { role: "USER", content: "secret question" },
      } as any,
      { ...messageResult, locals: { user: { id: "user-1" } } } as any,
    );
    assert.equal(messageResult.statusCode, 404);
  } finally {
    restoreRepositoryFind();
    restoreConversationFind();
  }
});

test("ask isolates conversations and sends bounded chronological history", async () => {
  const repository = {
    id: "repo-1",
    name: "TodoApp",
    status: "READY",
    activeIndexVersion: "version-2",
  };
  const recentMessages = [
    { role: "ASSISTANT", content: "The token is verified in jwt.ts." },
    { role: "USER", content: "Where is JWT handling?" },
  ];
  let conversationQuery: any;
  let transactionRoles: string[] = [];
  let aiRequest: any;
  const restoreRepositoryFind = replaceMethod(prisma.repository, "findFirst", async () => repository);
  const restoreConversationFind = replaceMethod(prisma.conversation, "findFirst", async (args: any) => {
    conversationQuery = args;
    return { id: "conversation-1", messages: recentMessages };
  });
  const restoreTransaction = replaceMethod(prisma, "$transaction", async (callback: any) => callback({
    message: {
      create: async ({ data }: any) => {
        transactionRoles.push(data.role);
        return { id: `${data.role.toLowerCase()}-1`, ...data };
      },
    },
    conversation: { update: async () => undefined },
  }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    aiRequest = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ answer: "Grounded answer", sources: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const result = response();
    await askRepository(
      {
        params: { repositoryId: "repo-1" },
        body: { conversationId: "conversation-1", question: "Where is it called?" },
      } as any,
      { ...result, locals: { user: { id: "user-1" } } } as any,
    );

    assert.equal(result.statusCode, 200);
    assert.deepEqual(transactionRoles, ["USER", "ASSISTANT"]);
    assert.deepEqual(aiRequest.conversation_history, [recentMessages[1], recentMessages[0]]);
    assert.equal(conversationQuery.where.userId, "user-1");
    assert.equal(conversationQuery.where.repositoryId, "repo-1");
    assert.equal(conversationQuery.include.messages.take, 12);
    assert.deepEqual(conversationQuery.include.messages.orderBy, { createdAt: "desc" });
  } finally {
    globalThis.fetch = originalFetch;
    restoreRepositoryFind();
    restoreConversationFind();
    restoreTransaction();
  }
});

test("ask rejects a foreign conversation before calling AI", async () => {
  const restoreRepositoryFind = replaceMethod(prisma.repository, "findFirst", async () => ({
    id: "repo-1",
    name: "TodoApp",
    status: "READY",
    activeIndexVersion: "version-2",
  }));
  const restoreConversationFind = replaceMethod(prisma.conversation, "findFirst", async () => null);
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response("unexpected", { status: 500 });
  };

  try {
    const result = response();
    await askRepository(
      {
        params: { repositoryId: "repo-1" },
        body: { conversationId: "foreign-conversation", question: "Follow up" },
      } as any,
      { ...result, locals: { user: { id: "user-1" } } } as any,
    );

    assert.equal(result.statusCode, 404);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreRepositoryFind();
    restoreConversationFind();
  }
});

test("staging activates only after every batch succeeds", async () => {
  const sent: string[][] = [];
  let activated = false;
  let activeIndexVersion = "version-1";
  const total = await stageAndActivate<string>(
    async (consume) => {
      await consume(["one"]);
      await consume(["two", "three"]);
    },
    async (batch) => {
      sent.push(batch);
      return batch.length;
    },
    async () => {
      activated = true;
      activeIndexVersion = "version-2";
    },
  );

  assert.equal(total, 3);
  assert.equal(activated, true);
  assert.equal(activeIndexVersion, "version-2");
  assert.deepEqual(sent, [["one"], ["two", "three"]]);

  activated = false;
  await assert.rejects(
    stageAndActivate<string>(
      async (consume) => {
        await consume(["valid"]);
        await consume(["failing"]);
      },
      async (batch) => batch[0] === "failing" ? 0 : batch.length,
      async () => { activated = true; },
    ),
    /indexed 0 of 1/,
  );
  assert.equal(activated, false);
});
