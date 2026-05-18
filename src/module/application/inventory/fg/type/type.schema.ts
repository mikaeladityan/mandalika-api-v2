import z from "zod";

export const RequestFGTypeSchema = z.object({
    name: z
        .string()
        .trim()
        .min(1, "Nama tipe wajib diisi")
        .max(50, "Nama tipe maksimal 50 karakter"),
});

export const QueryFGTypeSchema = z.object({
    search: z.string().trim().min(1).optional(),
    page: z.coerce.number().int().positive().default(1),
    take: z.coerce.number().int().positive().max(100).default(25),
});

export const ResponseFGTypeSchema = z.object({
    id: z.number(),
    name: z.string(),
    slug: z.string(),
});

export type RequestFGTypeDTO = z.infer<typeof RequestFGTypeSchema>;
export type QueryFGTypeDTO = z.infer<typeof QueryFGTypeSchema>;
export type ResponseFGTypeDTO = z.infer<typeof ResponseFGTypeSchema>;
