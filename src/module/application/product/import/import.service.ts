import { randomUUID } from "crypto";
import { redisClient } from "../../../../config/redis.js";
import { GENDER } from "../../../../generated/prisma/client.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { normalizeSlug } from "../../../../lib/index.js";
import { ImportCacheService } from "../../../../lib/utils/import.cache.js";
import {
    PRODUCT_IMPORT_HEADERS,
    ImportJobState,
    ProductImportPreviewDTO,
    ProductImportRowSchema,
    ResponseEnqueueProductImportDTO,
    ResponseImportStatusDTO,
    ResponseProductImportDTO,
} from "./import.schema.js";
import {
    enqueueProductImport,
    productImportQueue,
} from "./queue/product-import.queue.js";

const CACHE_PREFIX = "product:import:";
const LOCK_TTL_SECONDS = 60;

type ImportCachePayload = {
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

const TERMINAL_STATES = new Set<ImportJobState>(["completed", "failed"]);

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
            createdAt: Date.now(),
            total,
            valid,
            invalid,
            rows: parsedRows,
        };
        await ImportCacheService.save(CACHE_PREFIX, import_id, payload);

        return { import_id, total, valid, invalid };
    }

    static async execute(import_id: string): Promise<ResponseEnqueueProductImportDTO> {
        if (!(await acquireLock(import_id))) {
            throw new ApiError(409, "Import sedang diproses, coba lagi sebentar");
        }

        try {
            const cache = await ImportCacheService.get<ImportCachePayload>(
                CACHE_PREFIX,
                import_id,
            );

            if (!cache) {
                throw new ApiError(400, "Import session tidak ditemukan atau sudah kadaluarsa");
            }
            if (cache.valid <= 0) {
                throw new ApiError(400, "Tidak ada baris valid untuk diimport");
            }

            const job = await enqueueProductImport(import_id);
            return { import_id, jobId: String(job.id ?? import_id), state: "queued" };
        } catch (err) {
            await releaseLock(import_id);
            throw err;
        }
    }

    static async getStatus(import_id: string): Promise<ResponseImportStatusDTO> {
        const job = await productImportQueue.getJob(import_id);
        if (!job) throw new ApiError(404, "Import job tidak ditemukan");

        const rawState = await job.getState();
        const state: ImportJobState =
            rawState === "waiting" ? "queued" : (rawState as ImportJobState);

        const progress = typeof job.progress === "number" ? job.progress : 0;
        const response: ResponseImportStatusDTO = { import_id, state, progress };

        if (state === "completed" && job.returnvalue) {
            response.result = job.returnvalue as { import_id: string; total: number };
        }
        if (state === "failed") {
            response.failedReason = job.failedReason ?? "Unknown error";
            response.attemptsMade = job.attemptsMade ?? 0;
        }

        if (TERMINAL_STATES.has(state)) {
            await releaseLock(import_id).catch(() => undefined);
        }

        return response;
    }

    static async getPreview(import_id: string) {
        const cache = await ImportCacheService.get<ImportCachePayload>(CACHE_PREFIX, import_id);

        if (!cache) {
            throw new ApiError(404, "Preview import tidak ditemukan atau sudah kadaluarsa");
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
