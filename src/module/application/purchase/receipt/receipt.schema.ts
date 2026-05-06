import { z } from "zod";

export const CreateReceiptItemSchema = z.object({
    po_item_id: z.number().int().positive(),
    qty_received: z.number().positive(),
    notes: z.string().optional().nullable(),
});

export const CreateReceiptSchema = z.object({
    po_id: z.number().int().positive(),
    warehouse_id: z.number().int().positive(),
    receipt_date: z.coerce.date().optional(),
    notes: z.string().optional().nullable(),
    items: z.array(CreateReceiptItemSchema).min(1, "At least one item is required"),
});

export type CreateReceiptDTO = z.infer<typeof CreateReceiptSchema>;

export const QueryReceiptSchema = z.object({
    page: z.coerce.number().min(1).default(1),
    take: z.coerce.number().min(1).max(200).default(50),
    po_id: z.coerce.number().int().positive().optional(),
    warehouse_id: z.coerce.number().int().positive().optional(),
    status: z.enum(["DRAFT", "POSTED", "APPROVED"]).optional(),
});

export type QueryReceiptDTO = z.infer<typeof QueryReceiptSchema>;
