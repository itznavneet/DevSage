"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
const node_crypto_1 = require("node:crypto");
const db_1 = require("../db");
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const promises_1 = require("node:fs/promises");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const versioned_ingestion_1 = require("./versioned-ingestion");
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
const connection = new ioredis_1.default(process.env.REDIS_URL || "redis://localhost:6379", { maxRetriesPerRequest: null });
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://localhost:8000";
// GitHub repositories can contain very deeply nested fixture paths. Git's
// long-path option is enabled below so checkout does not fail on Windows.
const INGESTION_TEMP_ROOT = process.env.DEVSAGE_TEMP_DIR || (0, node_os_1.tmpdir)();
const IGNORED_DIRS = new Set([
    ".git",
    "node_modules",
    "dist",
    "build",
    ".next",
    "coverage",
    ".venv",
    "venv",
    "env",
    "__pycache__",
    ".idea",
    ".vscode",
    "vendor",
    "target",
    "out",
    "tmp",
    "temp",
]);
const SOURCE_EXTENSIONS = new Set([
    ".ts", ".tsx", ".js", ".jsx",
    ".py", ".java", ".c", ".cpp", ".h", ".hpp",
    ".go", ".rs", ".php", ".rb",
    ".html", ".css", ".scss",
    ".json", ".md", ".mdx",
    ".yml", ".yaml", ".sql", ".prisma",
    ".sh",
]);
const IGNORED_FILES = new Set([
    ".env",
    ".env.local",
    ".env.development",
    ".env.production",
    ".env.test",
    ".env.staging",
    ".npmrc",
    ".pypirc",
    ".netrc",
    "id_rsa",
    "id_ed25519",
    "credentials",
    "credentials.json",
    "secrets.json",
    "service-account.json",
    "private.key",
]);
const SECRET_EXTENSIONS = new Set([
    ".pem",
    ".key",
    ".p12",
    ".pfx",
    ".keystore",
    ".jks",
    ".crt",
]);
const MAX_FILES = 5000;
const MAX_FILE_SIZE = 1024 * 1024;
const CHUNK_LINES = 80;
const CHUNK_OVERLAP = 10;
const MAX_CHUNK_CHARS = 8000;
const BATCH_SIZE = 128;
async function collectSourceFiles(root) {
    const files = [];
    async function walk(directory) {
        if (files.length >= MAX_FILES)
            return;
        const entries = await (0, promises_1.readdir)(directory, { withFileTypes: true });
        for (const entry of entries) {
            if (files.length >= MAX_FILES)
                break;
            if (entry.isDirectory()) {
                if (!IGNORED_DIRS.has(entry.name.toLowerCase())) {
                    await walk((0, node_path_1.join)(directory, entry.name));
                }
                continue;
            }
            // Ignore symlinks and anything that isn't a regular file.
            if (!entry.isFile())
                continue;
            const absolutePath = (0, node_path_1.join)(directory, entry.name);
            const fileName = (0, node_path_1.basename)(absolutePath).toLowerCase();
            const extension = (0, node_path_1.extname)(entry.name).toLowerCase();
            // Avoid indexing credentials and likely secret files.
            if (IGNORED_FILES.has(fileName) ||
                fileName.startsWith(".env.") ||
                fileName.endsWith(".secret") ||
                fileName.endsWith(".secrets") ||
                fileName.endsWith(".pem") ||
                fileName.endsWith(".key") ||
                fileName.endsWith(".token") ||
                SECRET_EXTENSIONS.has(extension)) {
                continue;
            }
            const isDockerfile = fileName === "dockerfile";
            if (!SOURCE_EXTENSIONS.has(extension) && !isDockerfile) {
                continue;
            }
            const info = await (0, promises_1.stat)(absolutePath);
            if (info.size === 0 || info.size > MAX_FILE_SIZE) {
                continue;
            }
            files.push({
                absolutePath,
                relativePath: (0, node_path_1.relative)(root, absolutePath).replace(/\\/g, "/"),
            });
        }
    }
    await walk(root);
    return files;
}
function stablePointId(indexVersion, chunkId) {
    const bytes = (0, node_crypto_1.createHash)("sha1")
        .update(`${indexVersion}:${chunkId}`)
        .digest();
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
function splitIntoChunks(repositoryId, indexVersion, filePath, source) {
    const lines = source.split(/\r?\n/);
    const chunks = [];
    let start = 0;
    while (start < lines.length) {
        let end = Math.min(start + CHUNK_LINES, lines.length);
        let content = lines.slice(start, end).join("\n");
        // Keep each request safely below the AI endpoint's content limit.
        // If needed, split a large line-based chunk by character count.
        if (content.length > MAX_CHUNK_CHARS) {
            end = start;
            content = "";
            while (end < lines.length) {
                const nextLine = lines[end];
                if (nextLine === undefined)
                    break;
                const separator = content.length > 0 ? "\n" : "";
                if (content.length > 0 &&
                    content.length + separator.length + nextLine.length >
                        MAX_CHUNK_CHARS) {
                    break;
                }
                // Avoid an infinite loop if a single line is unusually long.
                if (nextLine.length > MAX_CHUNK_CHARS && content.length === 0) {
                    content = nextLine.slice(0, MAX_CHUNK_CHARS);
                    end++;
                    break;
                }
                content += separator + nextLine;
                end++;
            }
        }
        if (content.trim()) {
            chunks.push({
                id: stablePointId(indexVersion, `${filePath}:${start + 1}:${end}`),
                repository_id: repositoryId,
                index_version: indexVersion,
                file_path: filePath,
                start_line: start + 1,
                end_line: end,
                content,
            });
        }
        if (end >= lines.length)
            break;
        // Advance while retaining some context from the previous chunk.
        start = Math.max(start + 1, end - CHUNK_OVERLAP);
    }
    return chunks;
}
async function deleteIndexVersion(repositoryId, indexVersion) {
    const response = await fetch(`${AI_SERVICE_URL}/repositories/${encodeURIComponent(repositoryId)}/indexes/${encodeURIComponent(indexVersion)}`, { method: "DELETE", signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
        throw new Error(`Could not clear index version (${response.status}): ` +
            (await response.text()).slice(0, 500));
    }
}
async function sendBatch(chunks) {
    const response = await fetch(`${AI_SERVICE_URL}/index`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chunks }),
        signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
        throw new Error(`AI indexing failed (${response.status}): ` +
            (await response.text()).slice(0, 1000));
    }
    const result = (await response.json());
    if (result.indexed_chunks !== chunks.length) {
        throw new Error(`AI service indexed ${result.indexed_chunks ?? 0} of ` +
            `${chunks.length} chunks`);
    }
    return result.indexed_chunks;
}
const worker = new bullmq_1.Worker("repository-ingestion", async (job) => {
    const { repositoryId, userId, url } = job.data;
    // Older queued jobs may not have a version. Give them a deterministic,
    // isolated staging version instead of falling back to the active vectors.
    const indexVersion = job.data.indexVersion || (0, node_crypto_1.createHash)("sha256")
        .update(`${job.id ?? "job"}:${repositoryId}`)
        .digest("hex")
        .slice(0, 32);
    let temporaryDirectory;
    let previousActiveIndexVersion = null;
    try {
        const repository = await db_1.prisma.repository.findFirst({
            where: { id: repositoryId, userId },
        });
        if (!repository) {
            throw new Error("Repository not found");
        }
        const parsedUrl = new URL(url);
        if (parsedUrl.protocol !== "https:" ||
            parsedUrl.hostname !== "github.com" ||
            parsedUrl.port ||
            parsedUrl.username ||
            parsedUrl.password ||
            parsedUrl.search ||
            parsedUrl.hash) {
            throw new Error("Only public GitHub repositories are supported");
        }
        const parts = parsedUrl.pathname.split("/").filter(Boolean);
        const owner = parts[0];
        const repo = parts[1];
        if (parts.length !== 2 ||
            !owner ||
            !repo ||
            !/^[a-zA-Z0-9-]+$/.test(owner) ||
            !/^[a-zA-Z0-9._-]+$/.test(repo)) {
            throw new Error("Invalid GitHub repository URL");
        }
        const safeUrl = `https://github.com/${owner}/` +
            `${repo.replace(/\.git$/i, "")}.git`;
        previousActiveIndexVersion = repository.activeIndexVersion;
        await db_1.prisma.repository.update({
            where: { id: repositoryId },
            data: { status: "CLONING", errorMessage: null },
        });
        temporaryDirectory = await (0, promises_1.mkdtemp)((0, node_path_1.join)(INGESTION_TEMP_ROOT, "repo-"));
        const cloneDirectory = (0, node_path_1.join)(temporaryDirectory, "source");
        await execFileAsync("git", [
            "-c", "core.longpaths=true",
            "clone",
            "--depth", "1",
            "--single-branch",
            "--no-tags",
            "--",
            safeUrl,
            cloneDirectory,
        ], {
            timeout: 120_000,
            maxBuffer: 5 * 1024 * 1024,
            windowsHide: true,
        });
        await db_1.prisma.repository.update({
            where: { id: repositoryId },
            data: { status: "INDEXING" },
        });
        const files = await collectSourceFiles(cloneDirectory);
        if (files.length === 0) {
            throw new Error("No supported source files found");
        }
        // A retry may have left partial points for this staged version. Removing
        // only this version is safe and never touches the active index.
        await deleteIndexVersion(repositoryId, indexVersion);
        const totalChunks = await (0, versioned_ingestion_1.stageAndActivate)(async (consumeBatch) => {
            for (const file of files) {
                const source = await (0, promises_1.readFile)(file.absolutePath, "utf8");
                const chunks = splitIntoChunks(repositoryId, indexVersion, file.relativePath, source);
                for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
                    await consumeBatch(chunks.slice(i, i + BATCH_SIZE));
                }
            }
        }, sendBatch, async () => {
            await db_1.prisma.repository.update({
                where: { id: repositoryId },
                data: {
                    status: "READY",
                    errorMessage: null,
                    lastIndexedAt: new Date(),
                    activeIndexVersion: indexVersion,
                },
            });
        });
        // Activation happened first. If cleanup fails, the new active index is
        // still valid, so leave the repository READY and report the cleanup.
        if (previousActiveIndexVersion && previousActiveIndexVersion !== indexVersion) {
            try {
                await deleteIndexVersion(repositoryId, previousActiveIndexVersion);
            }
            catch (cleanupError) {
                console.warn(`Could not clean old index ${previousActiveIndexVersion}:`, cleanupError instanceof Error ? cleanupError.message : cleanupError);
            }
        }
        console.log(`Repository indexed: ${repository.name}, ` +
            `${files.length} files, ${totalChunks} chunks`);
        return { fileCount: files.length, totalChunks };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Unknown ingestion error";
        await db_1.prisma.repository.updateMany({
            where: { id: repositoryId, userId },
            data: {
                status: previousActiveIndexVersion ? "READY" : "FAILED",
                errorMessage: message.slice(0, 1000),
            },
        });
        try {
            await deleteIndexVersion(repositoryId, indexVersion);
        }
        catch (cleanupError) {
            console.warn(`Could not clean failed index ${indexVersion}:`, cleanupError instanceof Error ? cleanupError.message : cleanupError);
        }
        console.error(`Ingestion failed for ${repositoryId}:`, message);
        throw error;
    }
    finally {
        if (temporaryDirectory) {
            await (0, promises_1.rm)(temporaryDirectory, { recursive: true, force: true });
        }
    }
}, { connection, concurrency: 2 });
worker.on("completed", (job) => {
    console.log(`Ingestion job ${job.id} completed`, job.returnvalue);
});
worker.on("failed", (job, error) => {
    console.error(`Job ${job?.id} failed:`, error.message);
});
console.log("DevSage ingestion worker started");
//# sourceMappingURL=ingestion.worker.js.map