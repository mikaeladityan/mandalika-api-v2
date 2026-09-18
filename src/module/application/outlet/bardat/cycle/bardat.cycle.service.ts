import prisma from "../../../../../config/prisma.js";
import { ApiError } from "../../../../../lib/errors/api.error.js";
import { RequestBardatCycleSchema, type RequestBardatCycleDTO, type QueryBardatCycleDTO, type ResponseBardatCycleDTO, type BardatCycleEntryDTO } from "./bardat.cycle.schema.js";
import { scheduleDates } from "./bardat.cycle.schedule.js";
import { recommendDates, recommendWeekdaysFromHistory, recommendationHistoryRange, recommendationLastMonth } from "./bardat.cycle.recommendation.js";

export class BardatCycleService {
    static async list(period: QueryBardatCycleDTO) {
        const [records, outlets, receipts, latestReceipt] = await Promise.all([
            prisma.outletBardatCycle.findMany({ where: { outlet: { deleted_at: null } }, include: { outlet: { select: { id: true, code: true, name: true } } }, orderBy: { outlet: { code: "asc" } } }),
            prisma.outlet.findMany({ where: { deleted_at: null }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
            prisma.outletGoodsReceipt.groupBy({
                by: ["outlet_id", "date"],
                where: { date: { gte: new Date(Date.UTC(period.year, period.month - 1, 1)), lt: new Date(Date.UTC(period.year, period.month, 1)) }, outlet: { deleted_at: null } },
                orderBy: [{ date: "asc" }, { outlet_id: "asc" }],
            }),
            prisma.outletGoodsReceipt.findFirst({ where: { outlet: { deleted_at: null } }, orderBy: { date: "desc" }, select: { date: true } }),
        ]);
        const rules: ResponseBardatCycleDTO[] = records.map(record => ({
            ...RequestBardatCycleSchema.parse({ ...record, start_date: record.start_date.toISOString().slice(0, 10), end_date: record.end_date?.toISOString().slice(0, 10) ?? null }),
            id: record.id, outlet: record.outlet,
        }));
        const outletMap = new Map(outlets.map(outlet => [outlet.id, outlet]));
        const overrides = new Map(rules.filter(rule => rule.enabled).map(rule => [rule.outlet_id, rule]));
        const entries: BardatCycleEntryDTO[] = receipts.flatMap(receipt => {
            const outlet = outletMap.get(receipt.outlet_id);
            const date = receipt.date.toISOString().slice(0, 10);
            const override = overrides.get(receipt.outlet_id);
            // Only replace BARDAT dates inside the override's effective range.
            if (!outlet || (override && date >= override.start_date && (!override.end_date || date <= override.end_date))) return [];
            return [{ key: `${outlet.id}|${date}`, cycle_id: null, outlet_id: outlet.id, outlet_code: outlet.code, outlet_name: outlet.name, date, source: "BARDAT" as const }];
        });
        entries.push(...rules.flatMap(rule => scheduleDates(rule, period).map(date => ({ key: `${rule.outlet_id}|${date}`, cycle_id: rule.id, outlet_id: rule.outlet_id, outlet_code: rule.outlet.code, outlet_name: rule.outlet.name, date, source: "OVERRIDE" as const }))));
        const periodStart = new Date(Date.UTC(period.year, period.month - 1, 1));
        const lastRecommendationMonth = recommendationLastMonth();
        // Never fill gaps in recorded months or learn from overrides/recommendations.
        if (!receipts.length && latestReceipt && periodStart > latestReceipt.date && periodStart <= lastRecommendationMonth) {
            const historyRange = recommendationHistoryRange(latestReceipt.date);
            const history = await prisma.outletGoodsReceipt.groupBy({
                by: ["outlet_id", "date"],
                where: { quantity: { gt: 0 }, date: { gte: historyRange.start, lt: historyRange.end }, outlet: { deleted_at: null } },
                orderBy: [{ date: "asc" }, { outlet_id: "asc" }],
            });
            const byOutlet = new Map<number, Date[]>();
            for (const record of history) byOutlet.set(record.outlet_id, [...(byOutlet.get(record.outlet_id) ?? []), record.date]);
            for (const [outletId, dates] of byOutlet) {
                const outlet = outletMap.get(outletId);
                if (!outlet) continue;
                const override = overrides.get(outletId);
                for (const candidate of recommendDates(dates, period, latestReceipt.date)) {
                    if (override && candidate.date >= override.start_date && (!override.end_date || candidate.date <= override.end_date)) continue;
                    entries.push({ key: `${outletId}|${candidate.date}`, cycle_id: null, outlet_id: outletId, outlet_code: outlet.code, outlet_name: outlet.name, date: candidate.date, source: "RECOMMENDATION", recommendation: candidate.recommendation });
                }
            }
        }
        const allHistory = await prisma.outletGoodsReceipt.groupBy({
            by: ["outlet_id", "date"],
            where: { quantity: { gt: 0 }, outlet: { deleted_at: null } },
            orderBy: [{ date: "asc" }, { outlet_id: "asc" }],
        });
        const datesByOutlet = new Map<number, Date[]>();
        for (const receipt of allHistory) datesByOutlet.set(receipt.outlet_id, [...(datesByOutlet.get(receipt.outlet_id) ?? []), receipt.date]);
        const pattern_weekdays = Object.fromEntries([...datesByOutlet].map(([outletId, dates]) => [outletId, recommendWeekdaysFromHistory(dates)]));
        entries.sort((a, b) => a.date.localeCompare(b.date) || a.outlet_code.localeCompare(b.outlet_code));
        return { rules, entries, outlets, pattern_weekdays, latest_period: latestReceipt?.date.toISOString().slice(0, 7) ?? null, recommendation_until: lastRecommendationMonth.toISOString().slice(0, 7) };
    }

    static async save(body: RequestBardatCycleDTO) {
        const outlet = await prisma.outlet.findFirst({ where: { id: body.outlet_id, deleted_at: null }, select: { id: true } });
        if (!outlet) throw new ApiError(404, "Toko tidak ditemukan atau sudah tidak aktif");
        const data = { ...body, start_date: new Date(`${body.start_date}T00:00:00Z`), end_date: body.end_date ? new Date(`${body.end_date}T00:00:00Z`) : null };
        await prisma.outletBardatCycle.upsert({ where: { outlet_id: body.outlet_id }, create: data, update: data });
        return { message: "Override BARDAT Cycle berhasil disimpan" };
    }

    static async reset(outletId: number) {
        await prisma.outletBardatCycle.updateMany({ where: { outlet_id: outletId }, data: { enabled: false } });
        return { message: "Cycle kembali mengikuti tanggal BARDAT" };
    }
}
