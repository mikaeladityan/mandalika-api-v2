import { Worker } from "bullmq";
import { bullConnection, RAWMAT_SHEET_QUEUE_NAME } from "../../../../config/queue.js";
import prisma from "../../../../config/prisma.js";
import { logger } from "../../../../lib/logger.js";
import { RawMatSheetSyncService } from "./rawmat-sheet.service.js";
import type { RawMatSheetSyncJob } from "./rawmat-sheet.schema.js";

export function createRawMatSheetSyncWorker(): { close: () => Promise<void> } {
	const worker = new Worker<RawMatSheetSyncJob>(
		RAWMAT_SHEET_QUEUE_NAME,
		async (job) => RawMatSheetSyncService.handle(job.data),
		{ connection: bullConnection, concurrency: 2 },
	);

	worker.on("failed", async (job, err) => {
		if (!job) return;
		const exhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
		if (!exhausted) return;
		try {
			await prisma.rawMaterialSheetSyncFailure.create({
				data: {
					raw_material_id: job.data.rawMaterialId,
					action: job.data.action,
					error_message: err.message.slice(0, 4000),
					attempt_count: job.attemptsMade,
					last_attempted_at: new Date(),
				},
			});
			logger.warn("rawmat-sheet sync job failed terminally", {
				rawMaterialId: job.data.rawMaterialId,
				action: job.data.action,
				error: err.message,
			});
		} catch (dbErr) {
			logger.error("Failed to record rawmat sheet-sync failure", {
				error: dbErr instanceof Error ? dbErr.message : String(dbErr),
			});
		}
	});

	worker.on("completed", async (job) => {
		try {
			await prisma.rawMaterialSheetSyncFailure.updateMany({
				where: { raw_material_id: job.data.rawMaterialId, resolved_at: null },
				data: { resolved_at: new Date() },
			});
		} catch (err) {
			logger.error("Failed to resolve rawmat sheet-sync failure record", {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	});

	return { close: () => worker.close() };
}
