import { describe, expect, it } from "vitest";
import { scheduleDates } from "../../module/application/outlet/bardat/cycle/bardat.cycle.schedule.js";
import { RequestBardatCycleSchema, type RequestBardatCycleDTO } from "../../module/application/outlet/bardat/cycle/bardat.cycle.schema.js";
const rule: RequestBardatCycleDTO = { outlet_id: 1, pattern: "WEEKLY", weekdays: [1, 4], interval_days: null, start_date: "2026-09-01", end_date: null, enabled: true };
describe("BARDAT recurring schedules", () => {
    it("includes every selected weekday within inclusive effective dates", () => {
        expect(scheduleDates({ ...rule, start_date: "2026-09-07", end_date: "2026-09-17" }, { month: 9, year: 2026 })).toEqual(["2026-09-07", "2026-09-10", "2026-09-14", "2026-09-17"]);
    });
    it("keeps interval anchored across month and year boundaries", () => {
        expect(scheduleDates({ ...rule, pattern: "INTERVAL", weekdays: [], interval_days: 10, start_date: "2025-12-28" }, { month: 1, year: 2026 })).toEqual(["2026-01-07", "2026-01-17", "2026-01-27"]);
    });
    it("handles leap days", () => {
        expect(scheduleDates({ ...rule, pattern: "INTERVAL", weekdays: [], interval_days: 1, start_date: "2024-02-28" }, { month: 2, year: 2024 })).toEqual(["2024-02-28", "2024-02-29"]);
    });
    it("omits disabled and out-of-range rules", () => {
        expect(scheduleDates({ ...rule, enabled: false }, { month: 9, year: 2026 })).toEqual([]);
        expect(scheduleDates(rule, { month: 8, year: 2026 })).toEqual([]);
        expect(scheduleDates({ ...rule, end_date: "2026-09-30" }, { month: 10, year: 2026 })).toEqual([]);
    });
    it.each([
        { weekdays: [] }, { weekdays: [7] }, { weekdays: [1, 1] },
        { pattern: "INTERVAL", weekdays: [], interval_days: 0 },
        { pattern: "INTERVAL", weekdays: [], interval_days: null },
        { start_date: "2026-02-30" }, { end_date: "2026-08-31" },
    ])("rejects invalid rule %j", change => {
        expect(RequestBardatCycleSchema.safeParse({ ...rule, ...change }).success).toBe(false);
    });
});
