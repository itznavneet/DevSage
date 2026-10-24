export type BatchProducer<T> = (
  consume: (batch: T[]) => Promise<void>,
) => Promise<void>;

export async function stageBatches<T>(
  produceBatches: BatchProducer<T>,
  sendBatch: (batch: T[]) => Promise<number>,
): Promise<number> {
  let total = 0;

  await produceBatches(async (batch) => {
    if (batch.length === 0) return;
    const indexed = await sendBatch(batch);
    if (indexed !== batch.length) {
      throw new Error(`AI service indexed ${indexed} of ${batch.length} chunks`);
    }
    total += indexed;
  });

  if (total === 0) {
    throw new Error("No non-empty source chunks were produced");
  }

  return total;
}

export async function stageAndActivate<T>(
  produceBatches: BatchProducer<T>,
  sendBatch: (batch: T[]) => Promise<number>,
  activate: () => Promise<void>,
): Promise<number> {
  const total = await stageBatches(produceBatches, sendBatch);
  await activate();
  return total;
}
