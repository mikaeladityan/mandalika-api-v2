import type { RequestBardatCycleDTO, QueryBardatCycleDTO } from "./bardat.cycle.schema.js";

const DAY = 86_400_000;
export function scheduleDates(rule: RequestBardatCycleDTO, period: QueryBardatCycleDTO): string[] {
    if (!rule.enabled) return [];
    const anchor = Date.parse(`${rule.start_date}T00:00:00Z`);
    const end = Math.min(Date.UTC(period.year, period.month, 1) - DAY, rule.end_date ? Date.parse(`${rule.end_date}T00:00:00Z`) : Infinity);
    const start = Math.max(Date.UTC(period.year, period.month - 1, 1), anchor);
    const dates: string[] = [];
    for (let time = start; time <= end; time += DAY) {
        const date = new Date(time);
        const matches = rule.pattern === "WEEKLY" ? rule.weekdays.includes(date.getUTCDay()) : rule.interval_days !== null && ((time - anchor) / DAY) % rule.interval_days === 0;
        if (matches) dates.push(date.toISOString().slice(0, 10));
    }
    return dates;
}
