import { randomUUID } from "crypto";
import { redisClient } from "../../../../../config/redis.js";
import { RawMaterialSource } from "../../../../../generated/prisma/client.js";
import { ApiError } from "../../../../../lib/errors/api.error.js";
import { ImportCacheService } from "../../../../../lib/utils/import.cache.js";
import {
    ImportJobState,
    RM_IMPORT_HEADERS,
    RMImportPreviewDTO,
    RMImportRowSchema,
    ResponseEnqueueRMImportDTO,
    ResponseRMImportDTO,
    ResponseRMImportStatusDTO,
} from "./import.schema.js";
import { enqueueRMImport, rmImportQueue } from "./queue/rm-import.queue.js";

const CACHE_PREFIX = "rm:import:";
const LOCK_TTL_SECONDS = 60;

type ImportCachePayload = {
    createdAt: number;
    total: number;
    valid: number;
    invalid: number;
    rows: RMImportPreviewDTO[];
};

function mapSource(value: string | undefined): RawMaterialSource {
    if (!value) return RawMaterialSource.LOCAL;
    const v = value.toUpperCase().trim();
    if (v === "IMPORT") return RawMaterialSource.IMPORT;
    return RawMaterialSource.LOCAL;
}

function errorRow(raw: Record<string, unknown>, errors: string[]): RMImportPreviewDTO {
    return {
        barcode: String(raw[RM_IMPORT_HEADERS.barcode] ?? ""),
        name: String(raw[RM_IMPORT_HEADERS.name] ?? ""),
        category: "",
        unit: "",
        min_buy: 0,
        min_stock: 0,
        lead_time: 0,
        supplier: null,
        source: RawMaterialSource.LOCAL,
        country: "",
        price: 0,
        errors,
    };
}

function parseRow(raw: Record<string, unknown>): RMImportPreviewDTO {
    const parsed = RMImportRowSchema.safeParse(raw);
    if (!parsed.success) {
        return errorRow(
            raw,
            parsed.error.issues.map((e) => e.message),
        );
    }
    const d = parsed.data;
    const supplier = d[RM_IMPORT_HEADERS.supplier];
    return {
        barcode: d[RM_IMPORT_HEADERS.barcode].trim(),
        name: d[RM_IMPORT_HEADERS.name].trim(),
        category: d[RM_IMPORT_HEADERS.category].toUpperCase().trim(),
        unit: d[RM_IMPORT_HEADERS.unit].toUpperCase().trim(),
        min_buy: d[RM_IMPORT_HEADERS.moq],
        min_stock: d[RM_IMPORT_HEADERS.minStock],
        lead_time: d[RM_IMPORT_HEADERS.leadTime],
        supplier: supplier ? supplier.toUpperCase().trim() : null,
        source: mapSource(d[RM_IMPORT_HEADERS.source]),
        country: d[RM_IMPORT_HEADERS.country] ?? "",
        price: d[RM_IMPORT_HEADERS.price],
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

const STATE_MAP: Record<string, ImportJobState> = {
    waiting: "queued",
    delayed: "delayed",
    active: "active",
    completed: "completed",
    failed: "failed",
    "waiting-children": "waiting-children",
    prioritized: "prioritized",
};

function isImportJobResult(v: unknown): v is { import_id: string; total: number } {
    if (typeof v !== "object" || v === null) return false;
    const r = v as Record<string, unknown>;
    return typeof r.import_id === "string" && typeof r.total === "number";
}

export class RMImportService {
    static async preview(rows: Array<Record<string, unknown>>): Promise<ResponseRMImportDTO> {
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

    static async execute(import_id: string): Promise<ResponseEnqueueRMImportDTO> {
        if (!(await acquireLock(import_id))) {
            throw new ApiError(409, "Import sedang diproses, coba lagi sebentar");
        }

        try {
            const cache = await ImportCacheService.get<ImportCachePayload>(CACHE_PREFIX, import_id);

            if (!cache) {
                throw new ApiError(400, "Import session tidak ditemukan atau sudah kadaluarsa");
            }

            if (cache.valid <= 0) {
                throw new ApiError(400, "Tidak ada baris valid untuk diimport");
            }

            const job = await enqueueRMImport(import_id);
            return { import_id, jobId: String(job.id ?? import_id), state: "queued" };
        } catch (err) {
            await releaseLock(import_id);
            throw err;
        }
    }

    static async getStatus(import_id: string): Promise<ResponseRMImportStatusDTO> {
        const job = await rmImportQueue.getJob(import_id);
        if (!job) {
            throw new ApiError(404, "Import job tidak ditemukan");
        }
        const rawState = await job.getState();
        const state: ImportJobState = STATE_MAP[rawState] ?? "unknown";

        const progressNum = typeof job.progress === "number" ? job.progress : 0;
        const response: ResponseRMImportStatusDTO = {
            import_id,
            state,
            progress: progressNum,
        };

        if (state === "completed" && isImportJobResult(job.returnvalue)) {
            response.result = job.returnvalue;
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
