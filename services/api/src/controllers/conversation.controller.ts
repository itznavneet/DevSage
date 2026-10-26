import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../db";

const conversationSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
});

const renameConversationSchema = z.object({
  title: z.string().trim().min(1).max(200),
});

const messageSchema = z.object({
  role: z.enum(["USER", "ASSISTANT"]),
  content: z.string().trim().min(1).max(50_000),
  sources: z.unknown().optional(),
});

function getUserId(res: Response) {
  return res.locals.user?.id as string | undefined;
}

function getParam(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

async function findOwnedConversation(conversationId: string, userId: string) {
  return prisma.conversation.findFirst({
    where: { id: conversationId, userId },
  });
}

export async function createConversation(req: Request, res: Response) {
  const userId = getUserId(res);
  const repositoryId = getParam(req.params.repositoryId);

  if (!userId || !repositoryId) {
    return res.status(400).json({ error: "Invalid repository" });
  }

  const parsed = conversationSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid conversation input" });
  }

  try {
    const repository = await prisma.repository.findFirst({
      where: { id: repositoryId, userId },
      select: { id: true, status: true, activeIndexVersion: true },
    });

    if (!repository) {
      return res.status(404).json({ error: "Repository not found" });
    }

    if (repository.status !== "READY" || !repository.activeIndexVersion) {
      return res.status(409).json({
        error: "Repository indexing is not complete",
        status: repository.status,
      });
    }

    const conversation = await prisma.conversation.create({
      data: {
        userId,
        repositoryId: repository.id,
        ...(parsed.data.title ? { title: parsed.data.title } : {}),
      },
    });

    return res.status(201).json({ conversation });
  } catch (error) {
    console.error("Create conversation failed:", error);
    return res.status(500).json({ error: "Could not create conversation" });
  }
}

export async function listConversations(req: Request, res: Response) {
  const userId = getUserId(res);
  const repositoryId = getParam(req.params.repositoryId);

  if (!userId || !repositoryId) {
    return res.status(400).json({ error: "Invalid repository" });
  }

  try {
    const repository = await prisma.repository.findFirst({
      where: { id: repositoryId, userId },
      select: { id: true },
    });

    if (!repository) {
      return res.status(404).json({ error: "Repository not found" });
    }

    const conversations = await prisma.conversation.findMany({
      where: { repositoryId: repository.id, userId },
      orderBy: { updatedAt: "desc" },
    });

    return res.json({ conversations });
  } catch (error) {
    console.error("List conversations failed:", error);
    return res.status(500).json({ error: "Could not list conversations" });
  }
}

export async function getConversation(req: Request, res: Response) {
  const userId = getUserId(res);
  const conversationId = getParam(req.params.conversationId);

  if (!userId || !conversationId) {
    return res.status(400).json({ error: "Invalid conversation" });
  }

  try {
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userId },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
      },
    });

    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    return res.json({ conversation });
  } catch (error) {
    console.error("Get conversation failed:", error);
    return res.status(500).json({ error: "Could not fetch conversation" });
  }
}

export async function updateConversation(req: Request, res: Response) {
  const userId = getUserId(res);
  const conversationId = getParam(req.params.conversationId);

  if (!userId || !conversationId) {
    return res.status(400).json({ error: "Invalid conversation" });
  }

  const parsed = renameConversationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Conversation title is required" });
  }

  try {
    const conversation = await findOwnedConversation(conversationId, userId);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const updatedConversation = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { title: parsed.data.title },
    });

    return res.json({ conversation: updatedConversation });
  } catch (error) {
    console.error("Rename conversation failed:", error);
    return res.status(500).json({ error: "Could not rename conversation" });
  }
}

export async function deleteConversation(req: Request, res: Response) {
  const userId = getUserId(res);
  const conversationId = getParam(req.params.conversationId);

  if (!userId || !conversationId) {
    return res.status(400).json({ error: "Invalid conversation" });
  }

  try {
    const conversation = await findOwnedConversation(conversationId, userId);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    await prisma.conversation.delete({ where: { id: conversation.id } });
    return res.json({ message: "Conversation deleted" });
  } catch (error) {
    console.error("Delete conversation failed:", error);
    return res.status(500).json({ error: "Could not delete conversation" });
  }
}

export async function createMessage(req: Request, res: Response) {
  const userId = getUserId(res);
  const conversationId = getParam(req.params.conversationId);

  if (!userId || !conversationId) {
    return res.status(400).json({ error: "Invalid conversation" });
  }

  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid message input" });
  }

  try {
    const conversation = await findOwnedConversation(conversationId, userId);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const message = await prisma.$transaction(async (transaction) => {
      const createdMessage = await transaction.message.create({
        data: {
          conversationId: conversation.id,
          role: parsed.data.role,
          content: parsed.data.content,
          sources: parsed.data.sources === undefined
            ? undefined
            : JSON.parse(JSON.stringify(parsed.data.sources)),
        },
      });

      await transaction.conversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date() },
      });

      return createdMessage;
    });

    return res.status(201).json({ message });
  } catch (error) {
    console.error("Create message failed:", error);
    return res.status(500).json({ error: "Could not save message" });
  }
}
