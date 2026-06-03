import { Queue } from "bullmq";
import { bullConnection, PRODUCT_SHEET_QUEUE_NAME } from "../../../../config/queue.js";
import { env } from "../../../../config/env.js";
import { logger } from "../../../../lib/logger.js";
import type { ProductSheetSyncJob } from "./product-sheet.schema.js";

export { PRODUCT_SHEET_QUEUE_NAME };

// Lazy: do not instantiate at module import time. Top-level `new Queue(...)`
// would trigger an ioredis connect via BullMQ's connection setup, racing with
// the explicit redisClient.connect() in server.ts initialize() and producing
// "Redis is already connecting/connected". The lazy getter defers creation
// until the first enqueue, after the app's redis bootstrap has settled.
let _queue: Queue<ProductSheetSyncJob> | null = null;

function getQueue(): Queue<ProductSheetSyncJob> {
    if (_queue) return _queue;
    _queue = new Queue<ProductSheetSyncJob>(PRODUCT_SHEET_QUEUE_NAME, {
        connection: bullConnection,
        defaultJobOptions: {
            attempts: 3,
            backoff: { type: "exponential", delay: 5000 },
            removeOnComplete: { age: 86400, count: 1000 },
            removeOnFail: { age: 604800 },
        },
    });
    return _queue;
}

export async function enqueueProductSheetSync(job: ProductSheetSyncJob): Promise<void> {
    if (!env.PRODUCT_SHEET_SYNC_ENABLED) return;
    try {
        await getQueue().add(`${job.action}:${job.productId}`, job);
    } catch (err) {
        logger.error("Failed to enqueue product-sheet sync job", {
            error: err instanceof Error ? err.message : String(err),
            job,
        });
    }
}
