import z from "zod";

export const RequestUnitSchema = z.object({
    name: z.string().min(1, "Nama satuan wajib diisi").max(50, "Nama satuan maksimal 50 karakter"),
});

export const QueryUnitSchema = z.object({
    search: z.string().optional(),
    page: z.coerce.number().int().positive().default(1).optional(),
    take: z.coerce.number().int().positive().max(500).default(25).optional(),
});

export const ResponseUnitSchema = RequestUnitSchema.extend({
    id: z.number(),
    slug: z.string(),
});

export const UnitResponseSchema = ResponseUnitSchema;

export const UpdateUnitSchema = RequestUnitSchema.partial().refine(
    (v) => Object.keys(v).length > 0,
    { message: "Minimal satu field harus diisi" },
);

export type RequestUnitDTO = z.infer<typeof RequestUnitSchema>;
export type QueryUnitDTO = z.infer<typeof QueryUnitSchema>;
export type ResponseUnitDTO = z.infer<typeof ResponseUnitSchema>;
export type UpdateUnitDTO = z.infer<typeof UpdateUnitSchema>;
