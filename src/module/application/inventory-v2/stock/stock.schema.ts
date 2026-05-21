import z from "zod";
import { GENDER } from "../../../../generated/prisma/client.js";

export const RequestStockSchema = z.object({
    code: z.string(),
    amount: z.number(),
    warehouse_id: z.number(),
    month: z.number().min(1).max(12),
    year: z.number().min(2000),
});

export const RequestUpsertStockSchema = z.object({
    product_id: z.number(),
    warehouse_id: z.number(),
    quantity: z.number(),
    month: z.number().min(1).max(12),
    year: z.number().min(2000),
});

export const ResponseStockSchema = z.object({
    id: z.number(),
    code: z.string(),
    name: z.string(),
    type: z.string(),
    size: z.number(),
    gender: z.enum(GENDER).default("UNISEX"),
    uom: z.string(),
    amount: z.number(),
    warehouse: z
        .object({
            id: z.string(),
            name: z.string(),
        })
        .optional(),
});

export const QueryStockSchema = z.object({
    type_id: z.number().positive().optional(),
    warehouse_id: z.number().positive().optional(),
    gender: z.enum(GENDER).optional(),
    page: z.number().int().positive().default(1).optional(),
    take: z.number().int().positive().max(100).default(25).optional(),

    search: z.string().optional(),
    month: z.coerce
        .number()
        .int()
        .min(1)
        .max(12)
        .default(new Date().getMonth() + 1)
        .optional(),
    year: z.coerce.number().int().min(2000).default(new Date().getFullYear()).optional(),
    sortBy: z
        .enum(["code", "name", "updated_at", "created_at", "gender", "type", "size", "amount"])
        .default("updated_at"),
    sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

export type RequestStockDTO = z.infer<typeof RequestStockSchema>;
export type RequestUpsertStockDTO = z.infer<typeof RequestUpsertStockSchema>;
export type ResponseStockDTO = z.output<typeof ResponseStockSchema>;
export type QueryStockDTO = z.input<typeof QueryStockSchema>;
