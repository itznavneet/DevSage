
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { prisma } from "../db";
import type { IngestionJobData } from "../queues/ingestion.queue";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readdir, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

const connection = new IORedis(
  process.env.REDIS_URL || "redis://localhost:6379",
  { maxRetriesPerRequest: null }
);

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  "vendor",
  "__pycache__",
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

const MAX_FILES = 5000;
const MAX_FILE_SIZE = 1024 * 1024;

async function scanSourceFiles(root: string): Promise<number> {
  let count = 0;

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      if (count >= MAX_FILES) return;

      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          await walk(join(directory, entry.name));
        }
        continue;
      }

      // Ignore symlinks and non-regular files.
      if (!entry.isFile()) continue;

      const filePath = join(directory, entry.name);
      const extension = entry.name.includes(".")
        ? "." + entry.name.split(".").pop()!.toLowerCase()
        : "";

      const isDockerfile = entry.name.toLowerCase() === "dockerfile";

      if (!SOURCE_EXTENSIONS.has(extension) && !isDockerfile) continue;

      const info = await stat(filePath);

      if (info.size <= MAX_FILE_SIZE) {
        count++;
      }
    }
  }

  await walk(root);
  return count;
}

function normalizeGitHubUrl(value: string): string {
  const url = new URL(value);

  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Only public GitHub repositories are supported");
  }

  const parts = url.pathname.split("/").filter(Boolean);

  if (
    parts.length !== 2 ||
    !/^[a-zA-Z0-9-]+$/.test(parts[0]) ||
    !/^[a-zA-Z0-9._-]+$/.test(parts[1])
  ) {
    throw new Error("Invalid GitHub repository URL");
  }

  return `https://github.com/${parts[0]}/${parts[1].replace(/\.git$/i, "")}.git`;
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

      const safeUrl = normalizeGitHubUrl(url);

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

      const fileCount = await scanSourceFiles(cloneDirectory);

      if (fileCount === 0) {
        throw new Error("No supported source files found");
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
        `Repository scanned: ${repository.name}, ${fileCount} eligible files`
      );

      return { fileCount };
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
