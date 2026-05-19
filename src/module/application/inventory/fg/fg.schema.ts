import z from "zod";
import { GENDER, STATUS, WarehouseType, OutletType } from "../../../../generated/prisma/enums.js";

export const RequestFGSchema = z.object({
    code: z.string().max(100).regex(/^\S+$/, { message: "Gunakan '_' (underscore) untuk spasi" }),
    name: z
        .string()
        .min(5, "Nama produk minimal memiliki 5 karakter")
        .max(100, "Nama produk tidak boleh melebihi 100 karakter"),
    size: z.coerce.number("Ukuran tidak boleh kosong").min(1),
    gender: z.enum(GENDER).optional().default("UNISEX"),
    status: z.enum(STATUS).default("PENDING").optional(),
    z_value: z.number().default(1.65),
    lead_time: z.number().int().min(1).default(14),
    review_period: z.number().int().min(1).default(30),
    product_type: z.string().nullable().optional(),
    distribution_percentage: z.coerce.number().min(0).default(0).optional(),
    safety_percentage: z.coerce.number().min(0).default(0).optional(),
    description: z.string().nullable().optional(),
});

export const ResponseFGSchema = RequestFGSchema.extend({
    id: z.number(),
    gender: z.enum(GENDER).default("UNISEX"),
    size: z.string("Ukuran tidak boleh kosong"),
    product_type: z.string().nullable().optional(),
    created_at: z.date(),
    updated_at: z.date(),
    deleted_at: z.date().nullable(),
});

export const QueryFGSchema = z.object({
    type_id: z.coerce.number().positive().optional(),
    size_id: z.coerce.number().positive().optional(),
    gender: z.enum(GENDER).optional(),

    page: z.coerce.number().int().positive().default(1).optional(),
    take: z.coerce.number().int().positive().max(100).default(25).optional(),

    search: z.string().optional(),
    status: z.enum(STATUS).optional(),
    sortBy: z
        .enum([
            "code",
            "name",
            "gender",
            "type",
            "size",
            "updated_at",
            "created_at",
        ])
        .default("updated_at"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
    visibleColumns: z.string().optional(),
});

export const BulkStatusFGSchema = z.object({
    ids: z.array(z.number().int().positive()).min(1, "Minimal 1 produk harus dipilih"),
    status: z.enum(STATUS),
});

export const StatusParamFGSchema = z.object({
    status: z.enum(STATUS),
});

// --- Detail response (extends list shape dengan relasi recipes + stocks) ---

export const FGRecipeItemSchema = z.object({
    id: z.number(),
    quantity: z.number(),
    version: z.number(),
    is_active: z.boolean(),
    raw_material: z.object({
        id: z.number(),
        name: z.string(),
        unit: z.string().nullable(),
        preferred_unit_price: z.number().nullable(),
    }),
});

export const FGWarehouseStockSchema = z.object({
    quantity: z.number(),
    min_stock: z.number().nullable(),
    warehouse: z.object({
        id: z.number(),
        name: z.string(),
        code: z.string().nullable(),
        type: z.enum(WarehouseType),
    }),
});

export const FGOutletStockSchema = z.object({
    quantity: z.number(),
    min_stock: z.number().nullable(),
    outlet: z.object({
        id: z.number(),
        name: z.string(),
        code: z.string(),
        type: z.enum(OutletType),
    }),
});

export const FGLatestPeriodSchema = z.object({
    year: z.number(),
    month: z.number(),
    date: z.number(),
});

export const FGStockSchema = z.object({
    latest_period: FGLatestPeriodSchema.nullable(),
    warehouse_stocks: z.array(FGWarehouseStockSchema),
    outlet_stocks: z.array(FGOutletStockSchema),
});

export const ResponseFGDetailSchema = ResponseFGSchema.extend({
    recipes: z.array(FGRecipeItemSchema),
    stock: FGStockSchema,
});

export type RequestFGDTO = z.infer<typeof RequestFGSchema>;
export type ResponseFGDTO = z.infer<typeof ResponseFGSchema>;
export type ResponseFGDetailDTO = z.infer<typeof ResponseFGDetailSchema>;
export type FGRecipeItemDTO = z.infer<typeof FGRecipeItemSchema>;
export type FGWarehouseStockDTO = z.infer<typeof FGWarehouseStockSchema>;
export type FGOutletStockDTO = z.infer<typeof FGOutletStockSchema>;
export type FGLatestPeriodDTO = z.infer<typeof FGLatestPeriodSchema>;
export type FGStockDTO = z.infer<typeof FGStockSchema>;
export type QueryFGDTO = z.infer<typeof QueryFGSchema>;
export type BulkStatusFGDTO = z.infer<typeof BulkStatusFGSchema>;
