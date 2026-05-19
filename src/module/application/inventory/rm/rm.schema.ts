import z from "zod";
import {
    MaterialType,
    RawMaterialSource,
    STATUS,
} from "../../../../generated/prisma/client.js";

export const IdParamSchema = z.object({
    id: z.coerce.number().int().positive("ID raw material tidak valid"),
});

export const RequestSupplierMaterialSchema = z.object({
    supplier_id: z.coerce.number().int().positive(),
    unit_price: z.coerce.number().min(0),
    min_buy: z.coerce.number().nullable().optional(),
    lead_time: z.coerce.number().int().positive().nullable().optional(),
    is_preferred: z.boolean().default(false),
    status: z.enum(STATUS).default("ACTIVE").optional(),
});

export const RequestRMSchema = z.object({
    barcode: z
        .string({ error: "Barcode tidak valid" })
        .max(50, "Barcode material tidak boleh lebih dari 50 karakter")
        .nullable()
        .optional(),
    name: z
        .string({ error: "Nama material tidak boleh kosong" })
        .max(255, "Nama material tidak boleh lebih dari 255 karakter"),
    type: z.enum(MaterialType).nullable().optional(),
    min_stock: z.coerce.number().nullable().optional(),
    unit: z.string().min(1, "Unit tidak boleh kosong"),
    raw_mat_category: z.string().optional(),
    suppliers: z.array(RequestSupplierMaterialSchema).optional(),

    // Kompatibilitas form lama: supplier tunggal di root → service memetakan ke `suppliers`.
    supplier_id: z.coerce.number().int().positive().nullable().optional(),
    price: z.coerce.number().nullable().optional(),
    min_buy: z.coerce.number().nullable().optional(),
    lead_time: z.coerce.number().int().positive().nullable().optional(),
});

export const ResponseSupplierMaterialSchema = z.object({
    supplier_id: z.number(),
    supplier_name: z.string(),
    supplier_country: z.string(),
    supplier_source: z.enum(RawMaterialSource).nullable().optional(),
    unit_price: z.number(),
    min_buy: z.number().nullable().optional(),
    lead_time: z.number().nullable().optional(),
    is_preferred: z.boolean(),
    status: z.enum(STATUS),
});

export const ResponseRMSchema = z.object({
    id: z.number(),
    barcode: z.string().nullable(),
    name: z.string(),
    type: z.enum(MaterialType).nullable().optional(),
    min_stock: z.number().nullable().optional(),
    unit_raw_material: z.object({ id: z.number(), name: z.string() }),
    raw_mat_category: z
        .object({ id: z.number(), name: z.string(), slug: z.string() })
        .optional(),
    suppliers: z.array(ResponseSupplierMaterialSchema).default([]),
    created_at: z.date(),
    updated_at: z.date().nullable(),
    deleted_at: z.date().nullable(),
});

export const RM_SORT_KEYS = [
    "barcode",
    "name",
    "updated_at",
    "created_at",
    "category",
] as const;

export const QueryRMSchema = z.object({
    page: z.coerce.number().int().positive().default(1).optional(),
    take: z.coerce.number().int().positive().max(100).default(25).optional(),
    status: z.enum(["actived", "deleted"]).default("actived"),
    type: z.enum(MaterialType).optional(),
    search: z.string().optional(),
    sortBy: z.enum(RM_SORT_KEYS).default("updated_at"),
    sortOrder: z.enum(["asc", "desc"]).default("asc"),
    category_id: z.coerce.number().int().positive().optional(),
    supplier_id: z.coerce.number().int().positive().optional(),
    unit_id: z.coerce.number().int().positive().optional(),
    visibleColumns: z.string().optional(),
});

// RawMaterial tidak punya kolom status — aksi ini memetakan ke `deleted_at` (DELETE = soft delete, ACTIVE = restore).
export const BulkActionEnum = z.enum(["ACTIVE", "DELETE"]);

export const BulkStatusRMSchema = z.object({
    ids: z.array(z.number().int().positive()).min(1, "Minimal 1 raw material harus dipilih"),
    status: BulkActionEnum,
});

export type IdParamDTO = z.infer<typeof IdParamSchema>;
export type RequestRMDTO = z.infer<typeof RequestRMSchema>;
export type ResponseRMDTO = z.infer<typeof ResponseRMSchema>;
export type QueryRMDTO = z.infer<typeof QueryRMSchema>;
export type BulkStatusRMDTO = z.infer<typeof BulkStatusRMSchema>;
export type BulkActionDTO = z.infer<typeof BulkActionEnum>;
export type RequestSupplierMaterialDTO = z.infer<typeof RequestSupplierMaterialSchema>;
