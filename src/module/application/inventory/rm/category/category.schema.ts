import { z } from "zod";
import { STATUS } from "../../../../../generated/prisma/client.js";

export const IdParamSchema = z.object({
    id: z.coerce.number().int().positive("ID category tidak valid"),
});

export const RequestRawMatCategorySchema = z.object({
    name: z
        .string({ error: "Nama category tidak boleh kosong" })
        .min(2, "Nama category minimal 2 karakter")
        .max(255, "Nama category maksimal 255 karakter"),
    status: z.enum(STATUS).optional(),
});

export const UpdateRawMatCategorySchema = RequestRawMatCategorySchema.partial().refine(
    (v) => v.name !== undefined || v.status !== undefined,
    { message: "Minimal satu field (name/status) wajib diisi" },
);

export const ChangeStatusRawMatCategorySchema = z.object({
    status: z.enum(STATUS),
});

export const QueryRawMatCategorySchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    take: z.coerce.number().int().positive().max(100).default(25),
    search: z.string().trim().min(1).optional(),
    status: z.enum(STATUS).optional(),
    sortBy: z.enum(["created_at", "updated_at", "name"]).default("updated_at"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const ResponseRawMatCategorySchema = z.object({
    id: z.number(),
    name: z.string(),
    slug: z.string(),
    status: z.enum(STATUS),
    created_at: z.date(),
    updated_at: z.date(),
});

export type IdParamDTO = z.infer<typeof IdParamSchema>;
export type RequestRawMatCategoryDTO = z.infer<typeof RequestRawMatCategorySchema>;
export type UpdateRawMatCategoryDTO = z.infer<typeof UpdateRawMatCategorySchema>;
export type ChangeStatusRawMatCategoryDTO = z.infer<typeof ChangeStatusRawMatCategorySchema>;
export type QueryRawMatCategoryDTO = z.infer<typeof QueryRawMatCategorySchema>;
export type ResponseRawMatCategoryDTO = z.infer<typeof ResponseRawMatCategorySchema>;
