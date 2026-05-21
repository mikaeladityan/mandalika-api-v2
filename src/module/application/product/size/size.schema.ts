import z from "zod";

export const RequestSizeSchema = z.object({
    size: z.coerce
        .number("Ukuran harus berupa angka")
        .int("Ukuran harus bilangan bulat")
        .min(1, "Ukuran minimal 1"),
});

export const QuerySizeSchema = z.object({
    search: z.coerce.number().int().positive().optional(),
    page: z.coerce.number().int().positive().default(1).optional(),
    take: z.coerce.number().int().positive().max(100).default(25).optional(),
});

export const ResponseSizeSchema = z.object({
    id: z.number(),
    size: z.number(),
});

export const ResponseProductSizeSchema = ResponseSizeSchema;

export const UpdateSizeSchema = RequestSizeSchema.partial().refine(
    (v) => Object.keys(v).length > 0,
    { message: "Minimal satu field harus diisi" },
);

export type RequestSizeDTO = z.infer<typeof RequestSizeSchema>;
export type QuerySizeDTO = z.infer<typeof QuerySizeSchema>;
export type ResponseSizeDTO = z.infer<typeof ResponseSizeSchema>;
export type ResponseProductSizeDTO = ResponseSizeDTO;
export type UpdateSizeDTO = z.infer<typeof UpdateSizeSchema>;
