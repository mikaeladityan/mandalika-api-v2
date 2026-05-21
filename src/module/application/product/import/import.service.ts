import { randomUUID } from "crypto";
import prisma from "../../../../config/prisma.js";
import { redisClient } from "../../../../config/redis.js";
import { GENDER } from "../../../../generated/prisma/client.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { normalizeSlug } from "../../../../lib/index.js";
import { ImportCacheService } from "../../../../lib/utils/import.cache.js";
import {
    PRODUCT_IMPORT_HEADERS,
    ProductImportPreviewDTO,
    ProductImportRowSchema,
    ResponseProductImportDTO,
} from "./import.schema.js";

const CACHE_PREFIX = "product:import:";
const LOCK_TTL_SECONDS = 60;

type ImportCachePayload = {
    status: "preview" | "executing";
    createdAt: number;
    total: number;
    valid: number;
    invalid: number;
    rows: ProductImportPreviewDTO[];
};

function mapGender(value: string = ""): GENDER {
    const v = value.toLowerCase().trim();
    if (v === "woman" || v === "women") return GENDER.WOMEN;
    if (v === "man" || v === "men") return GENDER.MEN;
    return GENDER.UNISEX;
}

function errorRow(raw: Record<string, unknown>, errors: string[]): ProductImportPreviewDTO {
    return {
        code: String(raw[PRODUCT_IMPORT_HEADERS.code] ?? ""),
        name: String(raw[PRODUCT_IMPORT_HEADERS.name] ?? ""),
        gender: GENDER.UNISEX,
        size: 0,
        type: null,
        unit: null,
        distribution_percentage: 0,
        safety_percentage: 0,
        errors,
    };
}

