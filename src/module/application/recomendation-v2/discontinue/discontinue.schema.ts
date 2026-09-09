import { z } from "zod";

export const DiscontinueAnchorKeySchema = z.object({
    product_id: z.coerce.number().int().positive(),
    month: z.coerce.number().int().min(1).max(12),
    year: z.coerce.number().int().min(2000).max(9999),
});

export const SaveDiscontinueAnchorSchema = DiscontinueAnchorKeySchema.extend({
    anchor_material_id: z.coerce.number().int().positive(),
    quantity: z.coerce.number().finite().min(0).max(999999999999),
});

export type DiscontinueAnchorKey = z.infer<typeof DiscontinueAnchorKeySchema>;
export type SaveDiscontinueAnchor = z.infer<typeof SaveDiscontinueAnchorSchema>;
export type DiscontinueNeed = {
    product_id: number;
    material_id: number;
    recipe_quantity: number;
    total_needed: number;
    anchor_material_id: number | null;
    anchor_quantity: number | null;
    anchor_material_name: string | null;
    equivalent_fg: number | null;
    anchor_valid: boolean;
};
