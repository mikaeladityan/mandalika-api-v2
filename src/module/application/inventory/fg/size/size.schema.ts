import z from "zod";

export const RequestFGSizeSchema = z.object({
    size: z.coerce
        .number("Ukuran harus berupa angka")
        .int("Ukuran harus bilangan bulat")
        .min(1, "Ukuran minimal 1"),
});

export const QueryFGSizeSchema = z.object({
    search: z.coerce.number().int().positive().optional(),
    page: z.coerce.number().int().positive().default(1),
    take: z.coerce.number().int().positive().max(100).default(25),
});

export const ResponseFGSizeSchema = z.object({
    id: z.number(),
    size: z.number(),
});

export type RequestFGSizeDTO = z.infer<typeof RequestFGSizeSchema>;
export type QueryFGSizeDTO = z.infer<typeof QueryFGSizeSchema>;
export type ResponseFGSizeDTO = z.infer<typeof ResponseFGSizeSchema>;
