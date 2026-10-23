
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { randomUUID } from "node:crypto";
import { prisma } from "../db";
import type { IngestionJobData } from "../queues/ingestion.queue";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readdir, stat, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, extname, basename } from "node:path";

const execFileAsync = promisify(execFile);

const connection = new IORedis(
  process.env.REDIS_URL || "redis://localhost:6379",
  { maxRetriesPerRequest: null }
);

const AI_SERVICE_URL =
  process.env.AI_SERVICE_URL || "http://localhost:8000";

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  "target",
  "out",
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
  ".env.production",
  "id_rsa",
  "id_ed25519",
]);

const SECRET_EXTENSIONS = new Set([
  ".pem", ".key", ".p12", ".pfx", ".keystore",
]);

const MAX_FILES = 5000;
const MAX_FILE_SIZE = 1024 * 1024;
const CHUNK_LINES = 80;
const CHUNK_OVERLAP = 10;
const MAX_CHUNK_CHARS = 8000;
const BATCH_SIZE = 128;

interface SourceFile {
  absolutePath: string;
  relativePath: string;
}

interface CodeChunk {
  id: string;
  repository_id: string;
  file_path: string;
  start_line: number;
  end_line: number;
  content: string;
}

async function collectSourceFiles(root: string): Promise<SourceFile[]> {
  const files: SourceFile[] = [];

  async function walk(directory: string): Promise<void> {
    if (files.length >= MAX_FILES) return;

    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      if (files.length >= MAX_FILES) break;

      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name.toLowerCase())) {
          await walk(join(directory, entry.name));
        }
        continue;
      }

      // Ignore symlinks and anything that isn't a regular file.
      if (!entry.isFile()) continue;

      const absolutePath = join(directory, entry.name);
      const fileName = basename(absolutePath).toLowerCase();
      const extension = extname(entry.name).toLowerCase();

      // Avoid indexing credentials and likely secret files.
      if (
        IGNORED_FILES.has(fileName) ||
        fileName.startsWith(".env.") ||
        SECRET_EXTENSIONS.has(extension) ||
        fileName.endsWith(".secret") ||
        fileName.endsWith(".pem")
      ) {
        continue;
      }

      const isDockerfile = fileName === "dockerfile";

      if (!SOURCE_EXTENSIONS.has(extension) && !isDockerfile) {
        continue;
      }

      const info = await stat(absolutePath);

      if (info.size === 0 || info.size > MAX_FILE_SIZE) {
        continue;
      }

      files.push({
        absolutePath,
        relativePath: relative(root, absolutePath).replace(/\\/g, "/"),
      });
    }
  }

  await walk(root);
  return files;
}

function splitIntoChunks(
  repositoryId: string,
  filePath: string,
  source: string
): CodeChunk[] {
  const lines = source.split(/\r?\n/);
  const chunks: CodeChunk[] = [];

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
        const separator = content.length > 0 ? "\n" : "";

        if (
          content.length > 0 &&
          content.length + separator.length + nextLine.length >
            MAX_CHUNK_CHARS
        ) {
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
        id: randomUUID(),
        repository_id: repositoryId,
        file_path: filePath,
        start_line: start + 1,
        end_line: end,
        content,
      });
    }

    if (end >= lines.length) break;

    // Advance while retaining some context from the previous chunk.
    start = Math.max(start + 1, end - CHUNK_OVERLAP);
  }

  return chunks;
}

async function deleteExistingVectors(repositoryId: string): Promise<void> {
  const response = await fetch(
    `${AI_SERVICE_URL}/repositories/${encodeURIComponent(repositoryId)}`,
    { method: "DELETE", signal: AbortSignal.timeout(30_000) }
  );

  if (!response.ok) {
    throw new Error(
      `Could not clear existing vectors (${response.status}): ` +
      (await response.text()).slice(0, 500)
    );
  }
}

