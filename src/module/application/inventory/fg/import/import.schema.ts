import z from "zod";
import { GENDER } from "../../../../../generated/prisma/client.js";

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

// Single source of truth untuk header CSV (import & export wajib pakai konstanta yang sama).
// Reference: dev-flow §1.I rule 1.
export const FG_IMPORT_HEADERS = {
    code: "PRODUCT CODE",
    name: "PRODUCT NAME",
    type: "TYPE",
    gender: "GENDER",
    size: "SIZE",
    distribution: "EDAR",
    safety: "SAFETY",
} as const;

export const FGImportRowSchema = z.object({
    [FG_IMPORT_HEADERS.code]: z.string().min(1).max(100),
    [FG_IMPORT_HEADERS.name]: z.string().min(1).max(200),
    [FG_IMPORT_HEADERS.type]: z.string().min(1).max(100),
    [FG_IMPORT_HEADERS.gender]: z.string().max(20).optional().default(""),
    [FG_IMPORT_HEADERS.size]: z.preprocess(sanitizeNumber, z.coerce.number().positive()),
    [FG_IMPORT_HEADERS.distribution]: z.preprocess(
        sanitizeNumber,
        z.coerce.number().min(0).optional().default(0),
    ),
    [FG_IMPORT_HEADERS.safety]: z.preprocess(
        sanitizeNumber,
        z.coerce.number().min(0).optional().default(0),
    ),
});

export const RequestExecuteFGImportSchema = z.object({
    import_id: z.string().uuid("Import ID tidak valid"),
});

export type FGImportRow = z.infer<typeof FGImportRowSchema>;
export type RequestExecuteFGImportDTO = z.infer<typeof RequestExecuteFGImportSchema>;

export type FGImportPreviewDTO = {
    code: string;
    name: string;
    gender: GENDER;
    size: number;
    type: string | null;
    distribution_percentage: number;
    safety_percentage: number;
    errors: string[];
};

export type ResponseFGImportDTO = {
    import_id: string;
    total: number;
    valid: number;
    invalid: number;
};

export type ResponseEnqueueFGImportDTO = {
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
