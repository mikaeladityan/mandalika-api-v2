import z from "zod";
import { GENDER, STATUS } from "../../../generated/prisma/client.js";
import { UnitResponseSchema } from "./unit/unit.schema.js";
import { TypeResponseSchema } from "./type/type.schema.js";
import { ResponseProductSizeSchema } from "./size/size.schema.js";

export const RequestProductSchema = z.object({
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
    unit: z.string().nullable().optional(),
    product_type: z.string().nullable().optional(),
    distribution_percentage: z.coerce.number().min(0).default(0).optional(),
    safety_percentage: z.coerce.number().min(0).default(0).optional(),
    description: z.string().nullable().optional(),
});

export const ResponseProductSchema = RequestProductSchema.extend({
    id: z.number(),
    gender: z.enum(GENDER).default("UNISEX"),
    size: ResponseProductSizeSchema.nullable().optional(),
    unit: UnitResponseSchema.nullable(),
    product_type: TypeResponseSchema.nullable(),
    created_at: z.date(),
    updated_at: z.date(),
    deleted_at: z.date().nullable(),
    recipes: z
        .array(
            z.object({
                id: z.number(),
                quantity: z.number(),
                version: z.number(),
                is_active: z.boolean(),
                raw_material: z.object({
                    id: z.number(),
                    name: z.string(),
                    price: z.number(),
                    current_stock: z.number().optional(),
                    unit_raw_material: z.object({
                        name: z.string(),
                    }),
                }),
            }),
        )
        .optional(),
    product_inventories: z
        .array(
            z.object({
                id: z.number(),
                quantity: z.number(),
                min_stock: z.number().nullable(),
                warehouse: z.object({
                    id: z.number(),
                    name: z.string(),
                }),
            }),
        )
        .optional(),
    // Derived in list response. "synced" means no unresolved sync failure;
    // "failed" means latest failure row for this product is unresolved.
    // ("pending" not derived server-side — FE can render from local mutation state.)
    sheet_sync_status: z.enum(["synced", "failed"]).optional(),
    sheet_sync_error: z.string().optional(),
});

export const QueryProductSchema = z.object({
    type_id: z.coerce.number().int().positive().optional(),
    size_id: z.coerce.number().int().positive().optional(),
    gender: z.enum(GENDER).optional(),

    page: z.coerce.number().int().positive().default(1).optional(),
    // Max 5000: form option-list (recipe, GR/TG/DO/return) memakai take besar
    // untuk memuat semua pilihan sekaligus (SelectForm filter client-side)
    take: z.coerce.number().int().positive().max(5000).default(25).optional(),

    search: z.string().optional(),
    status: z.enum(STATUS).optional(),
    sortBy: z
        .enum([
            "code",
            "name",
            "updated_at",
            "created_at",
            "gender",
            "type",
            "size",
            "lead_time",
            "distribution_percentage",
            "safety_percentage",
            "forecast_default",
        ])
        .default("forecast_default"),
    sortOrder: z.enum(["asc", "desc"]).default("asc"),
    visibleColumns: z.string().optional(),
});

// Didefinisikan eksplisit (bukan RequestProductSchema.partial()) karena Zod 4
// tetap meng-inject .default() saat .partial() — field yang tidak dikirim ikut
// ter-reset (status→PENDING, z_value→1.65, dst). Update juga tidak boleh
// menyentuh status; perubahan status hanya lewat PATCH /status/:id.
export const UpdateProductSchema = z
    .object({
        code: z
            .string()
            .max(100)
            .regex(/^\S+$/, { message: "Gunakan '_' (underscore) untuk spasi" }),
        name: z
            .string()
            .min(5, "Nama produk minimal memiliki 5 karakter")
            .max(100, "Nama produk tidak boleh melebihi 100 karakter"),
        size: z.coerce.number("Ukuran tidak boleh kosong").min(1),
        gender: z.enum(GENDER),
        z_value: z.number(),
        lead_time: z.number().int().min(1),
        review_period: z.number().int().min(1),
        unit: z.string().nullable(),
        product_type: z.string().nullable(),
        distribution_percentage: z.coerce.number().min(0),
        safety_percentage: z.coerce.number().min(0),
        description: z.string().nullable(),
    })
    .partial()
    .refine((v) => Object.keys(v).length > 0, { message: "Minimal satu field harus diisi" });

export const StatusQuerySchema = z.object({
    status: z.enum(STATUS),
});

export type RequestProductDTO = z.infer<typeof RequestProductSchema>;
export type ResponseProductDTO = z.infer<typeof ResponseProductSchema>;
export type QueryProductDTO = z.infer<typeof QueryProductSchema>;
export type UpdateProductDTO = z.infer<typeof UpdateProductSchema>;
export type StatusQueryDTO = z.infer<typeof StatusQuerySchema>;

export const UpdateReferenceEdarSchema = z.object({
    product_id: z.coerce.number().int().positive(),
    // Input UI dalam persen (0-100); kolom DB menyimpan fraction (0-1),
    // mengikuti konvensi distribution_percentage
    reference_distribution_percentage: z.coerce
        .number()
        .min(0)
        .max(100)
        .transform((v) => v / 100),
});
export type UpdateReferenceEdarDTO = z.infer<typeof UpdateReferenceEdarSchema>;
