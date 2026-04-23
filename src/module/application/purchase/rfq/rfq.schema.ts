import { z } from "zod";

export const RFQStatusEnum = z.enum([
    "DRAFT", "SENT", "RECEIVED", "APPROVED",
    "PARTIAL_CONVERTED", "CONVERTED", "CANCELLED",
]);

export const CreateRFQItemSchema = z.object({
    raw_material_id: z.number().int().positive(),
    purchase_draft_id: z.number().int().positive().optional().nullable(),
    quantity: z.number().positive(),
    unit_price: z.number().nonnegative().optional().nullable(),
    notes: z.string().optional().nullable(),
});

export const CreateRFQSchema = z.object({
    vendor_id: z.number().int().positive().optional().nullable(),
    warehouse_id: z.number().int().positive().optional().nullable(),
    date: z.coerce.date().optional(),
    notes: z.string().optional().nullable(),
    items: z.array(CreateRFQItemSchema).min(1, "At least one item is required"),
});

export type CreateRFQDTO = z.infer<typeof CreateRFQSchema>;

export const UpdateRFQSchema = z.object({
    vendor_id: z.number().int().positive().optional().nullable(),
    warehouse_id: z.number().int().positive().optional().nullable(),
    date: z.coerce.date().optional(),
    notes: z.string().optional().nullable(),
    status: RFQStatusEnum.optional(),
    items: z.array(
        CreateRFQItemSchema.extend({
            id: z.number().int().positive().optional(), // existing item id
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
    vendor_id: z.coerce.number().int().positive().optional(),
    month: z.coerce.number().min(1).max(12).optional(),
    year: z.coerce.number().min(2000).optional(),
    sortBy: z.enum(["date", "rfq_number", "status", "created_at"]).optional(),
    order: z.enum(["asc", "desc"]).optional().default("desc"),
});

export type QueryRFQDTO = z.infer<typeof QueryRFQSchema>;

export const ConvertToPOSchema = z.object({
    item_ids: z.array(z.number().int().positive()).min(1),
    expected_arrival: z.coerce.date().optional(),
});

export type ConvertToPODTO = z.infer<typeof ConvertToPOSchema>;
