import { z } from "zod";

export const ReceiptStatusEnum = z.enum(["DRAFT", "POSTED", "APPROVED"]);

export const CreateReceiptItemSchema = z.object({
    po_id: z.number().int().positive(),
    po_item_id: z.number().int().positive(),
    qty_received: z.number().positive(),
    notes: z.string().optional().nullable(),
});

export const CreateReceiptSchema = z.object({
    warehouse_id: z.number().int().positive(),
    receipt_date: z.coerce.date().optional(),
    notes: z.string().optional().nullable(),
    items: z.array(CreateReceiptItemSchema).min(1, "At least one item is required"),
});

export type CreateReceiptDTO = z.infer<typeof CreateReceiptSchema>;

export const UpdateReceiptSchema = z.object({
    warehouse_id: z.number().int().positive().optional(),
    receipt_date: z.coerce.date().optional(),
    notes: z.string().optional().nullable(),
    items: z.array(
        CreateReceiptItemSchema.extend({
            id: z.number().int().positive().optional(),
        })
    ).optional(),
});

export type UpdateReceiptDTO = z.infer<typeof UpdateReceiptSchema>;

export const QueryReceiptSchema = z.object({
    page: z.coerce.number().min(1).default(1),
    take: z.coerce.number().min(1).max(500).default(50),
    search: z.string().optional(),
    po_id: z.coerce.number().int().positive().optional(),
    warehouse_id: z.coerce.number().int().positive().optional(),
    status: ReceiptStatusEnum.optional(),
    month: z.coerce.number().min(1).max(12).optional(),
    year: z.coerce.number().min(2000).optional(),
    sortBy: z.enum(["receipt_date", "receipt_number", "status", "created_at"]).optional(),
    order: z.enum(["asc", "desc"]).optional().default("desc"),
});

export type QueryReceiptDTO = z.infer<typeof QueryReceiptSchema>;

export const QueryOpenPOForReceiptSchema = z.object({
    page: z.coerce.number().min(1).default(1),
    take: z.coerce.number().min(1).max(500).default(50),
    search: z.string().optional(),
    supplier_id: z.coerce.number().int().positive().optional(),
    warehouse_id: z.coerce.number().int().positive().optional(),
    po_type: z.enum(["LOCAL", "IMPORT"]).optional(),
    month: z.coerce.number().min(1).max(12).optional(),
    year: z.coerce.number().min(2000).optional(),
});

export type QueryOpenPOForReceiptDTO = z.infer<typeof QueryOpenPOForReceiptSchema>;
