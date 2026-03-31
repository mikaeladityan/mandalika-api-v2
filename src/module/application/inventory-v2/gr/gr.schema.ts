import { z } from "zod";
import { GoodsReceiptStatus, GoodsReceiptType } from "../../../../generated/prisma/enums.js";

export const CreateGoodsReceiptItemSchema = z.object({
    product_id: z.coerce.number(),
    quantity_planned: z.coerce.number().min(0.01),
    quantity_actual: z.coerce.number().min(0.01),
    notes: z.string().optional(),
});

export const CreateGoodsReceiptSchema = z.object({
    type: z.enum(GoodsReceiptType).default(GoodsReceiptType.MANUAL),
    warehouse_id: z.coerce.number(),
    date: z.string().optional(),
    notes: z.string().optional(),
    items: z.array(CreateGoodsReceiptItemSchema).min(1),
});

export type CreateGoodsReceiptDTO = z.infer<typeof CreateGoodsReceiptSchema>;

export const UpdateGoodsReceiptStatusSchema = z.object({
    status: z.enum(GoodsReceiptStatus),
    notes: z.string().optional(),
});

export type UpdateGoodsReceiptStatusDTO = z.infer<typeof UpdateGoodsReceiptStatusSchema>;

export const QueryGoodsReceiptSchema = z.object({
    page: z.coerce.number().int().positive().default(1).optional(),
    take: z.coerce.number().int().positive().max(100).default(10).optional(),
    sortBy: z.enum(["created_at", "gr_number"]).default("created_at").optional(),
    sortOrder: z.enum(["asc", "desc"]).default("desc").optional(),
    search: z.string().optional(),
    status: z.enum(GoodsReceiptStatus).optional(),
    type: z.enum(GoodsReceiptType).optional(),
    warehouse_id: z.coerce.number().optional(),
});

export type QueryGoodsReceiptDTO = z.infer<typeof QueryGoodsReceiptSchema>;
