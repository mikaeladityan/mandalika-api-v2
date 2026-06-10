import { Worker } from "bullmq";
import { bullConnection, RM_IMPORT_QUEUE_NAME } from "../../../../../../config/queue.js";
import prisma from "../../../../../../config/prisma.js";
import { redisClient } from "../../../../../../config/redis.js";
import { ImportCacheService } from "../../../../../../lib/utils/import.cache.js";
import { getOrCreateSlug } from "../../../../../../lib/utils/upsert-slug.js";
import { normalizeSlug } from "../../../../../../lib/index.js";
import { logger } from "../../../../../../lib/logger.js";
import { Prisma, RawMaterialSource } from "../../../../../../generated/prisma/client.js";
import {
    bulkUpsertRawMaterials,
    bulkUpsertSupplierMaterials,
    chunkArray,
    type MasterMaps,
} from "../bulk/bulk.upsert.js";
import type { RMImportPreviewDTO } from "../import.schema.js";
import type { RMImportJobData } from "./rm-import.queue.js";

const CACHE_PREFIX = "rm:import:";
const PROCESSING_TTL_SECONDS = 30 * 60;
const CHUNK_SIZE = 500;
const DEFAULT_SUPPLIER_ADDRESS = "-";

type ImportCachePayload = {
    createdAt: number;
    total: number;
    valid: number;
    invalid: number;
    rows: RMImportPreviewDTO[];
};

type SupplierMeta = {
    name: string;
    country: string;
    source: RawMaterialSource;
};

async function releaseLock(import_id: string) {
    await redisClient.del(`${CACHE_PREFIX}lock:${import_id}`);
}

async function upsertSuppliers(
    tx: Prisma.TransactionClient,
    suppliers: Map<string, SupplierMeta>,
): Promise<Map<string, number>> {
    const slugToId = new Map<string, number>();
    if (suppliers.size === 0) return slugToId;

    const slugs = [...suppliers.keys()];
    const lowerNames = slugs.map((s) => suppliers.get(s)!.name.toLowerCase());

    // Supplier.slug nullable — record lama mungkin belum punya slug; cocokkan via lowercase name.
    const existing = await tx.$queryRaw<Array<{ id: number; slug: string | null; name: string }>>`
        SELECT id, slug, name FROM suppliers
        WHERE slug = ANY(${slugs}::text[])
           OR (slug IS NULL AND LOWER(TRIM(name)) = ANY(${lowerNames}::text[]))
    `;

    const claimedSlugs = new Set<string>();
    const toBackfill: Array<{ id: number; slug: string }> = [];

    for (const s of existing) {
        if (s.slug) {
            slugToId.set(s.slug, s.id);
            claimedSlugs.add(s.slug);
        }
    }
    for (const s of existing) {
        if (!s.slug) {
            const slug = normalizeSlug(s.name);
            if (!claimedSlugs.has(slug) && suppliers.has(slug)) {
                slugToId.set(slug, s.id);
                claimedSlugs.add(slug);
                toBackfill.push({ id: s.id, slug });
            }
        }
    }

    for (const { id, slug } of toBackfill) {
        await tx.$executeRaw`
            UPDATE suppliers SET slug = ${slug}, updated_at = NOW()
            WHERE id = ${id} AND slug IS NULL
        `;
    }

    const names = slugs.map((s) => suppliers.get(s)!.name);
    const countries = slugs.map((s) => suppliers.get(s)!.country);
    const sources = slugs.map((s) => suppliers.get(s)!.source);

    const upserted = await tx.$queryRaw<Array<{ id: number; slug: string }>>`
        INSERT INTO suppliers (name, slug, addresses, country, source, created_at, updated_at)
        SELECT t.name, t.slug, ${DEFAULT_SUPPLIER_ADDRESS}, t.country, t.source::"RawMaterialSource", NOW(), NOW()
        FROM unnest(
            ${names}::text[],
            ${slugs}::text[],
            ${countries}::text[],
            ${sources}::text[]
        ) AS t(name, slug, country, source)
        ON CONFLICT (slug) DO UPDATE SET
            source = EXCLUDED.source,
            country = EXCLUDED.country,
            updated_at = NOW()
        RETURNING id, slug
    `;
    for (const s of upserted) slugToId.set(s.slug, s.id);

    return slugToId;
}

