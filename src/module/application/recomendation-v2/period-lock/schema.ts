import { z } from "zod";

const PeriodSchema = z.object({
    month: z.coerce.number().int("Bulan harus bilangan bulat").min(1, "Bulan minimal 1").max(12, "Bulan maksimal 12"),
    year: z.coerce.number().int("Tahun harus bilangan bulat").min(2000, "Tahun minimal 2000").max(9999, "Tahun maksimal 9999"),
});

export const LockPeriodRequestSchema = PeriodSchema.extend({
    note: z.string().max(255, "Catatan maksimal 255 karakter").optional(),
}).strict();

export const UnlockPeriodRequestSchema = PeriodSchema.strict();

export const ListLocksQuerySchema = z.object({
    month: z.coerce.number().int().min(1).max(12).optional(),
    year: z.coerce.number().int().min(2000).max(9999).optional(),
}).strict();

export type LockPeriodRequest = z.infer<typeof LockPeriodRequestSchema>;
export type UnlockPeriodRequest = z.infer<typeof UnlockPeriodRequestSchema>;
export type ListLocksQuery = z.infer<typeof ListLocksQuerySchema>;
