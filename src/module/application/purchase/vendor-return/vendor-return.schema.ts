import { z } from "zod";

export const VendorReturnStatusEnum = z.enum(["DRAFT", "POSTED", "APPROVED"]);

export const CreateVendorReturnItemSchema = z.object({
    receipt_item_id: z.number().int().positive(),
    qty_returned: z.number().positive(),
    reason: z.string().optional().nullable(),
});

export const CreateVendorReturnSchema = z.object({
    receipt_id: z.number().int().positive(),
    warehouse_id: z.number().int().positive(),
    return_date: z.coerce.date().optional(),
    reason: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    items: z.array(CreateVendorReturnItemSchema).min(1, "At least one item is required"),
});

export type CreateVendorReturnDTO = z.infer<typeof CreateVendorReturnSchema>;

export const UpdateVendorReturnSchema = z.object({
    warehouse_id: z.number().int().positive().optional(),
    return_date: z.coerce.date().optional(),
    reason: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    items: z.array(
        CreateVendorReturnItemSchema.extend({
            id: z.number().int().positive().optional(),
        })
    ).optional(),
});

export type UpdateVendorReturnDTO = z.infer<typeof UpdateVendorReturnSchema>;

export const QueryVendorReturnSchema = z.object({
    page: z.coerce.number().min(1).default(1),
    take: z.coerce.number().min(1).max(500).default(50),
    search: z.string().optional(),
    receipt_id: z.coerce.number().int().positive().optional(),
    warehouse_id: z.coerce.number().int().positive().optional(),
    status: VendorReturnStatusEnum.optional(),
    month: z.coerce.number().min(1).max(12).optional(),
    year: z.coerce.number().min(2000).optional(),
    sortBy: z.enum(["return_date", "return_number", "status", "created_at"]).optional(),
    order: z.enum(["asc", "desc"]).optional().default("desc"),
});

export type QueryVendorReturnDTO = z.infer<typeof QueryVendorReturnSchema>;
