import { Worker } from "bullmq";
import { bullConnection, PRODUCT_SHEET_QUEUE_NAME } from "../../../../config/queue.js";
import prisma from "../../../../config/prisma.js";
import { logger } from "../../../../lib/logger.js";
import { ProductSheetSyncService } from "./product-sheet.service.js";
import type { ProductSheetSyncJob } from "./product-sheet.schema.js";

export function createProductSheetSyncWorker(): { close: () => Promise<void> } {
    const worker = new Worker<ProductSheetSyncJob>(
        PRODUCT_SHEET_QUEUE_NAME,
        async (job) => ProductSheetSyncService.handle(job.data),
        { connection: bullConnection, concurrency: 2 },
    );

    worker.on("failed", async (job, err) => {
        if (!job) return;
        const exhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
        if (!exhausted) return;
        try {
            await prisma.productSheetSyncFailure.create({
                data: {
                    product_id: job.data.productId,
                    action: job.data.action,
                    error_message: err.message.slice(0, 4000),
                    attempt_count: job.attemptsMade,
                    last_attempted_at: new Date(),
                },
            });
            logger.warn("product-sheet sync job failed terminally", {
                productId: job.data.productId,
                action: job.data.action,
                error: err.message,
            });
        } catch (dbErr) {
            logger.error("Failed to record sheet-sync failure", {
                error: dbErr instanceof Error ? dbErr.message : String(dbErr),
            });
        }
    });

    worker.on("completed", async (job) => {
        try {
            await prisma.productSheetSyncFailure.updateMany({
                where: { product_id: job.data.productId, resolved_at: null },
                data: { resolved_at: new Date() },
            });
        } catch (err) {
            logger.error("Failed to resolve sheet-sync failure record", {
                error: err instanceof Error ? err.message : String(err),
            });
        }
    });

    return { close: () => worker.close() };
}
