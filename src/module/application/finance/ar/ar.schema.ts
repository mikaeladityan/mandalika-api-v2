import { z } from "zod";

export const ARStatusEnum = z.enum(["OPEN", "PARTIAL", "CLOSED"]);
export const ARPartnerTypeEnum = z.enum(["OUTLET", "RESELLER", "CUSTOMER", "EXTERNAL"]);

export const QueryARSchema = z.object({
    page: z.coerce.number().min(1).default(1),
    take: z.coerce.number().min(1).max(200).default(50),
    search: z.string().optional(),
    status: ARStatusEnum.optional(),
    partner_type: ARPartnerTypeEnum.optional(),
    partner_id: z.coerce.number().int().positive().optional(),
    month: z.coerce.number().min(1).max(12).optional(),
    year: z.coerce.number().min(2000).optional(),
    sortBy: z.enum(["due_date", "created_at", "amount"]).optional().default("due_date"),
    order: z.enum(["asc", "desc"]).optional().default("asc"),
});

export type QueryARDTO = z.infer<typeof QueryARSchema>;

export const ReceiveARSchema = z.object({
    received_amount: z.number().positive(),
    receipt_date: z.string(),
    payment_method: z.enum(["TRANSFER", "CASH", "GIRO"]),
    bank_account: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
});

export type ReceiveARDTO = z.infer<typeof ReceiveARSchema>;

export const CreateARSchema = z.object({
    partner_type: ARPartnerTypeEnum.default("CUSTOMER"),
    partner_id: z.number().int().positive().optional().nullable(),
    partner_name: z.string().min(1),
    source_doc: z.string().min(1),
    amount: z.number().positive(),
    due_date: z.coerce.date().optional().nullable(),
    notes: z.string().optional().nullable(),
});

export type CreateARDTO = z.infer<typeof CreateARSchema>;
