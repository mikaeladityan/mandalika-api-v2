import { randomUUID } from "crypto";
import { Prisma } from "../../../../../generated/prisma/client.js";
import prisma from "../../../../../config/prisma.js";
import { redisClient } from "../../../../../config/redis.js";
import { ApiError } from "../../../../../lib/errors/api.error.js";
import {
    BardatMatrix,
    BardatOutletSummary,
    BardatPreviewRow,
    ResponseBardatPreviewDTO,
    ResponseBardatPreviewDetailDTO,
} from "./import.schema.js";
import { BardatImportCacheService } from "./import.cache.js";
import { periodsFromRows, unpivotBardat } from "./import.parser.js";

const LOCK_PREFIX = "bardat:import:lock:";
const LOCK_TTL_SECONDS = 120;
const MAX_LOGICAL_ROWS = 50_000;

type CachePayload = ResponseBardatPreviewDetailDTO & { status: "preview" | "executing" };

async function acquireLock(importId: string): Promise<boolean> {
    return (await redisClient.set(`${LOCK_PREFIX}${importId}`, "1", "EX", LOCK_TTL_SECONDS, "NX")) === "OK";
}

async function releaseLock(importId: string): Promise<void> {
    await redisClient.del(`${LOCK_PREFIX}${importId}`);
}

export class BardatService {
    static async preview(matrix: BardatMatrix): Promise<ResponseBardatPreviewDTO> {
        const rows = unpivotBardat(matrix);
        if (rows.length > MAX_LOGICAL_ROWS) {
            throw new ApiError(413, `File menghasilkan lebih dari ${MAX_LOGICAL_ROWS} baris data`);
        }
        const productCodes = [...new Set(rows.map((row) => row.product_code))];
        const outletCodes = [...new Set(rows.map((row) => row.outlet_code))];
        const [products, outlets] = await Promise.all([
            prisma.product.findMany({ where: { code: { in: productCodes }, deleted_at: null }, select: { id: true, code: true } }),
            prisma.outlet.findMany({ where: { code: { in: outletCodes }, deleted_at: null }, select: { id: true, code: true, name: true } }),
        ]);
        const productMap = new Map(products.map((item) => [item.code, item]));
        const outletMap = new Map(outlets.map((item) => [item.code, item]));
        for (const row of rows) {
            const product = productMap.get(row.product_code);
            const outlet = outletMap.get(row.outlet_code);
            row.product_id = product?.id ?? null;
            row.outlet_id = outlet?.id ?? null;
            if (!product) row.errors.push("Produk tidak ditemukan");
            if (!outlet) row.errors.push("Outlet tidak ditemukan");
        }
        const mergedRows = new Map<string, BardatPreviewRow>();
        for (const row of rows) {
            const key = `${row.outlet_code}|${row.product_code}|${row.date}`;
            const existing = mergedRows.get(key);
            if (!existing) {
                mergedRows.set(key, row);
                continue;
            }
            existing.quantity += row.quantity;
            existing.errors = [...new Set([...existing.errors, ...row.errors])];
        }
        const normalizedRows = [...mergedRows.values()];
        const summaries = this.summarize(normalizedRows, outletMap);
        const periods = periodsFromRows(normalizedRows);
        const import_id = randomUUID();
        const payload: CachePayload = {
            status: "preview", import_id, total: normalizedRows.length,
            valid: normalizedRows.filter((row) => row.errors.length === 0).length,
            invalid: normalizedRows.filter((row) => row.errors.length > 0).length,
            periods, summaries, rows: normalizedRows, createdAt: Date.now(),
        };
        await BardatImportCacheService.save(import_id, payload);
        return this.publicPreview(payload);
    }

    private static summarize(rows: BardatPreviewRow[], outlets: Map<string, { id: number; code: string; name: string }>): BardatOutletSummary[] {
        const grouped = new Map<string, BardatPreviewRow[]>();
        for (const row of rows) grouped.set(row.outlet_code, [...(grouped.get(row.outlet_code) ?? []), row]);
        return [...grouped.entries()].map(([outlet_code, values]) => {
            const valid = values.filter((row) => row.errors.length === 0);
            const dates = values.map((row) => row.date).filter(Boolean).sort();
            return {
                outlet_code, outlet_name: outlets.get(outlet_code)?.name ?? null,
                matched_sku: new Set(values.filter((row) => row.product_id !== null).map((row) => row.product_code)).size,
                unmatched_sku: new Set(values.filter((row) => row.product_id === null).map((row) => row.product_code)).size,
                valid_rows: valid.length, invalid_rows: values.length - valid.length,
                first_date: dates[0] ?? null, last_date: dates.at(-1) ?? null,
            };
        }).sort((a, b) => a.outlet_code.localeCompare(b.outlet_code));
    }

