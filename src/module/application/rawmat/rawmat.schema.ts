import z from "zod";
import { MaterialType, STATUS, RawMaterialSource } from "../../../generated/prisma/client.js";

export const RequestSupplierMaterialSchema = z.object({
    supplier_id: z.number(),
    unit_price: z.number(),
    min_buy: z.number().nullable().optional(),
    lead_time: z.number().int().positive().nullable().optional(),
    is_preferred: z.boolean().default(false),
    status: z.enum(STATUS).default("ACTIVE").optional(), // ACTIVE | BLOCK | dsb
});

export const RequestRawMaterialSchema = z.object({
    barcode: z
        .string({ error: "Barcode tidak valid" })
        .max(50, "Barcode material tidak boleh lebih dari 50 karakter")
        .nullable()
        .optional(),
    name: z
        .string({ error: "Nama material tidak boleh kosong" })
        .max(255, "Nama material tidak boleh lebih dari 255 karakter"),
    // Root level fields for backward compatibility (maps to preferred supplier)
    price: z.number().nullable().optional(),
    min_buy: z.number().nullable().optional(),
    lead_time: z.number().int().positive().nullable().optional(),
    type: z.enum(MaterialType).nullable().optional(),
    source: z.enum(["LOCAL", "IMPORT"]).optional(),
    supplier_id: z.number().nullable().optional(),

    min_stock: z.number().nullable().optional(),

    raw_mat_category: z.string().optional(),
    unit: z.string(),

    suppliers: z.array(RequestSupplierMaterialSchema).optional(),
});

export const ResponseSupplierMaterialSchema = RequestSupplierMaterialSchema.extend({
    supplier_name: z.string(),
    supplier_country: z.string().nullable(),
    supplier_source: z.nativeEnum(RawMaterialSource).nullable().optional(),
    status: z.enum(STATUS).default("ACTIVE"),
});

export const ResponseRawMaterialSchema = RequestRawMaterialSchema.omit({
    supplier_id: true,
    unit: true,
    raw_mat_category: true,
    suppliers: true,
    price: true,
    min_buy: true,
    lead_time: true,
}).extend({
    id: z.number(),
    source: z.enum(["LOCAL", "IMPORT"]).nullable().optional(),
    current_stock: z.number().optional(),
    // Backward compatibility fields (from preferred supplier)
    price: z.number().nullable().optional(),
    min_buy: z.number().nullable().optional(),
    lead_time: z.number().nullable().optional(),
    supplier: z
        .object({
            id: z.number(),
            name: z.string(),
            country: z.string(),
        })
        .optional(),
    
    // Multiple suppliers
    suppliers: z.array(ResponseSupplierMaterialSchema).optional(),

    raw_mat_category: z
        .object({
            id: z.number(),
            name: z.string(),
            slug: z.string(),
        })
        .optional(),
    unit_raw_material: z.object({
        id: z.number(),
        name: z.string(),
    }),
    created_at: z.date(),
    updated_at: z.date().nullable(),
    deleted_at: z.date().nullable().optional(),
    sheet_sync_status: z.enum(["synced", "failed"]).optional(),
    sheet_sync_error: z.string().optional(),
});

export const QueryRawMaterialSchema = z.object({
    page: z.number().int().positive().default(1).optional(),
    // Max 5000: form option-list (recipe, BOM) memakai take besar untuk memuat
    // semua pilihan sekaligus (SelectForm filter client-side)
    take: z.number().int().positive().max(5000).default(25).optional(),
    status: z.enum(["actived", "deleted"]).default("actived"),
    type: z.enum(MaterialType).optional(),
    search: z.string().optional(),
    sortBy: z
        .enum([
            "barcode",
            "name",
            "updated_at",
            "current_stock",
            "price",
            "created_at",
            "category",
            "supplier",
        ])
        .default("updated_at"),
    sortOrder: z.enum(["asc", "desc"]).default("asc"),

    category_id: z.coerce.number().optional(),
    supplier_id: z.coerce.number().optional(),
    unit_id: z.coerce.number().optional(),
    visibleColumns: z.string().optional(),
});

export type QueryRawMaterialDTO = z.infer<typeof QueryRawMaterialSchema>;
export type RequestRawMaterialDTO = z.input<typeof RequestRawMaterialSchema>;
export type ResponseRawMaterialDTO = z.output<typeof ResponseRawMaterialSchema>;

export const BulkStatusRawMaterialSchema = z.object({
    ids: z.array(z.number()),
    status: z.enum(["ACTIVE", "DELETE"]),
});

export type BulkStatusRawMaterialDTO = z.infer<typeof BulkStatusRawMaterialSchema>;
