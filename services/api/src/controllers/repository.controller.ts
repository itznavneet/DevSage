
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../db";

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

    const [owner, repo] = parts;

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
    return res.status(400).json({ message: "Please provide a valid GitHub URL" });
  }

  const github = parseGitHubUrl(parsed.data.url);

  if (!github) {
    return res.status(400).json({
      message: "URL must point to a public GitHub repository, e.g. https://github.com/owner/repo",
    });
  }

  const userId = res.locals.user.id as string;

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
    return res.status(500).json({ message: "Could not add repository" });
  }
}

export async function listRepositories(_req: Request, res: Response) {
  try {
    const repositories = await prisma.repository.findMany({
      where: { userId: res.locals.user.id },
      orderBy: { createdAt: "desc" },
    });

    return res.json({ repositories });
  } catch (error) {
    console.error("List repositories failed:", error);
    return res.status(500).json({ message: "Could not fetch repositories" });
  }
}
