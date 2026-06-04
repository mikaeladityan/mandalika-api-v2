import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { closeRedisConnection, redisClient } from "./config/redis.js";
import { closeDatabase, initializeDatabase } from "./config/prisma.js";
import { createFGImportWorker } from "./module/application/inventory/fg/import/queue/fg-import.worker.js";
import { createRMImportWorker } from "./module/application/inventory/rm/import/queue/rm-import.worker.js";
import { createProductImportWorker } from "./module/application/product/import/queue/product-import.worker.js";
import { createProductSheetSyncWorker } from "./module/application/product/sheet/product-sheet.worker.js";
import { createRawMatSheetSyncWorker } from "./module/application/rawmat/sheet/rawmat-sheet.worker.js";

console.log("Worker environment loaded:", {
    NODE_ENV: env.NODE_ENV,
    REDIS_HOST: env.REDIS_HOST,
});

// ioredis statuses: "wait" (lazyConnect, belum connect), "connecting", "connect",
// "ready", "reconnecting", "end". connect() hanya boleh dipanggil saat "wait" / "end".
async function ensureRedisConnected() {
    const status = redisClient.status;
    if (status === "ready" || status === "connect" || status === "connecting") return;
    await redisClient.connect();
}

type WorkerHandle = { close: () => Promise<void> };
let fgImportWorker: WorkerHandle | null = null;
let rmImportWorker: WorkerHandle | null = null;
let productImportWorker: WorkerHandle | null = null;
let productSheetSyncWorker: WorkerHandle | null = null;
let rawmatSheetSyncWorker: WorkerHandle | null = null;

const initialize = async () => {
    try {
        await initializeDatabase();
        await ensureRedisConnected();
        const pong = await redisClient.ping();
        logger.info(`Worker Redis ping: ${pong}`);

        // Workers baru di-spawn SETELAH redis siap, supaya job yang langsung
        // tertangkap tidak memicu lazy-connect race condition.
        fgImportWorker = createFGImportWorker();
        logger.info("FG import worker listening");

        rmImportWorker = createRMImportWorker();
        logger.info("RM import worker listening");

        productImportWorker = createProductImportWorker();
        logger.info("Product import worker listening");

        productSheetSyncWorker = createProductSheetSyncWorker();
        logger.info("Product sheet-sync worker listening");

        rawmatSheetSyncWorker = createRawMatSheetSyncWorker();
        logger.info("RawMat sheet-sync worker listening");

        logger.info("Worker initialized");
    } catch (error) {
        logger.error("Worker initialization failed", {
            error: error instanceof Error ? error.message : String(error),
        });
        process.exit(1);
    }
};

initialize();

const shutdown = async () => {
    logger.info("Shutting down worker...");
    try {
        await fgImportWorker?.close();
        await rmImportWorker?.close();
        await productImportWorker?.close();
        await productSheetSyncWorker?.close();
        await rawmatSheetSyncWorker?.close();
        await closeRedisConnection();
        await closeDatabase();
    } catch (error) {
        logger.error("Worker shutdown error", {
            message: error instanceof Error ? error.message : "Unknown error",
        });
    } finally {
        setTimeout(() => process.exit(0), 100);
    }
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
