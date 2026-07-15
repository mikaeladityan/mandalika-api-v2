import z from "zod";

export const RequestTypeSchema = z.object({
    name: z.string().min(1, "Nama tipe wajib diisi").max(50, "Nama tipe maksimal 50 karakter"),
});

export const QueryTypeSchema = z.object({
    search: z.string().optional(),
    page: z.coerce.number().int().positive().default(1).optional(),
    take: z.coerce.number().int().positive().max(500).default(25).optional(),
    is_others: z.enum(["true", "false"]).optional(),
});

export const ResponseTypeSchema = RequestTypeSchema.extend({
    id: z.number(),
    slug: z.string(),
});

export const TypeResponseSchema = ResponseTypeSchema;

export const UpdateTypeSchema = RequestTypeSchema.partial().refine(
    (v) => Object.keys(v).length > 0,
    { message: "Minimal satu field harus diisi" },
);

export type RequestTypeDTO = z.infer<typeof RequestTypeSchema>;
export type QueryTypeDTO = z.infer<typeof QueryTypeSchema>;
export type ResponseTypeDTO = z.infer<typeof ResponseTypeSchema>;
export type UpdateTypeDTO = z.infer<typeof UpdateTypeSchema>;