async function sendBatch(chunks: CodeChunk[]): Promise<number> {
  const response = await fetch(`${AI_SERVICE_URL}/index`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chunks }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    throw new Error(
      `AI indexing failed (${response.status}): ` +
      (await response.text()).slice(0, 1000)
    );
  }

  const result = (await response.json()) as {
    indexed_chunks?: number;
  };

  if (result.indexed_chunks !== chunks.length) {
    throw new Error(
      `AI service indexed ${result.indexed_chunks ?? 0} of ` +
      `${chunks.length} chunks`
    );
  }

  return result.indexed_chunks;
}

const worker = new Worker<IngestionJobData>(
  "repository-ingestion",
  async (job) => {
    const { repositoryId, userId, url } = job.data;
    let temporaryDirectory: string | undefined;

    try {
      const repository = await prisma.repository.findFirst({
        where: { id: repositoryId, userId },
      });

      if (!repository) {
        throw new Error("Repository not found");
      }

      const parsedUrl = new URL(url);

      if (
        parsedUrl.protocol !== "https:" ||
        parsedUrl.hostname !== "github.com" ||
        parsedUrl.port ||
        parsedUrl.username ||
        parsedUrl.password ||
        parsedUrl.search ||
        parsedUrl.hash
      ) {
        throw new Error("Only public GitHub repositories are supported");
      }

      const parts = parsedUrl.pathname.split("/").filter(Boolean);

      if (
        parts.length !== 2 ||
        !/^[a-zA-Z0-9-]+$/.test(parts[0]) ||
        !/^[a-zA-Z0-9._-]+$/.test(parts[1])
      ) {
        throw new Error("Invalid GitHub repository URL");
      }

      const safeUrl =
        `https://github.com/${parts[0]}/` +
        `${parts[1].replace(/\.git$/i, "")}.git`;

      await prisma.repository.update({
        where: { id: repositoryId },
        data: { status: "CLONING", errorMessage: null },
      });

      temporaryDirectory = await mkdtemp(
        join(tmpdir(), "devsage-repo-")
      );

      const cloneDirectory = join(temporaryDirectory, "source");

      await execFileAsync(
        "git",
        [
          "clone",
          "--depth", "1",
          "--single-branch",
          "--no-tags",
          "--",
          safeUrl,
          cloneDirectory,
        ],
        {
          timeout: 120_000,
          maxBuffer: 5 * 1024 * 1024,
          windowsHide: true,
        }
      );

      await prisma.repository.update({
        where: { id: repositoryId },
        data: { status: "INDEXING" },
      });

      const files = await collectSourceFiles(cloneDirectory);

      if (files.length === 0) {
        throw new Error("No supported source files found");
      }

      // Clear old vectors only after cloning and validating the source files.
      await deleteExistingVectors(repositoryId);

      let totalChunks = 0;

      for (const file of files) {
        const source = await readFile(file.absolutePath, "utf8");

        const chunks = splitIntoChunks(
          repositoryId,
          file.relativePath,
          source
        );

        for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
          const batch = chunks.slice(i, i + BATCH_SIZE);
          totalChunks += await sendBatch(batch);
        }
      }

      if (totalChunks === 0) {
        throw new Error("No non-empty source chunks were produced");
      }

      await prisma.repository.update({
        where: { id: repositoryId },
        data: {
          status: "READY",
          errorMessage: null,
          lastIndexedAt: new Date(),
        },
      });

      console.log(
        `Repository indexed: ${repository.name}, ` +
        `${files.length} files, ${totalChunks} chunks`
      );

      return { fileCount: files.length, totalChunks };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown ingestion error";

      await prisma.repository.updateMany({
        where: { id: repositoryId, userId },
        data: {
          status: "FAILED",
          errorMessage: message.slice(0, 1000),
        },
      });

      console.error(`Ingestion failed for ${repositoryId}:`, message);
      throw error;
    } finally {
      if (temporaryDirectory) {
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
    }
  },
  { connection, concurrency: 2 }
);

worker.on("completed", (job) => {
  console.log(`Ingestion job ${job.id} completed`, job.returnvalue);
});

worker.on("failed", (job, error) => {
  console.error(`Job ${job?.id} failed:`, error.message);
});

console.log("DevSage ingestion worker started");
