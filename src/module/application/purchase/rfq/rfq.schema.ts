import { z } from "zod";

export const RFQStatusEnum = z.enum([
    "DRAFT", "SUBMITTED", "REVIEWED", "APPROVED", "CONVERTED", "CLOSED",
]);

export const CreateRFQItemSchema = z.object({
    raw_material_id: z.number().int().positive().optional().nullable(),
    purchase_draft_id: z.number().int().positive().optional().nullable(),
    item_code: z.string().min(1),
    item_name: z.string().min(1),
    item_category: z.string().optional().nullable(),
    uom: z.string().min(1),
    qty_requested: z.number().positive(),
    unit_price: z.number().min(0).default(0),
    moq: z.number().min(0).optional().nullable(),
    lead_time: z.number().int().min(0).optional().nullable(),
    notes: z.string().optional().nullable(),
});

export const CreateRFQSchema = z.object({
    rfq_number: z.string().optional(),
    rfq_date: z.coerce.date().optional(),
    supplier_id: z.number().int().positive().optional().nullable(),
    supplier_name: z.string().min(1),
    supplier_code: z.string().optional().nullable(),
    is_new_supplier: z.boolean().default(false),
    supplier_category: z.string().optional().nullable(),
    location_code: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    country: z.string().optional().nullable(),
    addresses: z.string().optional().nullable(),
    supplier_source: z.enum(["LOCAL", "IMPORT"]).optional().default("LOCAL"),
    source_draft_ids: z.array(z.number()).optional().nullable(),
    items: z.array(CreateRFQItemSchema).min(1, "At least one item is required"),
});

export type CreateRFQDTO = z.infer<typeof CreateRFQSchema>;

export const UpdateRFQSchema = z.object({
    rfq_date: z.coerce.date().optional(),
    supplier_id: z.number().int().positive().optional().nullable(),
    supplier_name: z.string().min(1).optional(),
    supplier_code: z.string().optional().nullable(),
    supplier_category: z.string().optional().nullable(),
    location_code: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    items: z.array(
        CreateRFQItemSchema.extend({
            id: z.number().int().positive().optional(),
        })
    ).optional(),
});

export type UpdateRFQDTO = z.infer<typeof UpdateRFQSchema>;

export const UpdateRFQStatusSchema = z.object({
    status: RFQStatusEnum,
});

export type UpdateRFQStatusDTO = z.infer<typeof UpdateRFQStatusSchema>;

export const QueryRFQSchema = z.object({
    page: z.coerce.number().min(1).default(1),
    take: z.coerce.number().min(1).max(500).default(50),
    search: z.string().optional(),
    status: RFQStatusEnum.optional(),
    vendor_id: z.coerce.number().int().positive().optional(), // backward compatibility if needed, but ERD uses supplier_id
    supplier_id: z.coerce.number().int().positive().optional(),
    month: z.coerce.number().min(1).max(12).optional(),
    year: z.coerce.number().min(2000).optional(),
    sortBy: z.enum(["rfq_date", "rfq_number", "status", "created_at"]).optional(),
    order: z.enum(["asc", "desc"]).optional().default("desc"),
});

export type QueryRFQDTO = z.infer<typeof QueryRFQSchema>;

export const POTypeEnum = z.enum(["LOCAL", "IMPORT"]);

export const ConvertToPOSchema = z.object({
    item_ids: z.array(z.number().int().positive()).min(1),
    expected_arrival: z.coerce.date().optional(),
    warehouse_id: z.number().int().positive().optional().nullable(),
    po_type: POTypeEnum.optional(),
    currency: z.string().optional(),
    exchange_rate: z.number().positive().optional().nullable(),
}).refine(
    (data) => {
        if (data.po_type === "IMPORT" || data.currency) {
            return data.currency && data.currency !== "IDR" && data.exchange_rate && data.exchange_rate > 0;
        }
        return true;
    },
    { message: "Import PO requires a foreign currency and a positive exchange_rate." },
);

export type ConvertToPODTO = z.infer<typeof ConvertToPOSchema>;
