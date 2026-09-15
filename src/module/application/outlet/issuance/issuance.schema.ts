import { z } from "zod";

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal harus berformat YYYY-MM-DD").refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Tanggal tidak valid");

export const RequestIssuanceSchema = z.object({
    outlet_id: z.coerce.number().int().positive("Outlet wajib dipilih"),
    product_id: z.coerce.number().int().positive("Produk wajib dipilih"),
    date: DateSchema,
    quantity: z.coerce.number().finite("Quantity harus berupa angka").min(0, "Quantity tidak boleh negatif"),
});

export const QueryIssuanceSchema = z.object({
    page: z.coerce.number().int().positive().default(1).optional(),
    take: z.coerce.number().int().positive().max(100).default(25).optional(),
    search: z.string().trim().optional(),
    outlet_id: z.coerce.number().int().positive().optional(),
    product_id: z.coerce.number().int().positive().optional(),
    month: z.coerce.number().int().min(1).max(12).optional(),
    year: z.coerce.number().int().min(2000).max(2100).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal harus berformat YYYY-MM-DD").optional(),
    sortOrder: z.enum(["asc", "desc"]).default("desc").optional(),
});

export type RequestIssuanceDTO = z.infer<typeof RequestIssuanceSchema>;
export type QueryIssuanceDTO = z.infer<typeof QueryIssuanceSchema>;
