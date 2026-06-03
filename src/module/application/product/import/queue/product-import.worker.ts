import { Worker } from "bullmq";
import { bullConnection, PRODUCT_IMPORT_QUEUE_NAME } from "../../../../../config/queue.js";
import prisma from "../../../../../config/prisma.js";
import { redisClient } from "../../../../../config/redis.js";
import { ImportCacheService } from "../../../../../lib/utils/import.cache.js";
import { getOrCreateSlug } from "../../../../../lib/utils/upsert-slug.js";
import { getOrCreateSize } from "../../../../../lib/utils/upsert-size.js";
import { logger } from "../../../../../lib/logger.js";
import { bulkUpsertProducts, chunkArray, type MasterMaps } from "../bulk/bulk.upsert.js";
import type { ProductImportPreviewDTO } from "../import.schema.js";
import type { ProductImportJobData } from "./product-import.queue.js";

const CACHE_PREFIX = "product:import:";
const PROCESSING_TTL_SECONDS = 30 * 60;
const CHUNK_SIZE = 500;

type ImportCachePayload = {
    createdAt: number;
    total: number;
    valid: number;
    invalid: number;
    rows: ProductImportPreviewDTO[];
};

async function releaseLock(import_id: string) {
    await redisClient.del(`${CACHE_PREFIX}lock:${import_id}`);
}

export async function processProductImportJob(
    import_id: string,
    onProgress: (pct: number) => Promise<void>,
) {
    const cache = await ImportCacheService.get<ImportCachePayload>(CACHE_PREFIX, import_id);
    if (!cache) throw new Error("Import session tidak ditemukan atau sudah kadaluarsa");

    await redisClient.expire(
        ImportCacheService.key(CACHE_PREFIX, import_id),
        PROCESSING_TTL_SECONDS,
    );

    const validRows = cache.rows.filter((r) => r.errors.length === 0);
    if (!validRows.length) throw new Error("Tidak ada baris valid untuk diimport");

    const deduped = new Map<string, ProductImportPreviewDTO>();
    for (const row of validRows) {
        const code = row.code?.trim();
        if (code) deduped.set(code, row);
    }
    const finalRows = Array.from(deduped.values()).sort((a, b) => a.code.localeCompare(b.code));
    if (!finalRows.length) throw new Error("Tidak ada baris valid untuk diimport");

    const uniqueTypes = [...new Set(finalRows.map((r) => r.type).filter((v): v is string => !!v))];
    const uniqueUnits = [...new Set(finalRows.map((r) => r.unit).filter((v): v is string => !!v))];
    const uniqueSizes = [...new Set(finalRows.map((r) => r.size).filter((v) => v > 0))];

    const maps: MasterMaps = await prisma.$transaction(async (tx) => {
        const [typeEntries, unitEntries, sizeEntries] = await Promise.all([
            Promise.all(
                uniqueTypes.map(
                    async (name) => [name, await getOrCreateSlug(tx.productType, name)] as const,
                ),
            ),
            Promise.all(
                uniqueUnits.map(
                    async (name) => [name, await getOrCreateSlug(tx.unit, name)] as const,
                ),
            ),
            Promise.all(
                uniqueSizes.map(async (size) => [size, await getOrCreateSize(tx, size)] as const),
            ),
        ]);
        return {
            typeIds: new Map(typeEntries),
            unitIds: new Map(unitEntries),
            sizeIds: new Map(sizeEntries),
        };
    });

    const chunks = chunkArray(finalRows, CHUNK_SIZE);
    let processed = 0;
    for (const chunk of chunks) {
        await bulkUpsertProducts(chunk, maps);
        processed += chunk.length;
        const pct = Math.floor((processed / finalRows.length) * 100);
        await onProgress(pct);
    }

    await ImportCacheService.remove(CACHE_PREFIX, import_id);
    await releaseLock(import_id);

    return { import_id, total: finalRows.length };
}

export function createProductImportWorker() {
    const worker = new Worker<ProductImportJobData>(
        PRODUCT_IMPORT_QUEUE_NAME,
        async (job) => {
            const { import_id } = job.data;
            return processProductImportJob(import_id, async (pct) => {
                await job.updateProgress(pct);
            });
        },
        {
            connection: bullConnection,
            concurrency: 1,
            lockDuration: 60_000,
        },
    );

    worker.on("completed", (job) => {
        logger.info("Product import job completed", { jobId: job.id, result: job.returnvalue });
    });

    worker.on("failed", (job, err) => {
        logger.error("Product import job failed", {
            jobId: job?.id,
            attemptsMade: job?.attemptsMade,
            error: err.message,
        });
        if (job) {
            const final = (job.attemptsMade ?? 0) >= (job.opts.attempts ?? 1);
            if (final) releaseLock(job.data.import_id).catch(() => undefined);
        }
    });

    return worker;
}
