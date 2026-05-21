import { z } from "zod";
import { RawMaterialSource } from "../../../../../generated/prisma/client.js";

export const IdParamSchema = z.object({
    id: z.coerce.number().int().positive("ID supplier tidak valid"),
});

export const RequestSupplierSchema = z.object({
    name: z.string().min(1, "Nama supplier wajib diisi").max(100),
    addresses: z.string().min(1, "Alamat supplier wajib diisi"),
    country: z.string().min(1, "Negara wajib diisi").max(100),
    phone: z.string().max(20).nullable().optional(),
    source: z.enum(RawMaterialSource).default(RawMaterialSource.LOCAL),
});

export const QuerySupplierSchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    take: z.coerce.number().int().positive().max(500).default(25),
    search: z.string().optional(),
    sortBy: z.enum(["country", "name", "updated_at", "created_at"]).default("updated_at"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const BulkDeleteSupplierSchema = z.object({
    ids: z.array(z.number().int().positive()).min(1, "Minimal 1 supplier harus dipilih"),
});

export type IdParamDTO = z.infer<typeof IdParamSchema>;
export type RequestSupplierDTO = z.infer<typeof RequestSupplierSchema>;
export type QuerySupplierDTO = z.infer<typeof QuerySupplierSchema>;
export type BulkDeleteSupplierDTO = z.infer<typeof BulkDeleteSupplierSchema>;

export type ResponseSupplierDTO = {
    id: number;
    name: string;
    slug: string | null;
    addresses: string;
    country: string;
    phone: string | null;
    source: RawMaterialSource;
    created_at: Date;
    updated_at: Date;
};
