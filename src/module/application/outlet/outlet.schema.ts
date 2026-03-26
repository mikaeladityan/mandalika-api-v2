import z from "zod";

const RequestOutletAddressSchema = z.object({
    street: z.string("Jalan tidak boleh kosong").min(1, "Jalan tidak boleh kosong"),
    district: z.string("Kecamatan tidak boleh kosong").min(1, "Kecamatan tidak boleh kosong"),
    sub_district: z.string("Kelurahan tidak boleh kosong").min(1, "Kelurahan tidak boleh kosong"),
    city: z.string("Kota tidak boleh kosong").min(1, "Kota tidak boleh kosong"),
    province: z.string("Provinsi tidak boleh kosong").min(1, "Provinsi tidak boleh kosong"),
    country: z.string().max(100).default("Indonesia"),
    postal_code: z.string().max(6, "Kode Pos maksimal 6 karakter"),
    notes: z.string().max(200).nullable().optional(),
    url_google_maps: z.string().url("URL Google Maps tidak valid").nullable().optional(),
});

export const RequestOutletSchema = z.object({
    name: z.string("Nama outlet tidak boleh kosong").min(1).max(100),
    code: z
        .string("Kode outlet tidak boleh kosong")
        .min(1)
        .max(20)
        .toUpperCase()
        .regex(/^[A-Z0-9-]+$/, "Kode hanya boleh huruf kapital, angka, dan strip"),
    phone: z.string().max(20).nullable().optional(),
    warehouse_id: z.number().int().positive().nullable().optional(),
    address: RequestOutletAddressSchema.optional(),
});

export const QueryOutletSchema = z.object({
    page: z.coerce.number().int().positive().default(1).optional(),
    take: z.coerce.number().int().positive().max(100).default(25).optional(),
    search: z.string().optional(),
    is_active: z.enum(["true", "false"]).optional(),
    warehouse_id: z.coerce.number().int().positive().optional(),
    sortBy: z.enum(["name", "code", "created_at", "updated_at"]).default("updated_at").optional(),
    sortOrder: z.enum(["asc", "desc"]).default("asc").optional(),
});

const ResponseOutletAddressSchema = z.object({
    street: z.string(),
    district: z.string(),
    sub_district: z.string(),
    city: z.string(),
    province: z.string(),
    country: z.string(),
    postal_code: z.string(),
    notes: z.string().nullable(),
    url_google_maps: z.string().nullable(),
    created_at: z.coerce.date(),
    updated_at: z.coerce.date().nullable(),
});

export const ResponseOutletSchema = z.object({
    id: z.number(),
    name: z.string(),
    code: z.string(),
    phone: z.string().nullable(),
    is_active: z.boolean(),
    warehouse_id: z.number().nullable(),
    warehouse: z
        .object({ id: z.number(), name: z.string(), type: z.string() })
        .nullable(),
    address: ResponseOutletAddressSchema.nullable(),
    _count: z.object({ inventories: z.number() }).optional(),
    deleted_at: z.coerce.date().nullable(),
    created_at: z.coerce.date(),
    updated_at: z.coerce.date().nullable(),
});

export const UpdateOutletSchema = RequestOutletSchema.partial();

export type RequestOutletDTO = z.infer<typeof RequestOutletSchema>;
export type UpdateOutletDTO = z.infer<typeof UpdateOutletSchema>;
export type QueryOutletDTO = z.infer<typeof QueryOutletSchema>;
export type ResponseOutletDTO = z.infer<typeof ResponseOutletSchema>;
