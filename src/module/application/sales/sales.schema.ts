import z from "zod";
import { ResponseProductSchema } from "../product/product.schema.js";
import { GENDER, SalesType } from "../../../generated/prisma/enums.js";

export const RequestSalesSchema = z.object({
    product_id: z.number("Produk tidak boleh kosong"),
    quantity: z.number(),
    month: z.number().optional(),
    year: z.number().optional(),
    type: z.nativeEnum(SalesType).default(SalesType.ALL),
});

export type RequestSalesDTO = z.infer<typeof RequestSalesSchema>;

export const ResponseSalesSchema = RequestSalesSchema.extend({
    id: z.number().optional(),
    month: z.number(),
    year: z.number(),
    created_at: z.date(),
    updated_at: z.date(),
    product: ResponseProductSchema.pick({
        id: true,
        code: true,
        name: true,
        product_type: true,
    }),
});

export const QuerySalesSchema = z.object({
    size: z.number().optional(),
    variant: z.string().optional(),
    gender: z.enum(GENDER).optional(),
    horizon: z.number().optional(),
    product_id: z.number().optional(),
    product_id_2: z.number().optional(),

    year: z.number().optional(),
    month: z.number().optional(),
    search: z.string().optional(), // Added search parameter
    type: z.nativeEnum(SalesType).optional(),

    page: z.number().int().positive().default(1).optional(),
    take: z.number().int().positive().max(100).default(25).optional(),

    sortBy: z.enum(["product_id", "name", "code", "quantity"]).default("quantity"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export type ResponseSalesDTO = z.infer<typeof ResponseSalesSchema>;
export type QuerySalesDTO = z.infer<typeof QuerySalesSchema>;
export const QuerySalesRekapSchema = z.object({
    year: z.number().int().positive().optional(),
    month: z.number().int().min(1).max(12).optional(),
    search: z.string().optional(),
    gender: z.enum(GENDER).optional(),
    size: z.number().optional(),
    variant: z.string().optional(),
    page: z.number().int().positive().default(1).optional(),
    take: z.number().int().positive().max(100).default(50).optional(),
    sortBy: z.enum(["name", "code", "offline", "online", "spin_wheel", "garansi_out", "all_qty", "total_qty"]).default("total_qty"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export type QuerySalesRekapDTO = z.infer<typeof QuerySalesRekapSchema>;
