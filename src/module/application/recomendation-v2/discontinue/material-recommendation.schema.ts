import { z } from "zod";
import { QueryRecomendationV2Schema, ResponseRecomendationV2Schema } from "../recomendation-v2.schema.js";

export const QueryDiscontinueMaterialRecommendationSchema = QueryRecomendationV2Schema.omit({
    product_status: true,
});

export type QueryDiscontinueMaterialRecommendationDTO = z.infer<typeof QueryDiscontinueMaterialRecommendationSchema>;

export const RequestBulkSaveDiscontinueMaterialSchema = z.object({
    month: z.coerce.number().min(1, "Bulan minimal 1").max(12, "Bulan maksimal 12"),
    year: z.coerce.number().min(2000, "Tahun minimal 2000"),
    horizon: z.coerce.number().min(1, "Horizon minimal 1").max(12, "Horizon maksimal 12").default(3),
    type: z.enum(["ffo", "lokal", "impor", "tester"]).optional(),
});

export type RequestBulkSaveDiscontinueMaterialDTO = z.infer<typeof RequestBulkSaveDiscontinueMaterialSchema>;

export const DiscontinueBreakdownSchema = z.object({
    product_id: z.number(),
    fg_code: z.string(),
    fg_name: z.string(),
    contribution_quantity: z.number(),
    anchor_material_id: z.number().nullable(),
    anchor_material_name: z.string().nullable(),
});

export const ResponseDiscontinueMaterialRecommendationSchema = ResponseRecomendationV2Schema.extend({
    row_id: z.string(),
    product_status: z.literal("PENDING"),
    finished_goods: z.array(z.object({
        id: z.number(),
        code: z.string(),
        name: z.string(),
    })),
    discontinue_breakdown: z.array(DiscontinueBreakdownSchema),
});

export type ResponseDiscontinueMaterialRecommendationDTO = z.infer<typeof ResponseDiscontinueMaterialRecommendationSchema>;
