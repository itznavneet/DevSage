import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { ingestionQueue } from "../queues/ingestion.queue";
import { randomUUID } from "node:crypto";

const createRepositorySchema = z.object({
  url: z.string().trim().url(),
});

function parseGitHubUrl(value: string) {
  try {
    const parsed = new URL(value);

    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "github.com" ||
      parsed.port ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }

    const parts = parsed.pathname.split("/").filter(Boolean);

    if (parts.length !== 2) return null;

    const owner = parts[0];
    const repo = parts[1];

    if (!owner || !repo) return null;

    if (
      !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(owner) ||
      !/^[a-zA-Z0-9._-]+$/.test(repo) ||
      repo === "." ||
      repo === ".."
    ) {
      return null;
    }

    const githubName = repo.replace(/\.git$/i, "");
    if (!githubName) return null;

    return {
      owner,
      name: githubName,
      url: `https://github.com/${owner}/${githubName}`,
    };
  } catch {
    return null;
  }
}

export async function createRepository(req: Request, res: Response) {
  const parsed = createRepositorySchema.safeParse(req.body);

  if (!parsed.success) {
    return res
      .status(400)
      .json({ message: "Please provide a valid GitHub URL" });
  }

  const github = parseGitHubUrl(parsed.data.url);

  if (!github) {
    return res.status(400).json({
      message:
        "URL must point to a public GitHub repository, e.g. https://github.com/owner/repo",
    });
  }

  const userId = res.locals.user.id as string;
  let createdRepositoryId: string | undefined;

  try {
    const repository = await prisma.repository.create({
      data: {
        name: github.name,
        url: github.url,
        githubOwner: github.owner,
        githubName: github.name,
        userId,
      },
    });
    createdRepositoryId = repository.id;

    await ingestionQueue.add(
      "ingest-repository",
      {
        repositoryId: repository.id,
        userId,
        url: repository.url,
        indexVersion: randomUUID(),
      },
      {
        jobId: `${repository.id}-initial`,
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );

    return res.status(201).json({ repository });
  } catch (error) {
    // Prisma unique constraint violation: repository already added by this user.
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return res.status(409).json({
        message: "You have already added this repository",
      });
    }

    console.error("Create repository failed:", error);

    if (createdRepositoryId) {
      await prisma.repository.updateMany({
        where: { id: createdRepositoryId, userId },
        data: {
          status: "FAILED",
          errorMessage: "Could not enqueue repository indexing. Please retry.",
        },
      });
    }

    return res.status(500).json({ message: "Could not add repository" });
  }
}

export async function reindexRepository(req: Request, res: Response) {
  const userId = res.locals.user?.id as string | undefined;
  const repositoryId = typeof req.params.repositoryId === "string" ? req.params.repositoryId : "";

  if (!userId || !repositoryId) {
    return res.status(400).json({ message: "Invalid repository" });
  }

  try {
    const repository = await prisma.repository.findFirst({
      where: { id: repositoryId, userId },
      select: { id: true, url: true, status: true },
    });

    if (!repository) {
      return res.status(404).json({ message: "Repository not found" });
    }

    if (repository.status === "CLONING" || repository.status === "INDEXING") {
      return res.status(409).json({ message: "Repository indexing is already in progress" });
    }

    const indexVersion = randomUUID();

    await ingestionQueue.add(
      "reindex-repository",
      { repositoryId, userId, url: repository.url, indexVersion },
      {
        jobId: `${repository.id}-${indexVersion}`,
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );

    await prisma.repository.update({
      where: { id: repository.id },
      data: { status: "INDEXING", errorMessage: null },
    });

    return res.status(202).json({ repositoryId, indexVersion, status: "INDEXING" });
  } catch (error) {
    console.error("Reindex repository failed:", error);
    return res.status(500).json({ message: "Could not start repository re-indexing" });
  }
}

export async function listRepositories(_req: Request, res: Response) {
  try {
    const repositories = await prisma.repository.findMany({
      where: { userId: res.locals.user.id as string },
      orderBy: { createdAt: "desc" },
    });

    return res.json({ repositories });
  } catch (error) {
    console.error("List repositories failed:", error);
    return res.status(500).json({ message: "Could not fetch repositories" });
  }
}
