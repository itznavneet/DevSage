"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createConversation = createConversation;
exports.listConversations = listConversations;
exports.getConversation = getConversation;
exports.deleteConversation = deleteConversation;
exports.createMessage = createMessage;
const zod_1 = require("zod");
const db_1 = require("../db");
const conversationSchema = zod_1.z.object({
    title: zod_1.z.string().trim().min(1).max(200).optional(),
});
const messageSchema = zod_1.z.object({
    role: zod_1.z.enum(["USER", "ASSISTANT"]),
    content: zod_1.z.string().trim().min(1).max(50_000),
    sources: zod_1.z.unknown().optional(),
});
function getUserId(res) {
    return res.locals.user?.id;
}
function getParam(value) {
    return typeof value === "string" ? value : "";
}
async function findOwnedConversation(conversationId, userId) {
    return db_1.prisma.conversation.findFirst({
        where: { id: conversationId, userId },
    });
}
async function createConversation(req, res) {
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
        const repository = await db_1.prisma.repository.findFirst({
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
        const conversation = await db_1.prisma.conversation.create({
            data: {
                userId,
                repositoryId: repository.id,
                ...(parsed.data.title ? { title: parsed.data.title } : {}),
            },
        });
        return res.status(201).json({ conversation });
    }
    catch (error) {
        console.error("Create conversation failed:", error);
        return res.status(500).json({ error: "Could not create conversation" });
    }
}
async function listConversations(req, res) {
    const userId = getUserId(res);
    const repositoryId = getParam(req.params.repositoryId);
    if (!userId || !repositoryId) {
        return res.status(400).json({ error: "Invalid repository" });
    }
    try {
        const repository = await db_1.prisma.repository.findFirst({
            where: { id: repositoryId, userId },
            select: { id: true },
        });
        if (!repository) {
            return res.status(404).json({ error: "Repository not found" });
        }
        const conversations = await db_1.prisma.conversation.findMany({
            where: { repositoryId: repository.id, userId },
            orderBy: { updatedAt: "desc" },
        });
        return res.json({ conversations });
    }
    catch (error) {
        console.error("List conversations failed:", error);
        return res.status(500).json({ error: "Could not list conversations" });
    }
}
async function getConversation(req, res) {
    const userId = getUserId(res);
    const conversationId = getParam(req.params.conversationId);
    if (!userId || !conversationId) {
        return res.status(400).json({ error: "Invalid conversation" });
    }
    try {
        const conversation = await db_1.prisma.conversation.findFirst({
            where: { id: conversationId, userId },
            include: {
                messages: { orderBy: { createdAt: "asc" } },
            },
        });
        if (!conversation) {
            return res.status(404).json({ error: "Conversation not found" });
        }
        return res.json({ conversation });
    }
    catch (error) {
        console.error("Get conversation failed:", error);
        return res.status(500).json({ error: "Could not fetch conversation" });
    }
}
async function deleteConversation(req, res) {
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
        await db_1.prisma.conversation.delete({ where: { id: conversation.id } });
        return res.json({ message: "Conversation deleted" });
    }
    catch (error) {
        console.error("Delete conversation failed:", error);
        return res.status(500).json({ error: "Could not delete conversation" });
    }
}
async function createMessage(req, res) {
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
        const message = await db_1.prisma.$transaction(async (transaction) => {
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
    }
    catch (error) {
        console.error("Create message failed:", error);
        return res.status(500).json({ error: "Could not save message" });
    }
}
//# sourceMappingURL=conversation.controller.js.map