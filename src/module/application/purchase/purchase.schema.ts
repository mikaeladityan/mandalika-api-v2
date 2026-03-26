import { z } from "zod";

export const QueryPurchaseSchema = z.object({
    page: z.coerce.number().min(1).optional().default(1),
    take: z.coerce.number().min(1).optional().default(25),
    search: z.string().optional(),
    month: z.coerce.number().min(1).max(12).optional(),
    year: z.coerce.number().min(2000).optional(),
    supplier_id: z.coerce.number().optional(),
});

export type QueryPurchaseDTO = z.infer<typeof QueryPurchaseSchema>;

export const ResponsePurchaseSchema = z.object({
    id: z.number(),
    material_id: z.number(),
    barcode: z.string().nullable(),
    material_name: z.string(),
    supplier_name: z.string().nullable(),
    quantity: z.number(),
    uom: z.string(),
    price: z.number(),
    moq: z.number().nullable(),
    pic_id: z.string().nullable(),
    created_at: z.date(),
});

export type ResponsePurchaseDTO = z.infer<typeof ResponsePurchaseSchema>;
