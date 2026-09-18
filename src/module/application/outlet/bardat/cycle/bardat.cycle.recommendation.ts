import type { QueryBardatCycleDTO, BardatCycleRecommendationDTO } from "./bardat.cycle.schema.js";

const DAY = 86_400_000;
export const MIN_OCCURRENCES = 3;
export const MIN_FREQUENCY = 0.6;
export const RECENCY_DAYS = 21;

export function recommendWeekdaysFromHistory(history: Date[]): number[] {
    const dates = [...new Set(history.map(date => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())))].sort((a, b) => a - b);
    if (!dates.length) return [];
    const first = dates[0]!;
    const last = dates.at(-1)!;
    return Array.from({ length: 7 }, (_, weekday) => weekday).filter(weekday => {
        const occurrences = dates.filter(date => new Date(date).getUTCDay() === weekday).length;
        let opportunities = 0;
        for (let date = first; date <= last; date += DAY) if (new Date(date).getUTCDay() === weekday) opportunities++;
        return occurrences >= MIN_OCCURRENCES && occurrences / opportunities >= MIN_FREQUENCY;
    });
}

export function recommendationLastMonth(now = new Date()): Date {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit" }).formatToParts(now);
    const year = Number(parts.find(part => part.type === "year")?.value);
    const month = Number(parts.find(part => part.type === "month")?.value);
    return new Date(Date.UTC(year, month, 1));
}

export function recommendationHistoryRange(latestDate: Date) {
    return {
        start: new Date(Date.UTC(latestDate.getUTCFullYear(), latestDate.getUTCMonth() - 2, 1)),
        end: new Date(Date.UTC(latestDate.getUTCFullYear(), latestDate.getUTCMonth(), latestDate.getUTCDate() + 1)),
    };
}

// Only actual, positive-quantity BARDAT dates are supplied. Multiple SKUs count once.
export function recommendDates(history: Date[], period: QueryBardatCycleDTO, latestDate = new Date(Date.UTC(period.year, period.month - 1, 1) - DAY)): Array<{ date: string; recommendation: BardatCycleRecommendationDTO }> {
    const start = Date.UTC(period.year, period.month - 1, 1);
    const end = Date.UTC(period.year, period.month, 1);
    const range = recommendationHistoryRange(latestDate);
    const windowStart = range.start.getTime();
    const historyEnd = Math.min(range.end.getTime(), start);
    const dates = [...new Set(history.map(date => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())))].filter(date => date >= windowStart && date < historyEnd).sort((a, b) => a - b);
    const first = dates[0];
    if (first === undefined) return [];
    const observedStart = Math.max(windowStart, first - ((new Date(first).getUTCDay() + 6) % 7) * DAY);
    const results: Array<{ date: string; recommendation: BardatCycleRecommendationDTO }> = [];
    for (let weekday = 0; weekday < 7; weekday++) {
        const matches = dates.filter(date => new Date(date).getUTCDay() === weekday);
        const last = matches.at(-1);
        let opportunities = 0;
        for (let date = observedStart; date < historyEnd; date += DAY) if (new Date(date).getUTCDay() === weekday) opportunities++;
        if (matches.length < MIN_OCCURRENCES || !opportunities || matches.length / opportunities < MIN_FREQUENCY || last === undefined || historyEnd - last > RECENCY_DAYS * DAY) continue;
        const recommendation: BardatCycleRecommendationDTO = {
            weekday, occurrences: matches.length, opportunities,
            confidence: Math.round(matches.length / opportunities * 100),
            history_start: new Date(observedStart).toISOString().slice(0, 10),
            history_end: new Date(historyEnd - DAY).toISOString().slice(0, 10),
        };
        for (let date = start; date < end; date += DAY) {
            if (new Date(date).getUTCDay() === weekday) results.push({ date: new Date(date).toISOString().slice(0, 10), recommendation });
        }
    }
    return results.sort((a, b) => a.date.localeCompare(b.date));
}
