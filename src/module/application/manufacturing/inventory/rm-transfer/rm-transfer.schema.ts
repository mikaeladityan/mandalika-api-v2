import { z } from "zod";
import { TransferStatus } from "../../../../../generated/prisma/enums.js";

export const QueryRmTransferSchema = z.object({
    page: z.coerce.number().int().positive().default(1).optional(),
    take: z.coerce.number().int().positive().max(100).default(10).optional(),
    search: z.string().optional(),
    status: z.nativeEnum(TransferStatus).optional(),
    fromDate: z.string().optional(),
    toDate: z.string().optional(),
    from_warehouse_id: z.coerce.number().int().positive().optional(),
    to_warehouse_id: z.coerce.number().int().positive().optional(),
});

export type QueryRmTransferDTO = z.infer<typeof QueryRmTransferSchema>;

export const CreateRmTransferSchema = z.object({
    date: z.string(),
    from_warehouse_id: z.number().int().positive("Gudang asal harus dipilih"),
    to_warehouse_id: z.number().int().positive("Gudang tujuan harus dipilih"),
    notes: z.string().optional(),
    items: z.array(
        z.object({
            raw_material_id: z.number().int().positive(),
            quantity_requested: z.number().positive("Jumlah minimal 1"),
            notes: z.string().optional(),
        })
    ).min(1, "Minimal harus ada 1 item bahan baku"),
});

export type CreateRmTransferDTO = z.infer<typeof CreateRmTransferSchema>;

export const UpdateRmTransferStatusSchema = z.object({
    status: z.nativeEnum(TransferStatus),
    notes: z.string().optional(),
    items: z.array(
        z.object({
            id: z.number().int().positive(),
            quantity_packed: z.number().optional(),
            quantity_received: z.number().optional(),
            quantity_fulfilled: z.number().optional(),
            quantity_missing: z.number().optional(),
            quantity_rejected: z.number().optional(),
        })
    ).optional(),
    photos: z.array(z.string().url()).optional(),
});

export type UpdateRmTransferStatusDTO = z.infer<typeof UpdateRmTransferStatusSchema>;

export const QueryRmStockCheckSchema = z.object({
    raw_material_id: z.coerce.number().int().positive("Raw Material ID tidak valid"),
    warehouse_id: z.coerce.number().int().positive("Warehouse ID tidak valid"),
});

export type QueryRmStockCheckDTO = z.infer<typeof QueryRmStockCheckSchema>;
