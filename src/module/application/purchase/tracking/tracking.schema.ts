import { z } from "zod";

export const QueryTrackingSchema = z.object({
    page: z.coerce.number().min(1).default(1),
    take: z.coerce.number().min(1).max(200).default(50),
    search: z.string().optional(),
    order_status: z.enum(["ORDERED", "SHIPPED", "ARRIVED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"]).optional(),
    payment_status: z.enum(["UNPAID", "DP_PAID", "PARTIALLY_PAID", "PAID"]).optional(),
    supplier_id: z.coerce.number().int().positive().optional(),
    month: z.coerce.number().min(1).max(12).optional(),
    year: z.coerce.number().min(2000).optional(),
    sortBy: z.enum(["updated_at", "created_at", "eta_date"]).optional(),
    order: z.enum(["asc", "desc"]).optional().default("desc"),
});

export type QueryTrackingDTO = z.infer<typeof QueryTrackingSchema>;

export const UpdateTrackingSchema = z.object({
    order_status: z.enum(["ORDERED", "SHIPPED", "ARRIVED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"]).optional(),
    payment_status: z.enum(["UNPAID", "DP_PAID", "PARTIALLY_PAID", "PAID"]).optional(),
    eta_date: z.coerce.date().optional().nullable(),
    ship_date: z.coerce.date().optional().nullable(),
    arrive_date: z.coerce.date().optional().nullable(),
    dp_paid_date: z.coerce.date().optional().nullable(),
    dp_paid_pct: z.number().min(0).max(100).optional().nullable(),
    final_paid_date: z.coerce.date().optional().nullable(),
    tracking_number: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
});

export type UpdateTrackingDTO = z.infer<typeof UpdateTrackingSchema>;