export async function processRMImportJob(
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

    // Dedupe by barcode (unique key)
    const deduped = new Map<string, RMImportPreviewDTO>();
    for (const row of validRows) {
        const barcode = row.barcode?.trim();
        if (barcode) deduped.set(barcode, row);
    }
    const finalRows = Array.from(deduped.values()).sort((a, b) =>
        a.barcode.localeCompare(b.barcode),
    );
    if (!finalRows.length) throw new Error("Tidak ada baris valid untuk diimport");

    // Collect unique master data
    const unitSet = new Set<string>();
    const categorySet = new Set<string>();
    const supplierMeta = new Map<string, SupplierMeta>();

    for (const row of finalRows) {
        if (row.unit) unitSet.add(row.unit);
        if (row.category) categorySet.add(row.category);
        if (row.supplier) {
            const slug = normalizeSlug(row.supplier);
            const existing = supplierMeta.get(slug);
            if (!existing) {
                supplierMeta.set(slug, {
                    name: row.supplier,
                    country: row.country,
                    source: row.source,
                });
            } else {
                // IMPORT menang atas LOCAL kalau supplier muncul campur source di file.
                if (
                    row.source === RawMaterialSource.IMPORT &&
                    existing.source !== RawMaterialSource.IMPORT
                ) {
                    existing.source = RawMaterialSource.IMPORT;
                }
                if (!existing.country && row.country) existing.country = row.country;
            }
        }
    }

    const maps: MasterMaps = await prisma.$transaction(
        async (tx) => {
            const [unitEntries, categoryEntries, supplierIds] = await Promise.all([
                Promise.all(
                    [...unitSet].map(
                        async (name) => [name, await getOrCreateSlug(tx.unitRawMaterial, name)] as const,
                    ),
                ),
                Promise.all(
                    [...categorySet].map(
                        async (name) =>
                            [name, await getOrCreateSlug(tx.rawMatCategories, name)] as const,
                    ),
                ),
                upsertSuppliers(tx, supplierMeta),
            ]);
            return {
                unitIds: new Map(unitEntries),
                categoryIds: new Map(categoryEntries),
                supplierIds,
            };
        },
        { maxWait: 60_000, timeout: 120_000 },
    );

    const chunks = chunkArray(finalRows, CHUNK_SIZE);
    let processed = 0;
    for (const chunk of chunks) {
        await prisma.$transaction(
            async (tx) => {
                const inserted = await bulkUpsertRawMaterials(tx, chunk, maps);
                const barcodeToId = new Map(inserted.map((r) => [r.barcode, r.id]));

                const smRows: Array<{
                    supplier_id: number;
                    raw_material_id: number;
                    unit_price: number;
                    min_buy: number;
                    lead_time: number;
                }> = [];
                for (const row of chunk) {
                    if (!row.supplier) continue;
                    const supplierId = maps.supplierIds.get(normalizeSlug(row.supplier));
                    const rmId = barcodeToId.get(row.barcode);
                    if (!supplierId || !rmId) continue;
                    smRows.push({
                        supplier_id: supplierId,
                        raw_material_id: rmId,
                        unit_price: row.price,
                        min_buy: row.min_buy,
                        lead_time: row.lead_time,
                    });
                }
                if (smRows.length) await bulkUpsertSupplierMaterials(tx, smRows);
            },
            { maxWait: 60_000, timeout: 120_000 },
        );

        processed += chunk.length;
        const pct = Math.floor((processed / finalRows.length) * 100);
        await onProgress(pct);
    }

    await ImportCacheService.remove(CACHE_PREFIX, import_id);
    await releaseLock(import_id);

    return { import_id, total: finalRows.length };
}

export function createRMImportWorker() {
    const worker = new Worker<RMImportJobData>(
        RM_IMPORT_QUEUE_NAME,
        async (job) => {
            const { import_id } = job.data;
            return processRMImportJob(import_id, async (pct) => {
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
        logger.info("RM import job completed", { jobId: job.id, result: job.returnvalue });
    });

    worker.on("failed", (job, err) => {
        logger.error("RM import job failed", {
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
