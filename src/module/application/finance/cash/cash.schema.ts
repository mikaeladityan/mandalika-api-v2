import { z } from "zod";

export const CashEntryTypeEnum = z.enum(["RECEIPT", "PAYMENT", "CREDIT"]);
export const CashEntryStatusEnum = z.enum(["DRAFT", "POSTED"]);
export const PaymentMethodEnum = z.enum(["TRANSFER", "CASH", "GIRO"]);

export const QueryCashSchema = z.object({
    page: z.coerce.number().min(1).default(1),
    take: z.coerce.number().min(1).max(200).default(50),
    search: z.string().optional(),
    type: CashEntryTypeEnum.optional(),
    status: CashEntryStatusEnum.optional(),
    payment_method: PaymentMethodEnum.optional(),
    date_from: z.coerce.date().optional(),
    date_to: z.coerce.date().optional(),
    month: z.coerce.number().min(1).max(12).optional(),
    year: z.coerce.number().min(2000).optional(),
    sortBy: z.enum(["cash_date", "created_at", "amount"]).optional().default("cash_date"),
    order: z.enum(["asc", "desc"]).optional().default("desc"),
});

export type QueryCashDTO = z.infer<typeof QueryCashSchema>;

export const CreateCashSchema = z.object({
    cash_date: z.coerce.date(),
    type: CashEntryTypeEnum,
    source: z.string().min(1),
    reference: z.string().optional().nullable(),
    amount: z.number().positive(),
    payment_method: PaymentMethodEnum.optional().nullable(),
    bank_account: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
});

export type CreateCashDTO = z.infer<typeof CreateCashSchema>;
