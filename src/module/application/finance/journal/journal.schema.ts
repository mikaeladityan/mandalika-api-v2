import { z } from "zod";

export const JournalStatusEnum = z.enum(["DRAFT", "POSTED"]);

export const QueryJournalSchema = z.object({
    page: z.coerce.number().min(1).default(1),
    take: z.coerce.number().min(1).max(200).default(50),
    search: z.string().optional(),
    status: JournalStatusEnum.optional(),
    source: z.string().optional(),
    date_from: z.coerce.date().optional(),
    date_to: z.coerce.date().optional(),
    month: z.coerce.number().min(1).max(12).optional(),
    year: z.coerce.number().min(2000).optional(),
    sortBy: z.enum(["journal_date", "created_at", "debit"]).optional().default("journal_date"),
    order: z.enum(["asc", "desc"]).optional().default("desc"),
});

export type QueryJournalDTO = z.infer<typeof QueryJournalSchema>;

export const CreateJournalSchema = z.object({
    journal_date: z.coerce.date(),
    source: z.string().min(1),
    desc: z.string().min(1),
    debit: z.number().nonnegative(),
    credit: z.number().nonnegative(),
    notes: z.string().optional().nullable(),
});

export type CreateJournalDTO = z.infer<typeof CreateJournalSchema>;
