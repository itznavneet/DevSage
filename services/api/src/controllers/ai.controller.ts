
import type { Request, Response } from "express";
import { prisma } from "../db";

const AI_SERVICE_URL =
  process.env.AI_SERVICE_URL || "http://localhost:8000";

export async function askRepository(req: Request, res: Response) {
  try {
    const userId = res.locals.user?.id as string | undefined;
    const repositoryId = req.params.repositoryId;

    const question =
      typeof req.body?.question === "string"
        ? req.body.question.trim()
        : "";

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!question || question.length > 2000) {
      return res.status(400).json({
        error: "Question must contain between 1 and 2000 characters",
      });
    }

    const repository = await prisma.repository.findFirst({
      where: {
        id: repositoryId,
        userId,
      },
      select: {
        id: true,
        name: true,
        status: true,
      },
    });

    if (!repository) {
      return res.status(404).json({
        error: "Repository not found",
      });
    }

    if (repository.status !== "READY") {
      return res.status(409).json({
        error: "Repository indexing is not complete",
        status: repository.status,
      });
    }

    const response = await fetch(`${AI_SERVICE_URL}/ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        repository_id: repository.id,
        question,
        limit: 5,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      const details = await response.text();

      console.error("AI service request failed:", response.status, details);

      return res.status(502).json({
        error: "The AI service could not answer this question",
      });
    }

    const result = await response.json();

    return res.json({
      repository: {
        id: repository.id,
        name: repository.name,
      },
      answer: result.answer,
      sources: result.sources,
    });
  } catch (error) {
    console.error("askRepository error:", error);

    if (error instanceof Error && error.name === "TimeoutError") {
      return res.status(504).json({
        error: "The AI service took too long to respond",
      });
    }

    return res.status(500).json({
      error: "Failed to process repository question",
    });
  }
}
