import { z } from "zod";

export const ProductSheetSyncJobSchema = z.discriminatedUnion("action", [
    z.object({
        action: z.literal("upsert"),
        productId: z.number().int().positive(),
        oldCode: z.string().optional(),
    }),
    z.object({
        action: z.literal("delete"),
        productId: z.number().int().positive(),
        code: z.string(),
    }),
]);

export type ProductSheetSyncJob = z.infer<typeof ProductSheetSyncJobSchema>;
