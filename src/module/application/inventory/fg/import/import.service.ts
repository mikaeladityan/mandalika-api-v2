import { randomUUID } from "crypto";
import prisma from "../../../../../config/prisma.js";
import { redisClient } from "../../../../../config/redis.js";
import { GENDER } from "../../../../../generated/prisma/client.js";
import { STATUS } from "../../../../../generated/prisma/enums.js";
import { ApiError } from "../../../../../lib/errors/api.error.js";
import { ImportCacheService } from "../../../../../lib/utils/import.cache.js";
import { getOrCreateSlug } from "../../../../../lib/utils/upsert-slug.js";
import { getOrCreateSize } from "../../../../../lib/utils/upsert-size.js";
import {
    FGImportPreviewDTO,
    FGImportRowSchema,
    ResponseFGImportDTO,
} from "./import.schema.js";

const CACHE_PREFIX = "fg:import:";
const LOCK_TTL_SECONDS = 60;
const TRANSACTION_TIMEOUT_MS = 60_000;

type ImportCachePayload = {
    createdAt: number;
    total: number;
    valid: number;
    invalid: number;
    rows: FGImportPreviewDTO[];
};

function mapGender(value: string): GENDER {
    const normalized = value.toLowerCase();
    if (normalized === "woman" || normalized === "women") return GENDER.WOMEN;
    if (normalized === "man" || normalized === "men") return GENDER.MEN;
    return GENDER.UNISEX;
}

function errorRow(raw: Record<string, unknown>, errors: string[]): FGImportPreviewDTO {
    return {
        code: String(raw["PRODUCT CODE"] ?? ""),
        name: String(raw["PRODUCT NAME"] ?? ""),
        gender: GENDER.UNISEX,
        size: 0,
        type: null,
        unit: null,
        distribution_percentage: 0,
        safety_percentage: 0,
        errors,
    };
}

function parseRow(raw: Record<string, unknown>): FGImportPreviewDTO {
    const parsed = FGImportRowSchema.safeParse(raw);
    if (!parsed.success) {
        return errorRow(raw, parsed.error.issues.map((e) => e.message));
    }
    const d = parsed.data;
    return {
        code: d["PRODUCT CODE"].trim(),
        name: d["PRODUCT NAME"].trim(),
        gender: mapGender(d.GENDER),
        size: d.SIZE,
        type: d.TYPE.trim(),
        unit: d.UOM.trim(),
        distribution_percentage: d.EDAR,
        safety_percentage: d.SAFETY,
        errors: [],
    };
}

async function acquireLock(importId: string): Promise<boolean> {
    const key = `${CACHE_PREFIX}lock:${importId}`;
    const result = await redisClient.set(key, "1", "EX", LOCK_TTL_SECONDS, "NX");
    return result === "OK";
}

async function releaseLock(importId: string): Promise<void> {
    await redisClient.del(`${CACHE_PREFIX}lock:${importId}`);
}

export class FGImportService {
    static async preview(rows: Array<Record<string, unknown>>): Promise<ResponseFGImportDTO> {
        const parsedRows = rows.map(parseRow);
        const total = parsedRows.length;
        const invalid = parsedRows.filter((r) => r.errors.length > 0).length;
        const valid = total - invalid;
        const import_id = randomUUID();

        const payload: ImportCachePayload = {
            createdAt: Date.now(),
            total,
            valid,
            invalid,
            rows: parsedRows,
        };
        await ImportCacheService.save(CACHE_PREFIX, import_id, payload);

        return { import_id, total, valid, invalid };
    }

    static async execute(import_id: string) {
        if (!(await acquireLock(import_id))) {
            throw new ApiError(409, "Import sedang diproses, coba lagi sebentar");
        }

        try {
            const cache = (await ImportCacheService.get(
                CACHE_PREFIX,
                import_id,
            )) as ImportCachePayload | null;

            if (!cache) {
                throw new ApiError(400, "Import session tidak ditemukan atau sudah kadaluarsa");
            }

            const validRows = cache.rows.filter((r) => r.errors.length === 0);
            if (!validRows.length) {
                throw new ApiError(400, "Tidak ada baris valid untuk diimport");
            }

            await this.bulkUpsert(validRows);
            await ImportCacheService.remove(CACHE_PREFIX, import_id);
            return { import_id, total: validRows.length };
        } finally {
            await releaseLock(import_id);
        }
    }

    private static async bulkUpsert(rows: FGImportPreviewDTO[]): Promise<void> {
        const deduped = new Map<string, FGImportPreviewDTO>();
        for (const row of rows) {
            const code = row.code?.trim();
            if (code) deduped.set(code, row);
        }
        const finalRows = Array.from(deduped.values());
        if (!finalRows.length) return;

        const uniqueTypes = [...new Set(finalRows.map((r) => r.type).filter((v): v is string => !!v))];
        const uniqueUnits = [...new Set(finalRows.map((r) => r.unit).filter((v): v is string => !!v))];
        const uniqueSizes = [...new Set(finalRows.map((r) => r.size).filter((v) => v > 0))];

        await prisma.$transaction(
            async (tx) => {
                const [typeIds, unitIds, sizeIds] = await Promise.all([
                    Promise.all(
                        uniqueTypes.map(async (name) =>
                            [name, await getOrCreateSlug(tx.productType, name)] as const,
                        ),
                    ).then((entries) => new Map(entries)),
                    Promise.all(
                        uniqueUnits.map(async (name) =>
                            [name, await getOrCreateSlug(tx.unit, name)] as const,
                        ),
                    ).then((entries) => new Map(entries)),
                    Promise.all(
                        uniqueSizes.map(async (size) =>
                            [size, await getOrCreateSize(tx, size)] as const,
                        ),
                    ).then((entries) => new Map(entries)),
                ]);

                for (const row of finalRows) {
                    const type_id = row.type ? typeIds.get(row.type) ?? null : null;
                    const unit_id = row.unit ? unitIds.get(row.unit) ?? null : null;
                    const size_id = row.size > 0 ? sizeIds.get(row.size) ?? null : null;

                    await tx.product.upsert({
                        where: { code: row.code },
                        create: {
                            code: row.code,
                            name: row.name,
                            gender: row.gender,
                            type_id,
                            unit_id,
                            size_id,
                            distribution_percentage: row.distribution_percentage,
                            safety_percentage: row.safety_percentage,
                            status: STATUS.ACTIVE,
                        },
                        update: {
                            name: row.name,
                            gender: row.gender,
                            type_id,
                            unit_id,
                            size_id,
                            distribution_percentage: row.distribution_percentage,
                            safety_percentage: row.safety_percentage,
                        },
                    });
                }
            },
            { timeout: TRANSACTION_TIMEOUT_MS },
        );
    }

    static async getPreview(import_id: string) {
        const cache = (await ImportCacheService.get(
            CACHE_PREFIX,
            import_id,
        )) as ImportCachePayload | null;

        if (!cache) {
            throw new ApiError(404, "Import preview tidak ditemukan atau sudah kadaluarsa");
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
