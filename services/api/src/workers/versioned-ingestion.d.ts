export type BatchProducer<T> = (consume: (batch: T[]) => Promise<void>) => Promise<void>;
export declare function stageBatches<T>(produceBatches: BatchProducer<T>, sendBatch: (batch: T[]) => Promise<number>): Promise<number>;
export declare function stageAndActivate<T>(produceBatches: BatchProducer<T>, sendBatch: (batch: T[]) => Promise<number>, activate: () => Promise<void>): Promise<number>;
//# sourceMappingURL=versioned-ingestion.d.ts.map