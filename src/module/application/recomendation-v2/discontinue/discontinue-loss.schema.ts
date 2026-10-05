import { z } from "zod";
import { DiscontinueAnchorKeySchema } from "./discontinue.schema.js";

// material_id optional: without it the check covers every RM in the FG recipe (pre-bfa9160 contract).
export const DiscontinueLossKeySchema = DiscontinueAnchorKeySchema.extend({ material_id: z.coerce.number().int().positive().optional() });
export type DiscontinueLossKey = z.infer<typeof DiscontinueLossKeySchema>;

export const DiscontinueLossRowSchema = z.object({
    material_id: z.number(),
    barcode: z.string().nullable(),
    material_name: z.string(),
    uom: z.string(),
    total_needed: z.number(),
    open_po: z.number(),
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
    locked: z.boolean().default(false),
    historical_prices_missing: z.boolean().default(false),
});
export type DiscontinueLoss = z.infer<typeof DiscontinueLossSchema>;
