import { z } from "zod";

const ACCURACY_PERCENTAGE_REGEX = /^(\d+\.\d{2}%|N\/A)$/;

export const QueryForecastAccuracySchema = z.object({
    month: z.coerce.number().int().min(1).max(12).optional(),
    year: z.coerce.number().int().min(2000).max(2100).optional(),
    is_others: z
        .preprocess((v) => v === true || v === "true" || v === "1", z.boolean())
        .default(false),
    type_id: z.coerce.number().int().positive().optional(),
    size_id: z.coerce.number().int().positive().optional(),
    search: z.string().trim().min(1).optional(),
    page: z.coerce.number().int().positive().default(1),
    take: z.coerce.number().int().positive().max(500).default(25),
});

export const ResponseForecastAccuracyItemSchema = z.object({
    product_id: z.number(),
    product_code: z.string().nullable(),
    product_name: z.string(),
    product_type: z.string(),
    product_size: z.string(),
    forecast: z.number(),
    sales: z.number(),
    diff: z.number(),
    accuracy_percentage: z.string().regex(ACCURACY_PERCENTAGE_REGEX),
    on_target: z.boolean().nullable(),
});

export const ResponseForecastAccuracySchema = z.object({
    period: z.object({
        month: z.number().int().min(1).max(12),
        year: z.number().int(),
    }),
    summary: z.object({
        total_forecast: z.number(),
        total_sales: z.number(),
        accuracy_percentage: z.string().regex(ACCURACY_PERCENTAGE_REGEX),
        product_count: z.number().int(),
        excluded_count: z.number().int(),
        accurate_count: z.number().int(),
        inaccurate_count: z.number().int(),
    }),
    data: z.array(ResponseForecastAccuracyItemSchema),
    len: z.number().int(),
});

export type QueryForecastAccuracyDTO = z.infer<typeof QueryForecastAccuracySchema>;
export type ResponseForecastAccuracyItemDTO = z.infer<typeof ResponseForecastAccuracyItemSchema>;
export type ResponseForecastAccuracyDTO = z.infer<typeof ResponseForecastAccuracySchema>;

export const QueryForecastAccuracyTrendSchema = z.object({
    from_month: z.coerce.number().int().min(1).max(12),
    from_year: z.coerce.number().int().min(2000).max(2100),
    to_month: z.coerce.number().int().min(1).max(12),
    to_year: z.coerce.number().int().min(2000).max(2100),
    is_others: z
        .preprocess((v) => v === true || v === "true" || v === "1", z.boolean())
        .default(false),
});

export const ResponseForecastAccuracyTrendItemSchema = z.object({
    month: z.number().int(),
    year: z.number().int(),
    label: z.string(),
    accurate_count: z.number().int(),
    inaccurate_count: z.number().int(),
    excluded_count: z.number().int(),
    pct_accurate: z.number(),
    pct_inaccurate: z.number(),
});

export const ResponseForecastAccuracyTrendSchema = z.array(ResponseForecastAccuracyTrendItemSchema);

export type QueryForecastAccuracyTrendDTO = z.infer<typeof QueryForecastAccuracyTrendSchema>;
export type ResponseForecastAccuracyTrendItemDTO = z.infer<typeof ResponseForecastAccuracyTrendItemSchema>;
export type ResponseForecastAccuracyTrendDTO = z.infer<typeof ResponseForecastAccuracyTrendSchema>;
