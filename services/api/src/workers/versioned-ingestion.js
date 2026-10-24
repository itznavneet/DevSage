"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stageBatches = stageBatches;
exports.stageAndActivate = stageAndActivate;
async function stageBatches(produceBatches, sendBatch) {
    let total = 0;
    await produceBatches(async (batch) => {
        if (batch.length === 0)
            return;
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
async function stageAndActivate(produceBatches, sendBatch, activate) {
    const total = await stageBatches(produceBatches, sendBatch);
    await activate();
    return total;
}
//# sourceMappingURL=versioned-ingestion.js.map