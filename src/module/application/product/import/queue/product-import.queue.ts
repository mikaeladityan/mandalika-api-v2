import { Queue } from "bullmq";
import { bullConnection, PRODUCT_IMPORT_QUEUE_NAME } from "../../../../../config/queue.js";

export type ProductImportJobData = {
    import_id: string;
};

export const productImportQueue = new Queue<ProductImportJobData>(PRODUCT_IMPORT_QUEUE_NAME, {
    connection: bullConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { age: 3600, count: 100 },
        removeOnFail: false,
    },
});

export async function enqueueProductImport(import_id: string) {
    return productImportQueue.add("execute", { import_id }, { jobId: import_id });
}
