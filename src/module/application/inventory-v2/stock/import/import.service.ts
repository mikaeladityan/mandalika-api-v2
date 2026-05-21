import { randomUUID } from "crypto";
import prisma from "../../../../../config/prisma.js";
import { redisClient } from "../../../../../config/redis.js";
import { ApiError } from "../../../../../lib/errors/api.error.js";
import {
    StockImportPreviewDTO,
    StockImportRowSchema,
    ResponseStockImportDTO,
} from "./import.schema.js";
import { StockImportCacheService } from "./import.cache.js";

const LOCK_PREFIX = "stock:import:lock:";
const LOCK_TTL_SECONDS = 60;

type ImportCachePayload = {
    status: "preview" | "executing";
    createdAt: number;
    total: number;
    valid: number;
    invalid: number;
    rows: StockImportPreviewDTO[];
};

function errorRow(raw: Record<string, unknown>, errors: string[]): StockImportPreviewDTO {
    return {
        code: String(raw["PRODUCT CODE"] ?? ""),
        product_id: 0,
        name: "",
        size: "",
        type: "",
        amount: 0,
        errors,
    };
}

async function acquireLock(importId: string): Promise<boolean> {
    const result = await redisClient.set(
        `${LOCK_PREFIX}${importId}`,
        "1",
        "EX",
        LOCK_TTL_SECONDS,
        "NX",
    );
    return result === "OK";
}

async function releaseLock(importId: string): Promise<void> {
    await redisClient.del(`${LOCK_PREFIX}${importId}`);
}

export class StockImportService {
    static async preview(
        rows: Array<Record<string, unknown>>,
    ): Promise<ResponseStockImportDTO> {
        const codes = rows
            .map((r) => r["PRODUCT CODE"])
            .filter((c): c is string => typeof c === "string" && c.trim().length > 0);

        const products = codes.length
            ? await prisma.product.findMany({
                  where: { code: { in: codes }, deleted_at: null },
                  select: {
                      id: true,
                      code: true,
                      name: true,
                      product_type: { select: { name: true } },
                      size: { select: { size: true } },
                  },
              })
            : [];

        const productMap = new Map(products.map((p) => [p.code, p]));

        const parsedRows: StockImportPreviewDTO[] = rows.map((row) => {
            const parsed = StockImportRowSchema.safeParse(row);
            if (!parsed.success) {
                return errorRow(
                    row,
                    parsed.error.issues.map((e) => e.message),
                );
            }
            const data = parsed.data;
            const product = productMap.get(data["PRODUCT CODE"]);

            if (!product) {
                return {
                    code: data["PRODUCT CODE"],
                    product_id: 0,
                    name: "",
                    size: "",
                    type: "",
                    amount: data["CURRENT STOCK"],
                    errors: ["Produk tidak ditemukan"],
                };
            }

            return {
                code: data["PRODUCT CODE"],
                product_id: product.id,
                name: product.name,
                size: product.size?.size?.toString() ?? "",
                type: product.product_type?.name ?? "",
                amount: data["CURRENT STOCK"],
                errors: [],
            };
        });

        const total = parsedRows.length;
        const invalid = parsedRows.filter((r) => r.errors.length).length;
        const valid = total - invalid;
        const import_id = randomUUID();

        const payload: ImportCachePayload = {
            status: "preview",
            createdAt: Date.now(),
            total,
            valid,
            invalid,
            rows: parsedRows,
        };

        await StockImportCacheService.save(import_id, payload);

        return { import_id, total, valid, invalid };
    }

    static async execute(
        import_id: string,
        warehouse_id: number,
        month: number,
        year: number,
    ): Promise<{ import_id: string; total: number }> {
        if (!(await acquireLock(import_id))) {
            throw new ApiError(409, "Import sedang diproses, coba lagi sebentar");
        }

        try {
            const cache = (await StockImportCacheService.get(
                import_id,
            )) as ImportCachePayload | null;

            if (!cache) {
                throw new ApiError(400, "Import session tidak ditemukan atau sudah kadaluarsa");
            }
            if (cache.status !== "preview") {
                throw new ApiError(409, "Import sudah pernah dijalankan");
            }

            const validRows = cache.rows.filter((r) => r.errors.length === 0);
            if (!validRows.length) {
                throw new ApiError(400, "Tidak ada baris valid untuk diimport");
            }

            await StockImportCacheService.save(import_id, { ...cache, status: "executing" });

            try {
                await this.bulkInsert(validRows, warehouse_id, month, year);
                await StockImportCacheService.remove(import_id);
                return { import_id, total: validRows.length };
            } catch (err) {
                await StockImportCacheService.save(import_id, cache);
                throw err;
            }
        } finally {
            await releaseLock(import_id);
        }
    }

    private static async bulkInsert(
        data: StockImportPreviewDTO[],
        warehouse_id: number,
        month: number,
        year: number,
    ) {
        if (!data.length) return;

        const productIds = data.map((d) => d.product_id);
        const amounts = data.map((d) => d.amount);

        await prisma.$executeRaw`
            INSERT INTO product_inventories (
                product_id,
                warehouse_id,
                quantity,
                date,
                month,
                year,
                created_at,
                updated_at
            )
            SELECT
                s.product_id,
                ${warehouse_id}::int,
                s.quantity,
                1,
                ${month}::int,
                ${year}::int,
                NOW(),
                NOW()
            FROM (
                SELECT
                    unnest(${productIds}::int[])   AS product_id,
                    unnest(${amounts}::numeric[])  AS quantity
            ) s
            ON CONFLICT (product_id, warehouse_id, date, month, year)
            DO UPDATE SET
                quantity = EXCLUDED.quantity,
                updated_at = NOW();
        `;
    }

    static async getPreview(import_id: string) {
        const cache = (await StockImportCacheService.get(import_id)) as ImportCachePayload | null;

        if (!cache) {
            throw new ApiError(404, "Preview import tidak ditemukan atau sudah kadaluarsa");
        }
        if (cache.status !== "preview") {
            throw new ApiError(409, "Import sudah dieksekusi");
        }

        return {
            import_id,
            total: cache.total,
            valid: cache.valid,
            invalid: cache.invalid,
            rows: cache.rows,
            createdAt: cache.createdAt,
        };
    }
}
