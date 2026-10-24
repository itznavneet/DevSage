"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_crypto_1 = require("node:crypto");
const node_test_1 = __importDefault(require("node:test"));
const argon2_1 = __importDefault(require("argon2"));
const db_1 = require("../src/db");
const auth_controller_1 = require("../src/controllers/auth.controller");
const repository_controller_1 = require("../src/controllers/repository.controller");
const require_auth_1 = require("../src/middleware/require-auth");
const ingestion_queue_1 = require("../src/queues/ingestion.queue");
const versioned_ingestion_1 = require("../src/workers/versioned-ingestion");
function response() {
    const result = {
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
function replaceMethod(target, name, implementation) {
    const object = target;
    const original = object[name];
    object[name] = implementation;
    return () => {
        object[name] = original;
    };
}
(0, node_test_1.default)("registration and login create sessions and reject bad credentials", async () => {
    const user = { id: "user-1", name: "Ada", email: "ada@example.com" };
    const passwordHash = await argon2_1.default.hash("correct horse battery staple");
    let userExists = false;
    const restoreFind = replaceMethod(db_1.prisma.user, "findUnique", async ({ where }) => {
        return userExists && where.email === user.email ? { ...user, passwordHash } : null;
    });
    const restoreCreateUser = replaceMethod(db_1.prisma.user, "create", async () => {
        userExists = true;
        return user;
    });
    const restoreCreateSession = replaceMethod(db_1.prisma.session, "create", async () => ({}));
    try {
        const registrationResponse = response();
        await (0, auth_controller_1.register)({ body: { name: "Ada", email: "ADA@example.com", password: "correct horse battery staple" } }, registrationResponse);
        strict_1.default.equal(registrationResponse.statusCode, 201);
        strict_1.default.ok(registrationResponse.cookies.devsage_session);
        const loginResponse = response();
        await (0, auth_controller_1.login)({ body: { email: user.email, password: "wrong password" } }, loginResponse);
        strict_1.default.equal(loginResponse.statusCode, 401);
    }
    finally {
        restoreFind();
        restoreCreateUser();
        restoreCreateSession();
    }
});
(0, node_test_1.default)("requireAuth rejects malformed tokens and accepts an active session", async () => {
    const invalidResponse = response();
    await (0, require_auth_1.requireAuth)({ cookies: { devsage_session: "not-a-token" } }, invalidResponse, () => strict_1.default.fail("invalid token should not call next"));
    strict_1.default.equal(invalidResponse.statusCode, 401);
    const token = "a".repeat(64);
    const restoreSession = replaceMethod(db_1.prisma.session, "findUnique", async () => ({
        id: "session-1",
        expiresAt: new Date(Date.now() + 60_000),
        user: { id: "user-1", name: "Ada", email: "ada@example.com" },
    }));
    try {
        const acceptedResponse = response();
        let called = false;
        await (0, require_auth_1.requireAuth)({ cookies: { devsage_session: token } }, acceptedResponse, () => { called = true; });
        strict_1.default.equal(called, true);
        strict_1.default.equal((0, node_crypto_1.createHash)("sha256").update(token).digest("hex").length, 64);
    }
    finally {
        restoreSession();
    }
});
(0, node_test_1.default)("repository reindex is ownership-scoped", async () => {
    const restoreFind = replaceMethod(db_1.prisma.repository, "findFirst", async () => null);
    const restoreAdd = replaceMethod(ingestion_queue_1.ingestionQueue, "add", async () => {
        throw new Error("queue must not be called for another user's repository");
    });
    try {
        const result = response();
        await (0, repository_controller_1.reindexRepository)({ params: { repositoryId: "repo-owned-by-someone-else" } }, { ...result, locals: { user: { id: "user-1" } } });
        strict_1.default.equal(result.statusCode, 404);
    }
    finally {
        restoreFind();
        restoreAdd();
        await ingestion_queue_1.ingestionQueue.close();
    }
});
(0, node_test_1.default)("staging activates only after every batch succeeds", async () => {
    const sent = [];
    let activated = false;
    let activeIndexVersion = "version-1";
    const total = await (0, versioned_ingestion_1.stageAndActivate)(async (consume) => {
        await consume(["one"]);
        await consume(["two", "three"]);
    }, async (batch) => {
        sent.push(batch);
        return batch.length;
    }, async () => {
        activated = true;
        activeIndexVersion = "version-2";
    });
    strict_1.default.equal(total, 3);
    strict_1.default.equal(activated, true);
    strict_1.default.equal(activeIndexVersion, "version-2");
    strict_1.default.deepEqual(sent, [["one"], ["two", "three"]]);
    activated = false;
    await strict_1.default.rejects((0, versioned_ingestion_1.stageAndActivate)(async (consume) => {
        await consume(["valid"]);
        await consume(["failing"]);
    }, async (batch) => batch[0] === "failing" ? 0 : batch.length, async () => { activated = true; }), /indexed 0 of 1/);
    strict_1.default.equal(activated, false);
});
//# sourceMappingURL=api.test.js.map