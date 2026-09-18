import { describe, expect, it } from "vitest";
import { recommendDates, recommendWeekdaysFromHistory, recommendationLastMonth } from "../../module/application/outlet/bardat/cycle/bardat.cycle.recommendation.js";
const period = { month: 5, year: 2026 };
const dates = (...values: string[]) => values.map(value => new Date(value));
describe("recurring delivery recommendations", () => {
    it("calculates weekday pattern across all BARDAT history, independent of selected month", () => {
        expect(recommendWeekdaysFromHistory(dates("2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26", "2026-01-07"))).toEqual([1]);
    });
    it("uses Jakarta current month and handles year rollover for the horizon", () => {
        expect(recommendationLastMonth(new Date("2026-09-15T00:00:00Z")).toISOString()).toBe("2026-10-01T00:00:00.000Z");
        expect(recommendationLastMonth(new Date("2026-09-30T17:00:00Z")).toISOString()).toBe("2026-11-01T00:00:00.000Z");
        expect(recommendationLastMonth(new Date("2026-12-31T00:00:00Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
    });
    it("keeps frequency tied to actual history when projecting farther ahead", () => {
        const result = recommendDates(dates("2026-04-06", "2026-04-13", "2026-04-15", "2026-04-20", "2026-04-27"), { month: 10, year: 2026 }, new Date("2026-04-30"));
        expect(result.map(row => row.date)).toEqual(["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
        expect(result[0]?.recommendation).toMatchObject({ occurrences: 4, opportunities: 4, confidence: 100, history_end: "2026-04-30" });
    });

    it("recommends routine Mondays and excludes an isolated urgent Wednesday", () => {
        const result = recommendDates(dates("2026-04-06", "2026-04-13", "2026-04-15", "2026-04-20", "2026-04-27"), period);
        expect(result.map(row => row.date)).toEqual(["2026-05-04", "2026-05-11", "2026-05-18", "2026-05-25"]);
        expect(result[0]?.recommendation).toMatchObject({ occurrences: 4, opportunities: 4, confidence: 100 });
    });
    it("does not inflate frequency for multiple SKUs on the same date", () => {
        expect(recommendDates(dates("2026-04-06", "2026-04-06", "2026-04-06", "2026-04-27"), period)).toEqual([]);
    });
    it("accepts 3 of 4 observed weeks", () => {
        expect(recommendDates(dates("2026-04-06", "2026-04-13", "2026-04-27"), period)).toHaveLength(4);
    });
    it("rejects sparse deliveries across a long observation window", () => {
        expect(recommendDates(dates("2026-02-02", "2026-03-02", "2026-04-27"), period)).toEqual([]);
    });
    it("rejects stale patterns and future data", () => {
        expect(recommendDates(dates("2026-03-02", "2026-03-09", "2026-03-16", "2026-03-23", "2026-03-30", "2026-05-04"), period)).toEqual([]);
    });
    it("can recommend multiple independently frequent weekdays", () => {
        const result = recommendDates(dates("2026-04-06", "2026-04-09", "2026-04-13", "2026-04-16", "2026-04-20", "2026-04-23", "2026-04-27", "2026-04-30"), period);
        expect(result).toHaveLength(8);
    });
    it("handles a year boundary", () => {
        const result = recommendDates(dates("2026-12-07", "2026-12-14", "2026-12-21", "2026-12-28"), { month: 1, year: 2027 });
        expect(result.map(row => row.date)).toEqual(["2027-01-04", "2027-01-11", "2027-01-18", "2027-01-25"]);
    });
});
