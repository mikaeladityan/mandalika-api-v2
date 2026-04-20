import { z } from "zod";
import { TransferStatus } from "../../../../../generated/prisma/enums.js";

export const QueryRmReceiptSchema = z.object({
    page: z.coerce.number().int().positive().default(1).optional(),
    take: z.coerce.number().int().positive().max(100).default(10).optional(),
    search: z.string().optional(),
    status: z.nativeEnum(TransferStatus).optional(),
    fromDate: z.string().optional(),
    toDate: z.string().optional(),
});

export type QueryRmReceiptDTO = z.infer<typeof QueryRmReceiptSchema>;

export const UpdateRmReceiptItemSchema = z.object({
    items: z.array(
        z.object({
            id: z.number().int().positive(),
            quantity_requested: z.number().positive("Jumlah minimal 1"),
        })
    ),
});

export type UpdateRmReceiptItemDTO = z.infer<typeof UpdateRmReceiptItemSchema>;

export const UpdateRmStatusSchema = z.object({
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

export type UpdateRmStatusDTO = z.infer<typeof UpdateRmStatusSchema>;
