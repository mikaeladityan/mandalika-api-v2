import { randomUUID } from "crypto";
import prisma from "../../../../../config/prisma.js";
import { GENDER } from "../../../../../generated/prisma/client.js";
import { STATUS } from "../../../../../generated/prisma/enums.js";
import { normalizeSlug } from "../../../../../lib/index.js";
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

type ImportCachePayload = {
    status: "preview" | "executing";
    createdAt: number;
    total: number;
    valid: number;
    invalid: number;
    rows: FGImportPreviewDTO[];
};

export class FGImportService {
    private static mapGender(value: string = ""): GENDER {
        const normalized = value.toLowerCase();
        if (["woman", "women"].includes(normalized)) return GENDER.WOMEN;
        if (["man", "men"].includes(normalized)) return GENDER.MEN;
        return GENDER.UNISEX;
    }

    static async preview(rows: Array<Record<string, unknown>>): Promise<ResponseFGImportDTO> {
        const parsedResults = rows.map((row) => FGImportRowSchema.safeParse(row));
        const parsedRows: FGImportPreviewDTO[] = rows.map((row, index) => {
            const parsed = parsedResults[index];
            if (!parsed) {
                return {
                    code: String(row["PRODUCT CODE"] ?? ""),
                    name: String(row["PRODUCT NAME"] ?? ""),
                    gender: GENDER.UNISEX,
                    size: 0,
                    type: null,
                    unit: null,
                    distribution_percentage: 0,
                    safety_percentage: 0,
                    errors: ["Internal parsing error"],
                };
            }

            if (!parsed.success) {
                return {
                    code: String(row["PRODUCT CODE"] ?? ""),
                    name: String(row["PRODUCT NAME"] ?? ""),
                    gender: GENDER.UNISEX,
                    size: 0,
                    type: null,
                    unit: null,
                    distribution_percentage: 0,
                    safety_percentage: 0,
                    errors: parsed.error.issues.map((e) => e.message),
                };
            }

            const {
                "PRODUCT CODE": code,
                "PRODUCT NAME": name,
                GENDER: gender,
                SIZE,
                TYPE,
                UOM,
                EDAR,
                SAFETY,
            } = parsed.data;

            return {
                code: code.trim(),
                name: name.trim(),
                gender: this.mapGender(gender),
                size: SIZE,
                type: normalizeSlug(TYPE),
                unit: normalizeSlug(UOM),
                distribution_percentage: EDAR,
                safety_percentage: SAFETY,
                errors: [],
            };
        });

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

    static async execute(import_id: string) {
        const cache = (await ImportCacheService.get(
            CACHE_PREFIX,
            import_id,
        )) as ImportCachePayload | null;

        if (!cache || cache.status !== "preview") {
            throw new ApiError(400, "Import session expired, not found, or already executed");
        }

        const validRows = cache.rows.filter((r) => r.errors.length === 0);
        if (!validRows.length) {
            throw new ApiError(400, "Tidak ada baris valid untuk diimport");
        }

        await ImportCacheService.save(CACHE_PREFIX, import_id, { ...cache, status: "executing" });

        try {
            await this.bulkUpsert(validRows);
            await ImportCacheService.remove(CACHE_PREFIX, import_id);
            return { import_id, total: validRows.length };
        } catch (err) {
            await ImportCacheService.save(CACHE_PREFIX, import_id, cache);
            throw err;
        }
    }

    private static async bulkUpsert(data: FGImportPreviewDTO[]): Promise<void> {
        if (!data.length) return;

        const deduped = new Map<string, FGImportPreviewDTO>();
        for (const row of data) {
            const code = row.code?.trim();
            if (code) deduped.set(code, row);
        }
        const finalData = Array.from(deduped.values());

        await prisma.$transaction(async (tx) => {
            for (const row of finalData) {
                const [type_id, unit_id, size_id] = await Promise.all([
                    row.type ? getOrCreateSlug(tx.productType, row.type) : null,
                    row.unit ? getOrCreateSlug(tx.unit, row.unit) : null,
                    row.size > 0 ? getOrCreateSize(tx, row.size) : null,
                ]);

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
                        updated_at: new Date(),
                    },
                });
            }
        });
    }

    static async getPreview(import_id: string) {
        const cache = (await ImportCacheService.get(
            CACHE_PREFIX,
            import_id,
        )) as ImportCachePayload | null;

        if (!cache) throw new ApiError(404, "Import preview not found or expired");
        if (cache.status !== "preview") throw new ApiError(400, "Import already executed");

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
