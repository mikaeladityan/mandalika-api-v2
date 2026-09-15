import { z } from "zod";

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Tanggal tidak valid");

export const RequestBardatCycleSchema = z.object({
    outlet_id: z.number().int().positive("Pilih toko"),
    pattern: z.enum(["WEEKLY", "INTERVAL"]),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7),
    interval_days: z.number().int().min(1).max(365).nullable(),
    start_date: DateSchema,
    end_date: DateSchema.nullable(),
    enabled: z.boolean(),
}).superRefine((value, ctx) => {
    if (value.end_date && value.end_date < value.start_date) ctx.addIssue({ code: "custom", path: ["end_date"], message: "Tanggal akhir harus setelah tanggal mulai" });
    if (value.pattern === "WEEKLY" && (!value.weekdays.length || value.interval_days !== null)) ctx.addIssue({ code: "custom", path: ["weekdays"], message: "Pilih minimal satu hari; interval harus kosong" });
    if (value.pattern === "INTERVAL" && (value.interval_days === null || value.weekdays.length)) ctx.addIssue({ code: "custom", path: ["interval_days"], message: "Isi interval 1–365 hari; pilihan hari harus kosong" });
    if (new Set(value.weekdays).size !== value.weekdays.length) ctx.addIssue({ code: "custom", path: ["weekdays"], message: "Hari tidak boleh duplikat" });
});
export const QueryBardatCycleSchema = z.object({
    month: z.coerce.number().int().min(1).max(12),
    year: z.coerce.number().int().min(2000).max(2100),
});
export type RequestBardatCycleDTO = z.infer<typeof RequestBardatCycleSchema>;
export type QueryBardatCycleDTO = z.infer<typeof QueryBardatCycleSchema>;
export type ResponseBardatCycleDTO = RequestBardatCycleDTO & { id: number; outlet: { id: number; code: string; name: string } };
export type BardatCycleRecommendationDTO = { weekday: number; occurrences: number; opportunities: number; confidence: number; history_start: string; history_end: string };
export type BardatCycleEntryDTO = { key: string; cycle_id: number | null; outlet_id: number; outlet_code: string; outlet_name: string; date: string; source: "BARDAT" | "OVERRIDE" | "RECOMMENDATION"; recommendation?: BardatCycleRecommendationDTO };
