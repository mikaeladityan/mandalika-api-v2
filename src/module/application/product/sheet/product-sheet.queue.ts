import { Queue } from "bullmq";
import { redisClient } from "../../../../config/redis.js";
import { env } from "../../../../config/env.js";
import { logger } from "../../../../lib/logger.js";
import type { ProductSheetSyncJob } from "./product-sheet.schema.js";

export const PRODUCT_SHEET_QUEUE_NAME = "product-sheet-sync";

export const productSheetSyncQueue = new Queue<ProductSheetSyncJob>(PRODUCT_SHEET_QUEUE_NAME, {
    connection: redisClient,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { age: 86400, count: 1000 },
        removeOnFail: { age: 604800 },
    },
});

export async function enqueueProductSheetSync(job: ProductSheetSyncJob): Promise<void> {
    if (!env.PRODUCT_SHEET_SYNC_ENABLED) return;
    try {
        await productSheetSyncQueue.add(`${job.action}:${job.productId}`, job);
    } catch (err) {
        logger.error("Failed to enqueue product-sheet sync job", {
            error: err instanceof Error ? err.message : String(err),
            job,
        });
    }
}
