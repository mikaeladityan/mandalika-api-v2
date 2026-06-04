import { z } from "zod";

export const RawMatSheetSyncJobSchema = z.discriminatedUnion("action", [
    z.object({
        action: z.literal("upsert"),
        rawMaterialId: z.number().int().positive(),
        oldBarcode: z.string().optional(),
    }),
    z.object({
        action: z.literal("delete"),
        rawMaterialId: z.number().int().positive(),
        barcode: z.string().min(1),
    }),
]);

export type RawMatSheetSyncJob = z.infer<typeof RawMatSheetSyncJobSchema>;
