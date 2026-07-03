import { z } from "zod";

// ─── Run Forecast ──────────────────────────────────────────────────────────────

export const RunForecastSchema = z.object({
    product_id: z.coerce.number().optional().nullable(),
    start_month: z.coerce.number().int().min(1).max(12),
    start_year: z.coerce.number().int().min(2000).max(2100),
    horizon: z.coerce.number().int().min(1).max(12).default(12),
    is_others: z.boolean().optional(),
});

// ─── Query ─────────────────────────────────────────────────────────────────────

export const QueryForecastSchema = z.object({
    search: z.string().optional(),
    status: z.enum(["DRAFT", "FINALIZED", "ADJUSTED"]).optional(),
    page: z.coerce.number().int().positive().default(1).optional(),
    take: z.coerce.number().int().positive().max(1000).default(25).optional(),
    horizon: z.coerce.number().int().min(3).max(12).default(12).optional(),
    is_others: z.coerce.boolean().optional(),
    type_id: z.coerce.number().optional(),
    size_id: z.coerce.number().optional(),
    start_month: z.coerce.number().int().min(1).max(12).optional(),
    start_year: z.coerce.number().int().min(2000).max(2100).optional(),
    visibleColumns: z.string().optional(),
    columnOrder: z.string().optional(),
});

// ─── Finalize ──────────────────────────────────────────────────────────────────

export const FinalizeForecastSchema = z.object({
    month: z.coerce.number().int().min(1).max(12),
    year: z.coerce.number().int().min(2000).max(2100),
});

// ─── Delete by Period ──────────────────────────────────────────────────────────

export const DeleteForecastByPeriodSchema = z.object({
    month: z.coerce.number().int().min(1).max(12),
    year: z.coerce.number().int().min(2000).max(2100),
});

// ─── Reconcile ────────────────────────────────────────────────────────────────

export const RequestReconcileSchema = z.object({
    product_id: z.coerce.number().int().positive(),
    month: z.coerce.number().int().min(1).max(12).optional(),
    year: z.coerce.number().int().min(2000).optional(),
});

// ─── Add Ratio ────────────────────────────────────────────────────────────────

export const RequestAddRatioForecastSchema = z.object({
    product_id: z.coerce.number().int().positive(),
    month: z.coerce.number().int().min(1).max(12),
    year: z.coerce.number().int().min(2000),
    additionalRatio: z.coerce.number(),
});

// ─── Manual Update ─────────────────────────────────────────────────────────────

export const UpdateManualForecastSchema = z.object({
    product_id: z.coerce.number().int().positive(),
    month: z.coerce.number().int().min(1).max(12),
    year: z.coerce.number().int().min(2000).max(2100),
    final_forecast: z.coerce.number().min(0).optional(),
    ratio: z.coerce.number().optional(),
});

// ─── Types / DTOs ──────────────────────────────────────────────────────────────

export type RunForecastDTO = z.infer<typeof RunForecastSchema>;
export type QueryForecastDTO = z.infer<typeof QueryForecastSchema>;
export type FinalizeForecastDTO = z.infer<typeof FinalizeForecastSchema>;
export type DeleteForecastByPeriodDTO = z.infer<typeof DeleteForecastByPeriodSchema>;
export type RequestReconcileDTO = z.infer<typeof RequestReconcileSchema>;
export type RequestAddRatioForecastDTO = z.infer<typeof RequestAddRatioForecastSchema>;
export type UpdateManualForecastDTO = z.infer<typeof UpdateManualForecastSchema>;

export type ResponseForecastDTO = {
    product_id: number;
    product_code: string | null;
    product_name: string;
    product_type: string;
    product_size: string;
    z_value: number;
    distribution_percentage: number | null;
    safety_percentage: number | null;
    current_stock: number;
    stock_by_warehouse: Array<{
        warehouse_id: number;
        warehouse_name: string;
        stock: number;
    }>;
    need_produce: number;
    edar_sales_share: {
        month: number;
        year: number;
        own_sales: number;
        pair_total_sales: number;
        actual_pct: number | null;
        members: Array<{
            product_id: number;
            product_code: string | null;
            product_type: string;
            edar_pct: number;
            sales: number;
            actual_pct: number | null;
        }>;
    } | null;
    monthly_data: Array<{
        month: number;
        year: number;
        period: string;
        base_forecast: number;
        final_forecast: number | null;
        trend: string;
        status: string | null;
        is_current_month: boolean;
        is_actionable: boolean;
        ratio: number;
        percentage_value: number | null;
    }>;
    historical_sales: Array<{
        month: number;
        year: number;
        period: string;
        quantity: number;
    }>;
    safety_stock_summary: {
        safety_stock_quantity: number | null;
        safety_stock_ratio: number | null;
        avg_forecast: number | null;
        total_forecast: number | null;
        total_demand: number | null;
        last_updated: Date | null;
    } | null;
};
