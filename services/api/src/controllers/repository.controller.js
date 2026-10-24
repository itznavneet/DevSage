"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRepository = createRepository;
exports.reindexRepository = reindexRepository;
exports.listRepositories = listRepositories;
const zod_1 = require("zod");
const db_1 = require("../db");
const ingestion_queue_1 = require("../queues/ingestion.queue");
const node_crypto_1 = require("node:crypto");
const createRepositorySchema = zod_1.z.object({
    url: zod_1.z.string().trim().url(),
});
function parseGitHubUrl(value) {
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== "https:" ||
            parsed.hostname !== "github.com" ||
            parsed.port ||
            parsed.username ||
            parsed.password ||
            parsed.search ||
            parsed.hash) {
            return null;
        }
        const parts = parsed.pathname.split("/").filter(Boolean);
        if (parts.length !== 2)
            return null;
        const owner = parts[0];
        const repo = parts[1];
        if (!owner || !repo)
            return null;
        if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(owner) ||
            !/^[a-zA-Z0-9._-]+$/.test(repo) ||
            repo === "." ||
            repo === "..") {
            return null;
        }
        const githubName = repo.replace(/\.git$/i, "");
        if (!githubName)
            return null;
        return {
            owner,
            name: githubName,
            url: `https://github.com/${owner}/${githubName}`,
        };
    }
    catch {
        return null;
    }
}
async function createRepository(req, res) {
    const parsed = createRepositorySchema.safeParse(req.body);
    if (!parsed.success) {
        return res
            .status(400)
            .json({ message: "Please provide a valid GitHub URL" });
    }
    const github = parseGitHubUrl(parsed.data.url);
    if (!github) {
        return res.status(400).json({
            message: "URL must point to a public GitHub repository, e.g. https://github.com/owner/repo",
        });
    }
    const userId = res.locals.user.id;
    try {
        const repository = await db_1.prisma.repository.create({
            data: {
                name: github.name,
                url: github.url,
                githubOwner: github.owner,
                githubName: github.name,
                userId,
            },
        });
        await ingestion_queue_1.ingestionQueue.add("ingest-repository", {
            repositoryId: repository.id,
            userId,
            url: repository.url,
            indexVersion: (0, node_crypto_1.randomUUID)(),
        }, {
            jobId: `${repository.id}-initial`,
            attempts: 3,
            backoff: {
                type: "exponential",
                delay: 2000,
            },
            removeOnComplete: 100,
            removeOnFail: 500,
        });
        return res.status(201).json({ repository });
    }
    catch (error) {
        // Prisma unique constraint violation: repository already added by this user.
        if (typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "P2002") {
            return res.status(409).json({
                message: "You have already added this repository",
            });
        }
        console.error("Create repository failed:", error);
        return res.status(500).json({ message: "Could not add repository" });
    }
}
async function reindexRepository(req, res) {
    const userId = res.locals.user?.id;
    const repositoryId = typeof req.params.repositoryId === "string" ? req.params.repositoryId : "";
    if (!userId || !repositoryId) {
        return res.status(400).json({ message: "Invalid repository" });
    }
    try {
        const repository = await db_1.prisma.repository.findFirst({
            where: { id: repositoryId, userId },
            select: { id: true, url: true, status: true },
        });
        if (!repository) {
            return res.status(404).json({ message: "Repository not found" });
        }
        if (repository.status === "CLONING" || repository.status === "INDEXING") {
            return res.status(409).json({ message: "Repository indexing is already in progress" });
        }
        const indexVersion = (0, node_crypto_1.randomUUID)();
        await ingestion_queue_1.ingestionQueue.add("reindex-repository", { repositoryId, userId, url: repository.url, indexVersion }, {
            jobId: `${repository.id}-${indexVersion}`,
            attempts: 3,
            backoff: { type: "exponential", delay: 2000 },
            removeOnComplete: 100,
            removeOnFail: 500,
        });
        await db_1.prisma.repository.update({
            where: { id: repository.id },
            data: { status: "INDEXING", errorMessage: null },
        });
        return res.status(202).json({ repositoryId, indexVersion, status: "INDEXING" });
    }
    catch (error) {
        console.error("Reindex repository failed:", error);
        return res.status(500).json({ message: "Could not start repository re-indexing" });
    }
}
async function listRepositories(_req, res) {
    try {
        const repositories = await db_1.prisma.repository.findMany({
            where: { userId: res.locals.user.id },
            orderBy: { createdAt: "desc" },
        });
        return res.json({ repositories });
    }
    catch (error) {
        console.error("List repositories failed:", error);
        return res.status(500).json({ message: "Could not fetch repositories" });
    }
}
//# sourceMappingURL=repository.controller.js.map