
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { prisma } from "../db";
import type { IngestionJobData } from "../queues/ingestion.queue";

const connection = new IORedis(
  process.env.REDIS_URL || "redis://localhost:6379",
  {
    maxRetriesPerRequest: null,
  }
);

const worker = new Worker<IngestionJobData>(
  "repository-ingestion",
  async (job) => {
    const { repositoryId, userId, url } = job.data;

    const repository = await prisma.repository.findFirst({
      where: { id: repositoryId, userId },
    });

    if (!repository) {
      throw new Error("Repository not found");
    }

    console.log(`Received ingestion job ${job.id}: ${url}`);

    // Actual cloning and indexing will be implemented next.
  },
  { connection }
);

worker.on("completed", (job) => {
  console.log(`Ingestion job ${job.id} completed`);
});

worker.on("failed", (job, error) => {
  console.error(`Ingestion job ${job?.id} failed:`, error.message);
});

console.log("DevSage ingestion worker started");