function parseRow(raw: Record<string, unknown>): ProductImportPreviewDTO {
    const parsed = ProductImportRowSchema.safeParse(raw);
    if (!parsed.success) {
        return errorRow(
            raw,
            parsed.error.issues.map((e) => e.message),
        );
    }
    const d = parsed.data;
    return {
        code: d[PRODUCT_IMPORT_HEADERS.code].trim(),
        name: d[PRODUCT_IMPORT_HEADERS.name].trim(),
        gender: mapGender(d[PRODUCT_IMPORT_HEADERS.gender]),
        size: d[PRODUCT_IMPORT_HEADERS.size],
        type: normalizeSlug(d[PRODUCT_IMPORT_HEADERS.type]),
        unit: normalizeSlug(d[PRODUCT_IMPORT_HEADERS.unit]),
        distribution_percentage: d[PRODUCT_IMPORT_HEADERS.distribution],
        safety_percentage: d[PRODUCT_IMPORT_HEADERS.safety],
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

export class ProductImportService {
    static async preview(
        rows: Array<Record<string, unknown>>,
    ): Promise<ResponseProductImportDTO> {
        const parsedRows = rows.map(parseRow);
        const total = parsedRows.length;
        const invalid = parsedRows.filter((r) => r.errors.length > 0).length;
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

        await ImportCacheService.save(CACHE_PREFIX, import_id, payload);

        return { import_id, total, valid, invalid };
    }

    static async execute(import_id: string): Promise<{ import_id: string; total: number }> {
        const cache = (await ImportCacheService.get(
            CACHE_PREFIX,
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

        if (!(await acquireLock(import_id))) {
            throw new ApiError(409, "Import sedang diproses, coba lagi sebentar");
        }

        try {
            await ImportCacheService.save(CACHE_PREFIX, import_id, {
                ...cache,
                status: "executing",
            });
            await this.bulkInsert(validRows);
            await ImportCacheService.remove(CACHE_PREFIX, import_id);
            return { import_id, total: validRows.length };
        } catch (err) {
            // Rollback cache status sehingga user bisa retry execute
            await ImportCacheService.save(CACHE_PREFIX, import_id, cache);
            throw err;
        } finally {
            await releaseLock(import_id);
        }
    }

    static async getPreview(import_id: string) {
        const cache = (await ImportCacheService.get(
            CACHE_PREFIX,
            import_id,
        )) as ImportCachePayload | null;

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

    private static async bulkInsert(data: ProductImportPreviewDTO[]) {
        if (!data.length) return;

        const dedupped = new Map<string, ProductImportPreviewDTO>();
        for (const d of data) {
            if (d.code?.trim()) dedupped.set(d.code.trim(), d);
        }
        const finalData = Array.from(dedupped.values());

        const types = [...new Set(finalData.map((d) => d.type).filter(Boolean))] as string[];
        const units = [...new Set(finalData.map((d) => d.unit).filter(Boolean))] as string[];
        const sizes = [...new Set(finalData.map((d) => d.size).filter((s) => s > 0))];

        await prisma.$transaction(async (tx) => {
            if (types.length) {
                await tx.$executeRaw`
                    INSERT INTO product_types (name, slug)
                    SELECT initcap(replace(t.slug, '-', ' ')), t.slug
                    FROM unnest(${types}::text[]) AS t(slug)
                    ON CONFLICT (slug) DO NOTHING;
                `;
            }

            if (units.length) {
                await tx.$executeRaw`
                    INSERT INTO unit_of_materials (name, slug)
                    SELECT initcap(replace(u.slug, '-', ' ')), u.slug
                    FROM unnest(${units}::text[]) AS u(slug)
                    ON CONFLICT (slug) DO NOTHING;
                `;
            }

            if (sizes.length) {
                await tx.$executeRaw`
                    INSERT INTO product_size (size)
                    SELECT s.val
                    FROM unnest(${sizes}::int[]) AS s(val)
                    ON CONFLICT (size) DO NOTHING;
                `;
            }

            const cols = {
                codes: finalData.map((d) => d.code),
                names: finalData.map((d) => d.name),
                genders: finalData.map((d) => d.gender || GENDER.UNISEX),
                prodSizes: finalData.map((d) => d.size || null),
                typeSlugs: finalData.map((d) => d.type || null),
                unitSlugs: finalData.map((d) => d.unit || null),
                distributionPercs: finalData.map((d) => d.distribution_percentage || 0),
                safetyPercs: finalData.map((d) => d.safety_percentage || 0),
            };

            await tx.$executeRaw`
                INSERT INTO products (
                    code, name, gender, size_id, type_id, unit_id,
                    distribution_percentage, safety_percentage,
                    status, updated_at
                )
                SELECT
                    p.code,
                    p.name,
                    p.gender::"GENDER",
                    ps.id,
                    pt.id,
                    u.id,
                    p.dist_perc,
                    p.safe_perc,
                    'ACTIVE'::"STATUS",
                    NOW()
                FROM unnest(
                    ${cols.codes}::text[],
                    ${cols.names}::text[],
                    ${cols.genders}::text[],
                    ${cols.prodSizes}::int[],
                    ${cols.typeSlugs}::text[],
                    ${cols.unitSlugs}::text[],
                    ${cols.distributionPercs}::decimal[],
                    ${cols.safetyPercs}::decimal[]
                ) AS p(code, name, gender, prod_size, type_slug, unit_slug, dist_perc, safe_perc)
                LEFT JOIN product_size ps ON ps.size = p.prod_size
                LEFT JOIN product_types pt ON pt.slug = p.type_slug
                LEFT JOIN unit_of_materials u ON u.slug = p.unit_slug
                ON CONFLICT (code) DO UPDATE SET
                    name = EXCLUDED.name,
                    gender = EXCLUDED.gender,
                    size_id = EXCLUDED.size_id,
                    type_id = EXCLUDED.type_id,
                    unit_id = EXCLUDED.unit_id,
                    distribution_percentage = EXCLUDED.distribution_percentage,
                    safety_percentage = EXCLUDED.safety_percentage,
                    updated_at = NOW();
            `;
        });
    }
}
