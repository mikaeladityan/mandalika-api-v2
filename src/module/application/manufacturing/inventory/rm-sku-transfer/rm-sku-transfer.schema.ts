import { z } from "zod";

export const RequestRmSkuTransferSchema = z.object({
    source_rm_id: z.coerce.number({ error: "RM Asal harus dipilih" }),
    target_rm_id: z.coerce.number({ error: "RM Tujuan harus dipilih" }),
    warehouse_id: z.coerce.number({ error: "Gudang harus dipilih" }),
    quantity: z.coerce.number({ error: "Quantity harus diisi" }).min(0.01, "Quantity minimal 0.01"),
    notes: z.string().optional(),
});

export type RequestRmSkuTransferDTO = z.infer<typeof RequestRmSkuTransferSchema>;
