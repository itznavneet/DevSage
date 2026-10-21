
import { Queue } from "bullmq";
import IORedis from "ioredis";

const connection = new IORedis(
  process.env.REDIS_URL || "redis://localhost:6379",
  {
    maxRetriesPerRequest: null,
  }
);

export const ingestionQueue = new Queue("repository-ingestion", {
  connection,
});

export interface IngestionJobData {
  repositoryId: string;
  userId: string;
  url: string;
}
