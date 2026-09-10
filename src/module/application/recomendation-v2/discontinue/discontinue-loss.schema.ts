import { z } from "zod";
import { DiscontinueAnchorKeySchema } from "./discontinue.schema.js";

export const DiscontinueLossKeySchema = DiscontinueAnchorKeySchema.extend({ material_id: z.coerce.number().int().positive() });
export type DiscontinueLossKey = z.infer<typeof DiscontinueLossKeySchema>;

export const DiscontinueLossRowSchema = z.object({
    material_id: z.number(),
    barcode: z.string().nullable(),
    material_name: z.string(),
    uom: z.string(),
    stock: z.number(),
    need_buy: z.number(),
    remaining: z.number(),
    remaining_value: z.number().nullable(),
    purchase_value: z.number().nullable(),
});
export const DiscontinueLossSchema = z.object({
    rows: z.array(DiscontinueLossRowSchema),
    remaining_value: z.number(),
    purchase_value: z.number(),
    missing_prices: z.number(),
    anchor_valid: z.boolean(),
});
export type DiscontinueLoss = z.infer<typeof DiscontinueLossSchema>;
