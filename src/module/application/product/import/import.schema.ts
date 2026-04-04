import z from "zod";
import { GENDER } from "../../../../generated/prisma/enums.js";

const sanitizeNumber = (val: unknown) => {
    if (val === "" || val === null || val === undefined) return 0;
    if (typeof val === "string") {
        const cleaned = val.replace(/[^\d]/g, "");
        return cleaned === "" ? 0 : Number(cleaned);
    }
    return Number(val);
};

export const ProductImportRowSchema = z.object({
    "PRODUCT CODE": z.string().min(1),
    "PRODUCT NAME": z.string().min(1),
    TYPE: z.string().min(1),
    GENDER: z.string().optional().default(""),
    SIZE: z.preprocess(sanitizeNumber, z.coerce.number().int().positive()),
    UOM: z.string().min(1),
    EDAR: z.preprocess(sanitizeNumber, z.coerce.number().min(0).optional().default(0)),
    SAFETY: z.preprocess(sanitizeNumber, z.coerce.number().min(0).optional().default(0)),
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