    private static publicPreview(payload: CachePayload): ResponseBardatPreviewDTO {
        const { rows: _rows, createdAt: _createdAt, status: _status, ...preview } = payload;
        return preview;
    }

    static async getPreview(import_id: string): Promise<ResponseBardatPreviewDetailDTO> {
        const cache = await BardatImportCacheService.get<CachePayload>(import_id);
        if (!cache) throw new ApiError(404, "Preview import tidak ditemukan atau sudah kadaluarsa");
        if (cache.status !== "preview") throw new ApiError(409, "Import sedang atau sudah dieksekusi");
        return { ...this.publicPreview(cache), rows: cache.rows, createdAt: cache.createdAt };
    }

    static async execute(import_id: string): Promise<{ import_id: string; total: number; periods: CachePayload["periods"] }> {
        if (!(await acquireLock(import_id))) throw new ApiError(409, "Import sedang diproses, coba lagi sebentar");
        try {
            const cache = await BardatImportCacheService.get<CachePayload>(import_id);
            if (!cache) throw new ApiError(400, "Import session tidak ditemukan atau sudah kadaluarsa");
            if (cache.status !== "preview") throw new ApiError(409, "Import sudah pernah dijalankan");
            const validRows = cache.rows.filter((row) => row.errors.length === 0);
            if (!validRows.length) throw new ApiError(400, "Tidak ada baris valid untuk diimport");
            if (validRows.some((row) => row.product_id === null || row.outlet_id === null)) {
                throw new ApiError(400, "Preview berisi ID produk atau outlet yang tidak valid");
            }
            await BardatImportCacheService.save(import_id, { ...cache, status: "executing" });
            try {
                await this.replaceLedger(validRows, cache.periods, import_id);
                await BardatImportCacheService.remove(import_id);
                return { import_id, total: validRows.length, periods: cache.periods };
            } catch (error) {
                await BardatImportCacheService.save(import_id, cache);
                throw error;
            }
        } finally { await releaseLock(import_id); }
    }

    private static async replaceLedger(rows: BardatPreviewRow[], periods: CachePayload["periods"], importBatchId: string): Promise<void> {
        await prisma.$transaction(async (tx) => {
            const periodWhere = periods.map((period) => ({ month: period.month, year: period.year }));
            const existing = await tx.outletInventory.findMany({ where: { OR: periodWhere }, select: { outlet_id: true, product_id: true, month: true, year: true } });
            await tx.outletGoodsReceipt.deleteMany({ where: { OR: periodWhere } });
            await tx.outletGoodsReceipt.createMany({ data: rows.map((row) => ({
                outlet_id: row.outlet_id!, product_id: row.product_id!,
                date: new Date(`${row.date}T00:00:00.000Z`), month: Number(row.date.slice(5, 7)), year: Number(row.date.slice(0, 4)),
                quantity: new Prisma.Decimal(row.quantity), import_batch_id: importBatchId,
            })) });
            const aggregates = await tx.outletGoodsReceipt.groupBy({ by: ["outlet_id", "product_id", "month", "year"], where: { OR: periodWhere }, _sum: { quantity: true } });
            const keys = new Set(existing.map((item) => `${item.outlet_id}|${item.product_id}|${item.month}|${item.year}`));
            for (const aggregate of aggregates) {
                const key = {
                    outlet_id: aggregate.outlet_id,
                    product_id: aggregate.product_id,
                    month: aggregate.month,
                    year: aggregate.year,
                };
                keys.delete(`${key.outlet_id}|${key.product_id}|${key.month}|${key.year}`);
                await tx.outletInventory.upsert({ where: { outlet_id_product_id_month_year: key }, update: { quantity: aggregate._sum.quantity ?? 0 }, create: { ...key, quantity: aggregate._sum.quantity ?? 0 } });
            }
            for (const key of keys) {
                const parts = key.split("|").map(Number);
                const outlet_id = parts[0];
                const product_id = parts[1];
                const month = parts[2];
                const year = parts[3];
                if (outlet_id === undefined || product_id === undefined || month === undefined || year === undefined) continue;
                if ([outlet_id, product_id, month, year].some((value) => Number.isNaN(value))) continue;
                await tx.outletInventory.update({ where: { outlet_id_product_id_month_year: { outlet_id, product_id, month, year } }, data: { quantity: 0 } });
            }
        });
    }
}
