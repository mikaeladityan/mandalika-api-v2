import z from "zod";

const sanitizeNumber = (val: unknown) => {
    if (val === "" || val === null || val === undefined) return 0;
    if (typeof val === "string") {
        const cleaned = val.replace(/[^\d]/g, "");
        return cleaned === "" ? 0 : Number(cleaned);
    }
    return Number(val);
};

export const StockImportRowSchema = z.object({
    "PRODUCT CODE": z.string().min(1),
    "CURRENT STOCK": z.preprocess(sanitizeNumber, z.coerce.number().default(0)),
});

export type StockImportRow = z.infer<typeof StockImportRowSchema>;
export type StockImportPreviewDTO = {
    code: string;
    product_id: number;
    name: string;
    size: string;
    type: string;
    amount: number;
    errors: string[];
};

export type ResponseStockImportDTO = {
    import_id: string;
    total: number;
    valid: number;
    invalid: number;
};

export const RequestStockImportSchema = z.object({
    import_id: z.string().uuid("Import ID tidak valid"),
    warehouse_id: z.number().positive(),
    month: z.number().min(1).max(12).optional(),
    year: z.number().min(2000).max(2100).optional(),
});

export type RequestStockImportDTO = z.infer<typeof RequestStockImportSchema>;
