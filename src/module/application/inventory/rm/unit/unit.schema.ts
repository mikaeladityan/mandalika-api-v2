import { z } from "zod";


export const IdParamSchema = z.object({
    id: z.coerce.number().int().positive("ID unit tidak valid"),
});

export const RequestRawMaterialUnitSchema = z.object({
    name: z
        .string({ error: "Nama unit tidak boleh kosong" })
        .min(1, "Nama unit tidak boleh kosong")
        .max(100, "Nama unit maksimal 100 karakter"),
});

export const UpdateRawMaterialUnitSchema = RequestRawMaterialUnitSchema.partial().refine(
    (v) => v.name !== undefined,
    { message: "Field name wajib diisi" },
);

export const QueryRawMaterialUnitSchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    take: z.coerce.number().int().positive().max(500).default(25),
    search: z.string().trim().min(1).optional(),
    sortBy: z.enum(["name", "slug", "id"]).default("name"),
    sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

export const ResponseRawMaterialUnitSchema = z.object({
    id: z.number(),
    name: z.string(),
    slug: z.string(),
});

export type IdParamDTO = z.infer<typeof IdParamSchema>;
export type RequestRawMaterialUnitDTO = z.infer<typeof RequestRawMaterialUnitSchema>;
export type UpdateRawMaterialUnitDTO = z.infer<typeof UpdateRawMaterialUnitSchema>;
export type QueryRawMaterialUnitDTO = z.infer<typeof QueryRawMaterialUnitSchema>;
export type ResponseRawMaterialUnitDTO = z.infer<typeof ResponseRawMaterialUnitSchema>;
