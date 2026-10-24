import { Queue } from "bullmq";
export declare const ingestionQueue: Queue<any, any, string, any, any, string, import("bullmq").RedisQueueBackend, import("bullmq").ConnectionOptions>;
export interface IngestionJobData {
    repositoryId: string;
    userId: string;
    url: string;
    indexVersion: string;
}
//# sourceMappingURL=ingestion.queue.d.ts.map