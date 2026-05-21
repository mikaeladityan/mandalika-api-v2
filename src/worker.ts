import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { closeRedisConnection, redisClient } from "./config/redis.js";
import { closeDatabase, initializeDatabase } from "./config/prisma.js";
import { createFGImportWorker } from "./module/application/inventory/fg/import/queue/fg-import.worker.js";
import { createRMImportWorker } from "./module/application/inventory/rm/import/queue/rm-import.worker.js";
import { createProductImportWorker } from "./module/application/product/import/queue/product-import.worker.js";

console.log("Worker environment loaded:", {
    NODE_ENV: env.NODE_ENV,
    REDIS_HOST: env.REDIS_HOST,
});

const initialize = async () => {
    try {
        await initializeDatabase();
        await redisClient.connect();
        const pong = await redisClient.ping();
        logger.info(`Worker Redis ping: ${pong}`);
        logger.info("Worker initialized");
    } catch (error) {
        logger.error("Worker initialization failed", {
            error: error instanceof Error ? error.message : String(error),
        });
        process.exit(1);
    }
};

const fgImportWorker = createFGImportWorker();
logger.info("FG import worker listening");

const rmImportWorker = createRMImportWorker();
logger.info("RM import worker listening");

const productImportWorker = createProductImportWorker();
logger.info("Product import worker listening");

initialize();

const shutdown = async () => {
    logger.info("Shutting down worker...");
    try {
        await fgImportWorker.close();
        await rmImportWorker.close();
        await productImportWorker.close();
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
