import { z } from "zod";

export const APStatusEnum = z.enum(["UNPAID", "DP_PAID", "PARTIALLY_PAID", "PAID"]);
export const APTypeEnum = z.enum(["DP", "GOODS_RECEIPT", "TERM", "FULL"]);

export const QueryAPSchema = z.object({
    page: z.coerce.number().min(1).default(1),
    take: z.coerce.number().min(1).max(200).default(50),
    search: z.string().optional(),
    status: APStatusEnum.optional(),
    ap_type: APTypeEnum.optional(),
    supplier_id: z.coerce.number().int().positive().optional(),
    po_id: z.coerce.number().int().positive().optional(),
    receipt_id: z.coerce.number().int().positive().optional(),
    month: z.coerce.number().min(1).max(12).optional(),
    year: z.coerce.number().min(2000).optional(),
    sortBy: z.enum(["due_date", "created_at", "amount"]).optional(),
    order: z.enum(["asc", "desc"]).optional().default("asc"),
});

export type QueryAPDTO = z.infer<typeof QueryAPSchema>;

export const PayAPSchema = z.object({
    paid_amount: z.number().positive(),
    payment_date: z.string(),
    payment_method: z.enum(["TRANSFER", "CASH", "GIRO"]),
    bank_account: z.string().optional().nullable(),
    invoice_number: z.string().optional().nullable(),
    invoice_date: z.coerce.date().optional().nullable(),
    due_date: z.coerce.date().optional().nullable(),
    notes: z.string().optional().nullable(),
});

export type PayAPDTO = z.infer<typeof PayAPSchema>;
