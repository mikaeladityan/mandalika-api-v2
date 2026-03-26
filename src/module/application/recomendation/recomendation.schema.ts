import { z } from "zod";

export const QueryRecomendationSchema = z.object({
    page: z.coerce.number().min(1).optional().default(1),
    take: z.coerce.number().min(1).optional().default(25),
    search: z.string().optional(),
    month: z.coerce.number().min(1).max(12).optional(),
    year: z.coerce.number().min(2000).optional(),
    sales_months: z.coerce.number().optional().default(3),
    forecast_months: z.coerce.number().optional().default(5),
    type: z.enum(["ffo", "lokal", "impor"]).optional(),
});

export type QueryRecomendationDTO = z.infer<typeof QueryRecomendationSchema>;

export const RequestAccRecommendationSchema = z.object({
    id: z.number(),
    status: z.literal("ACC"),
});

export type RequestAccRecommendationDTO = z.infer<typeof RequestAccRecommendationSchema>;

export const ResponseRecomendationSchema = z.object({
    material_id: z.number(),
    barcode: z.string().nullable(),
    material_name: z.string(),
    supplier_name: z.string().nullable(),
    moq: z.number(),
    lead_time: z.number().nullable(),
    stock_fg_x_resep: z.number(),
    safety_stock_x_resep: z.number(),
    current_stock: z.number(),
    open_po: z.number(),
    pic_order_quantity: z.number(),
    stock_plus_po: z.number(),
    total_needs: z.number(),
    forecast_target_month_needs: z.number().optional(),
    recommendation: z.number().nullable(),
    recommendation_id: z.number().nullable(),
    status: z.string(),
    pic_id: z.string().nullable(),
    open_po_expected_arrival: z.date().nullable().optional(),
    sales: z.array(z.any()),
    needs: z.array(z.any()),
    fg_stock_breakdown: z.array(z.any()).optional(),
    fg_forecast_breakdown: z.array(z.any()).optional(),
    inv_period: z.object({ month: z.number(), year: z.number() }).optional(),
});

export type ResponseRecomendationDTO = z.infer<typeof ResponseRecomendationSchema>;
