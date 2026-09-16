import { z } from "zod";

export const QueryStockResilienceSchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    take: z.coerce.number().int().positive().max(100).default(25),
    search: z.string().trim().optional(),
    outlet_id: z.coerce.number().int().positive().optional(),
    product_id: z.coerce.number().int().positive().optional(),
    month: z.coerce.number().int().min(1).max(12).default(new Date().getMonth() + 1),
    year: z.coerce.number().int().min(2000).max(2100).default(new Date().getFullYear()),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type QueryStockResilienceDTO = z.infer<typeof QueryStockResilienceSchema>;

export type StockResilienceRowDTO = {
    outlet_id: number;
    outlet_code: string;
    outlet_name: string;
    product_id: number;
    product_code: string;
    product_name: string;
    anchor_number: number;
    anchor_date: string;
    next_bardat_date: string | null;
    bardat_quantity: number;
    sales_quantity: number;
    resilience_quantity: number;
    average_daily_sales: number;
    resilience_days: number | null;
    sales_per_week: number;
    net_weekly_change: number;
    starting_stock_estimate: number;
    minimum_starting_stock: number;
    stock_health: "SEHAT" | "TERGERUS";
    status: "AMAN" | "HABIS" | "KURANG";
};
