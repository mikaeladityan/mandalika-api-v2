import z from "zod";
import { GENDER } from "../../../../generated/prisma/client.js";

const sanitizeNumber = (val: unknown) => {
    if (val === "" || val === null || val === undefined) return 0;
    if (typeof val === "number") return val;
    if (typeof val === "string") {
        // Remove common symbols like %, comma (thousands separator), and spaces
        // But keep digits and the first decimal point
        const cleaned = val.replace(/[%,\s]/g, "").trim();
        const num = Number(cleaned);
        return isNaN(num) ? 0 : num;
    }
    return Number(val);
};

// Single source of truth untuk header round-trip (SOP §1.I).
// Export di product.service.ts WAJIB pakai konstanta ini — jangan duplikasi literal.
export const PRODUCT_IMPORT_HEADERS = {
    code: "PRODUCT CODE",
    name: "PRODUCT NAME",
    type: "TYPE",
    gender: "GENDER",
    size: "SIZE",
    unit: "UOM",
    distribution: "EDAR",
    safety: "SAFETY",
} as const;

export const ProductImportRowSchema = z.object({
    [PRODUCT_IMPORT_HEADERS.code]: z.string().min(1),
    [PRODUCT_IMPORT_HEADERS.name]: z.string().min(1),
    [PRODUCT_IMPORT_HEADERS.type]: z.string().min(1),
    [PRODUCT_IMPORT_HEADERS.gender]: z.string().optional().default(""),
    [PRODUCT_IMPORT_HEADERS.size]: z.preprocess(sanitizeNumber, z.coerce.number().positive()),
    [PRODUCT_IMPORT_HEADERS.unit]: z.string().min(1),
    [PRODUCT_IMPORT_HEADERS.distribution]: z.preprocess(sanitizeNumber, z.coerce.number().min(0).optional().default(0)),
    [PRODUCT_IMPORT_HEADERS.safety]: z.preprocess(sanitizeNumber, z.coerce.number().min(0).optional().default(0)),
});

export type ProductImportRow = z.infer<typeof ProductImportRowSchema>;
export type ProductImportPreviewDTO = {
    code: string;
    name: string;
    gender: GENDER;
    size: number;
    type: string | null;
    unit: string | null;
    distribution_percentage: number;
    safety_percentage: number;
    errors: string[];
};

export type ResponseProductImportDTO = {
    import_id: string;
    total: number;
    valid: number;
    invalid: number;
};

export const ExecuteImportSchema = z.object({
    import_id: z.string().uuid("Import ID tidak valid"),
});

export type ExecuteImportDTO = z.infer<typeof ExecuteImportSchema>;

export type ResponseEnqueueProductImportDTO = {
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

export type ResponseImportStatusDTO = {
    import_id: string;
    state: ImportJobState;
    progress: number;
    result?: { import_id: string; total: number };
    failedReason?: string;
    attemptsMade?: number;
};
