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

export const FGImportRowSchema = z.object({
    "PRODUCT CODE": z.string().min(1).max(100),
    "PRODUCT NAME": z.string().min(1).max(200),
    TYPE: z.string().min(1).max(100),
    GENDER: z.string().max(20).optional().default(""),
    SIZE: z.preprocess(sanitizeNumber, z.coerce.number().positive()),
    UOM: z.string().min(1).max(50),
    EDAR: z.preprocess(sanitizeNumber, z.coerce.number().min(0).optional().default(0)),
    SAFETY: z.preprocess(sanitizeNumber, z.coerce.number().min(0).optional().default(0)),
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
    unit: string | null;
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
