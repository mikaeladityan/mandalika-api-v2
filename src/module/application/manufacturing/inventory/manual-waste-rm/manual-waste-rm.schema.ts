import { z } from "zod";

export const QueryManualWasteRMSchema = z.object({
    page: z.coerce.number().int().positive().default(1).optional(),
    take: z.coerce.number().int().positive().max(100).default(10).optional(),
    search: z.string().optional(),
    status: z.enum(["ACTIVE", "RETURNED"]).optional(),
    fromDate: z.string().optional(),
    toDate: z.string().optional(),
    warehouse_id: z.coerce.number().int().positive().optional(),
});

export type QueryManualWasteRMDTO = z.infer<typeof QueryManualWasteRMSchema>;

export const CreateManualWasteRMSchema = z.object({
    raw_material_id: z.number().int().positive("Bahan baku wajib dipilih"),
    warehouse_id: z.number().int().positive("Gudang wajib dipilih"),
    quantity: z.number().positive("Jumlah harus lebih dari 0"),
    notes: z.string().min(1, "Keterangan wajib diisi (nama peminjam, keperluan, dll)"),
});

export type CreateManualWasteRMDTO = z.infer<typeof CreateManualWasteRMSchema>;

export const ReturnManualWasteRMSchema = z.object({
    return_notes: z.string().optional(),
});

export type ReturnManualWasteRMDTO = z.infer<typeof ReturnManualWasteRMSchema>;

export const QueryStockCheckSchema = z.object({
    raw_material_id: z.coerce.number().int().positive("Raw Material ID tidak valid"),
    warehouse_id: z.coerce.number().int().positive("Warehouse ID tidak valid"),
});
