import { Queue } from "bullmq";
import { bullConnection, RAWMAT_SHEET_QUEUE_NAME } from "../../../../config/queue.js";
import { env } from "../../../../config/env.js";
import { logger } from "../../../../lib/logger.js";
import type { RawMatSheetSyncJob } from "./rawmat-sheet.schema.js";

export { RAWMAT_SHEET_QUEUE_NAME };

// Lazy: do not instantiate at module import time. Top-level `new Queue(...)`
// would trigger ioredis connect via BullMQ, racing with redisClient.connect()
// in server.ts initialize() and producing "Redis is already connecting".
let _queue: Queue<RawMatSheetSyncJob> | null = null;

function getQueue(): Queue<RawMatSheetSyncJob> {
    if (_queue) return _queue;
    _queue = new Queue<RawMatSheetSyncJob>(RAWMAT_SHEET_QUEUE_NAME, {
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

export async function enqueueRawMatSheetSync(job: RawMatSheetSyncJob): Promise<void> {
    if (!env.RAWMAT_SHEET_SYNC_ENABLED) return;
    try {
        await getQueue().add(`${job.action}:${job.rawMaterialId}`, job);
    } catch (err) {
        logger.error("Failed to enqueue rawmat-sheet sync job", {
            error: err instanceof Error ? err.message : String(err),
            job,
        });
    }
}
