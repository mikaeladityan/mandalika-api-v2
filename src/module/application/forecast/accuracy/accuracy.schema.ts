import { z } from "zod";

const ACCURACY_PERCENTAGE_REGEX = /^(-?\d+\.\d{2}%|N\/A)$/;

export const QueryForecastAccuracySchema = z.object({
    month: z.coerce.number().int().min(1).max(12).optional(),
    year: z.coerce.number().int().min(2000).max(2100).optional(),
    is_others: z
        .preprocess((v) => v === true || v === "true" || v === "1", z.boolean())
        .default(false),
    type_id: z.coerce.number().int().positive().optional(),
    size_id: z.coerce.number().int().positive().optional(),
    tolerance: z.coerce.number().min(0.5).max(50).default(25),
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
    accuracy_status: z.enum(["tepat_sasaran", "under", "over"]).nullable(),
});

export const ResponseForecastAccuracySchema = z.object({
    period: z.object({
        month: z.number().int().min(1).max(12),
        year: z.number().int(),
    }),
    tolerance: z.number(),
    summary: z.object({
        total_forecast: z.number(),
        total_sales: z.number(),
        accuracy_percentage: z.string().regex(ACCURACY_PERCENTAGE_REGEX),
        bias_percentage: z.string().regex(ACCURACY_PERCENTAGE_REGEX),
        product_count: z.number().int(),
        excluded_count: z.number().int(),
        accurate_count: z.number().int(),
        under_count: z.number().int(),
        over_count: z.number().int(),
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
    tolerance: z.coerce.number().min(0.5).max(50).default(25),
});

export const ResponseForecastAccuracyTrendItemSchema = z.object({
    month: z.number().int(),
    year: z.number().int(),
    label: z.string(),
    accurate_count: z.number().int(),
    under_count: z.number().int(),
    over_count: z.number().int(),
    excluded_count: z.number().int(),
    pct_accurate: z.number(),
    pct_under: z.number(),
    pct_over: z.number(),
});

export const ResponseForecastAccuracyTrendSchema = z.array(ResponseForecastAccuracyTrendItemSchema);

export type QueryForecastAccuracyTrendDTO = z.infer<typeof QueryForecastAccuracyTrendSchema>;
export type ResponseForecastAccuracyTrendItemDTO = z.infer<typeof ResponseForecastAccuracyTrendItemSchema>;
export type ResponseForecastAccuracyTrendDTO = z.infer<typeof ResponseForecastAccuracyTrendSchema>;

// ─── EDAR vs ACT ──────────────────────────────────────────────────────────────

export const QueryEdarVsActSchema = z.object({
    from_month: z.coerce.number().int().min(1).max(12),
    from_year:  z.coerce.number().int().min(2000).max(2100),
    to_month:   z.coerce.number().int().min(1).max(12),
    to_year:    z.coerce.number().int().min(2000).max(2100),
    search:     z.string().trim().min(1).optional(),
    page:       z.coerce.number().int().positive().default(1),
    take:       z.coerce.number().int().positive().max(500).default(25),
});

export const ResponseEdarVsActMonthItemSchema = z.object({
    month:            z.number().int(),
    year:             z.number().int(),
    own_sales:        z.number(),
    pair_total_sales: z.number(),
    actual_pct:       z.number().nullable(),
    diff:             z.number().nullable(),
});

export const ResponseEdarVsActItemSchema = z.object({
    product_id:   z.number().int(),
    product_code: z.string().nullable(),
    product_name: z.string(),
    product_type: z.string(),
    product_size: z.string(),
    edar_pct:     z.number(),
    group_key:    z.string(),
    months:       z.array(ResponseEdarVsActMonthItemSchema),
});

export const ResponseEdarVsActSummaryMonthSchema = z.object({
    month:          z.number().int(),
    year:           z.number().int(),
    label:          z.string(),
    on_target:      z.number().int(),
    warning:        z.number().int(),
    off_target:     z.number().int(),
    no_data:        z.number().int(),
    avg_actual_pct: z.number().nullable(),
});

export const ResponseEdarVsActSchema = z.object({
    period: z.object({
        from_month: z.number().int(),
        from_year:  z.number().int(),
        to_month:   z.number().int(),
        to_year:    z.number().int(),
    }),
    months: z.array(z.object({ month: z.number().int(), year: z.number().int(), label: z.string() })),
    summary: z.object({
        total_products: z.number().int(),
        total_groups:   z.number().int(),
        avg_edar_pct:   z.number(),
        by_month:       z.array(ResponseEdarVsActSummaryMonthSchema),
    }),
    data: z.array(ResponseEdarVsActItemSchema),
    len:  z.number().int(),
});

export type QueryEdarVsActDTO             = z.infer<typeof QueryEdarVsActSchema>;
export type ResponseEdarVsActItemDTO      = z.infer<typeof ResponseEdarVsActItemSchema>;
export type ResponseEdarVsActMonthItemDTO = z.infer<typeof ResponseEdarVsActMonthItemSchema>;
export type ResponseEdarVsActDTO          = z.infer<typeof ResponseEdarVsActSchema>;
