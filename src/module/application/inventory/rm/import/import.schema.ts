import z from "zod";
import { RawMaterialSource } from "../../../../../generated/prisma/client.js";

const sanitizeNumber = (val: unknown): number => {
    if (val === "" || val === null || val === undefined) return 0;
    if (typeof val === "number") return val;
    if (typeof val === "string") {
        const cleaned = val.replace(/[%,\s]/g, "").trim();
        const num = Number(cleaned);
        return isNaN(num) ? 0 : num;
    }
    return Number(val);
};

const sanitizeString = (val: unknown): string | undefined => {
    if (val === null || val === undefined) return undefined;
    const str = String(val).trim();
    return str === "" ? undefined : str;
};

export const RM_IMPORT_HEADERS = {
    barcode: "BARCODE",
    name: "MATERIAL NAME",
    category: "CATEGORY",
    unit: "UOM",
    moq: "MOQ",
    minStock: "MIN STOCK",
    leadTime: "LEAD TIME",
    supplier: "SUPPLIER",
    source: "LOCAL/IMPORT",
    country: "COUNTRY",
    price: "PRICE",
} as const;

export const RMImportRowSchema = z.object({
    [RM_IMPORT_HEADERS.barcode]: z.string().min(1, "Barcode wajib diisi").max(50),
    [RM_IMPORT_HEADERS.name]: z.string().min(1, "Material name wajib diisi").max(255),
    [RM_IMPORT_HEADERS.category]: z.string().min(1, "Kategori wajib diisi").max(255),
    [RM_IMPORT_HEADERS.unit]: z.preprocess(sanitizeString, z.string().max(100).optional()),
    [RM_IMPORT_HEADERS.moq]: z.preprocess(sanitizeNumber, z.coerce.number().min(0).optional().default(0)),
    [RM_IMPORT_HEADERS.minStock]: z.preprocess(sanitizeNumber, z.coerce.number().min(0).optional().default(0)),
    [RM_IMPORT_HEADERS.leadTime]: z.preprocess(sanitizeNumber, z.coerce.number().int().min(0).optional().default(0)),
    [RM_IMPORT_HEADERS.supplier]: z.preprocess(sanitizeString, z.string().max(100).optional()),
    [RM_IMPORT_HEADERS.source]: z.preprocess(sanitizeString, z.string().max(20).optional()),
    [RM_IMPORT_HEADERS.country]: z.preprocess(sanitizeString, z.string().max(100).optional()),
    [RM_IMPORT_HEADERS.price]: z.preprocess(sanitizeNumber, z.coerce.number().min(0).optional().default(0)),
});

export const RequestExecuteRMImportSchema = z.object({
    import_id: z.string().uuid("Import ID tidak valid"),
});

export type RMImportRow = z.infer<typeof RMImportRowSchema>;
export type RequestExecuteRMImportDTO = z.infer<typeof RequestExecuteRMImportSchema>;

export type RMImportPreviewDTO = {
    barcode: string;
    name: string;
    category: string;
    unit: string;
    min_buy: number;
    min_stock: number;
    lead_time: number;
    supplier: string | null;
    source: RawMaterialSource;
    country: string;
    price: number;
    errors: string[];
};

export type ResponseRMImportDTO = {
    import_id: string;
    total: number;
    valid: number;
    invalid: number;
};

export type ResponseEnqueueRMImportDTO = {
    import_id: string;
    jobId: string;
    state: "queued";
};

export type ImportJobState =
    | "queued"
    | "active"
    | "completed"
    | "failed"
    | "delayed"
    | "waiting-children"
    | "prioritized"
    | "unknown";

export type ResponseRMImportStatusDTO = {
    import_id: string;
    state: ImportJobState;
    progress: number;
    result?: { import_id: string; total: number };
    failedReason?: string;
    attemptsMade?: number;
};
