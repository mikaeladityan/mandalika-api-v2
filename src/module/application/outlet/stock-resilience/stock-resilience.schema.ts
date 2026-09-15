import { z } from "zod";

export const QueryStockResilienceSchema = z.object({
    outlet_id: z.coerce.number().int().positive().optional(),
    product_id: z.coerce.number().int().positive().optional(),
    month: z.coerce.number().int().min(1).max(12).default(new Date().getMonth() + 1),
    year: z.coerce.number().int().min(2000).max(2100).default(new Date().getFullYear()),
});

export type QueryStockResilienceDTO = z.infer<typeof QueryStockResilienceSchema>;

export type StockResilienceRowDTO = {
    outlet_id: number;
    outlet_code: string;
    outlet_name: string;
    product_id: number;
    product_code: string;
    product_name: string;
    anchor_date: string;
    next_bardat_date: string | null;
    bardat_quantity: number;
    sales_quantity: number;
    resilience_quantity: number;
    status: "AMAN" | "HABIS" | "KURANG";
};

