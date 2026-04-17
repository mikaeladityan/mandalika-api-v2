import { z } from "zod";

export const QueryRmMovmentSchema = z.object({
    page: z.coerce.number().int().positive().default(1).optional(),
    take: z.coerce.number().int().positive().max(100).default(10).optional(),
    fromDate: z.string().optional(),
    toDate: z.string().optional(),
    warehouse_id: z.coerce.number().int().positive().optional(),
    search: z.string().optional(), // For RM Name, SKU, or MFG Number
});

export type QueryRmMovmentDTO = z.infer<typeof QueryRmMovmentSchema>;

export const ResponseRmMovmentSchema = z.object({
    id: z.number(),
    created_at: z.date(),
    mfg_number: z.string().nullable(),
    rm_name: z.string(),
    rm_sku: z.string(),
    unit: z.string(),
    warehouse_name: z.string(),
    qty_in: z.number(),
    qty_out: z.number(),
    qty_before: z.number(),
    qty_after: z.number(),
    notes: z.string().nullable(),
});

export type ResponseRmMovmentDTO = z.infer<typeof ResponseRmMovmentSchema>;
