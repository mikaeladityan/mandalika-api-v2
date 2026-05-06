import { z } from "zod";

export const POStatusEnum = z.enum([
    "DRAFT", "SUBMITTED", "APPROVED", "ORDERED", "CLOSED", "CANCELLED",
]);

export const POTypeEnum = z.enum(["LOCAL", "IMPORT"]);
export const POItemTypeEnum = z.enum(["MASTER", "MANUAL"]);

export const CreatePOItemSchema = z.object({
    raw_material_id: z.number().int().positive().optional().nullable(),
    item_code: z.string().min(1),
    item_name: z.string().min(1),
    item_category: z.string().optional().nullable(),
    item_type: POItemTypeEnum.default("MASTER"),
    uom: z.string().min(1),
    moq: z.number().optional().nullable(),
    unit_price: z.number().min(0),
    qty_ordered: z.number().positive(),
    subtotal: z.number().min(0),
    notes: z.string().optional().nullable(),
});

export const CreatePOPaymentTermSchema = z.object({
    term_seq: z.number().int().min(1),
    percentage: z.number().min(0).max(100),
    due_days: z.number().int().min(0).optional().nullable(),
    notes: z.string().optional().nullable(),
});

export const CreatePOSchema = z.object({
    po_number: z.string().optional(),
    po_date: z.coerce.date().optional(),
    po_type: POTypeEnum.default("LOCAL"),
    supplier_id: z.number().int().positive(),
    warehouse_id: z.number().int().positive().optional().nullable(),
    source_rfq_id: z.number().int().positive().optional().nullable(),
    currency: z.string().default("IDR"),
    exchange_rate: z.number().optional().nullable().default(1),
    total_estimated: z.number().min(0),
    notes: z.string().optional().nullable(),
    payment_notes: z.string().optional().nullable(),
    items: z.array(CreatePOItemSchema).min(1, "At least one item is required"),
    payment_terms: z.array(CreatePOPaymentTermSchema).optional(),
});

export type CreatePODTO = z.infer<typeof CreatePOSchema>;

export const UpdatePOSchema = z.object({
    po_date: z.coerce.date().optional(),
    po_type: POTypeEnum.optional(),
    warehouse_id: z.number().int().positive().optional().nullable(),
    currency: z.string().optional(),
    exchange_rate: z.number().optional().nullable(),
    total_estimated: z.number().min(0).optional(),
    notes: z.string().optional().nullable(),
    payment_notes: z.string().optional().nullable(),
    status: POStatusEnum.optional(),
    items: z.array(
        CreatePOItemSchema.extend({
            id: z.number().int().positive().optional(),
        })
    ).optional(),
    payment_terms: z.array(
        CreatePOPaymentTermSchema.extend({
            id: z.number().int().positive().optional(),
        })
    ).optional(),
});

export type UpdatePODTO = z.infer<typeof UpdatePOSchema>;

export const UpdatePOStatusSchema = z.object({
    status: POStatusEnum,
});

export type UpdatePOStatusDTO = z.infer<typeof UpdatePOStatusSchema>;

export const QueryPOSchema = z.object({
    page: z.coerce.number().min(1).default(1),
    take: z.coerce.number().min(1).max(500).default(50),
    search: z.string().optional(),
    status: POStatusEnum.optional(),
    po_type: POTypeEnum.optional(),
    supplier_id: z.coerce.number().int().positive().optional(),
    warehouse_id: z.coerce.number().int().positive().optional(),
    month: z.coerce.number().min(1).max(12).optional(),
    year: z.coerce.number().min(2000).optional(),
    sortBy: z.enum(["po_date", "po_number", "status", "created_at", "total_estimated"]).optional(),
    order: z.enum(["asc", "desc"]).optional().default("desc"),
});

export type QueryPODTO = z.infer<typeof QueryPOSchema>;
