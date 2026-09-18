import { Hono } from "hono";
import { ApiError } from "../../lib/errors/api.error.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ latest: vi.fn(), receipts: vi.fn(), reset: vi.fn(), findMany: vi.fn(), outlets: vi.fn(), findFirst: vi.fn(), upsert: vi.fn() }));
vi.mock("../../config/prisma.js", () => ({ default: { outletGoodsReceipt: { groupBy: mocks.receipts, findFirst: mocks.latest }, outletBardatCycle: { findMany: mocks.findMany, upsert: mocks.upsert, updateMany: mocks.reset }, outlet: { findMany: mocks.outlets, findFirst: mocks.findFirst } } }));
import { BardatCycleRoutes } from "../../module/application/outlet/bardat/cycle/bardat.cycle.routes.js";
const app = new Hono().route("/cycle", BardatCycleRoutes);
app.onError((error, c) => c.json({ message: error.message }, error instanceof ApiError ? error.statusCode : 500));
const body = { outlet_id: 1, pattern: "WEEKLY", weekdays: [1], interval_days: null, start_date: "2026-09-01", end_date: null, enabled: true };
afterEach(() => vi.useRealTimers());
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-15T00:00:00Z")); vi.resetAllMocks(); mocks.latest.mockResolvedValue(null); mocks.receipts.mockResolvedValue([]); mocks.outlets.mockResolvedValue([{ id: 1, code: "A", name: "Toko A" }]); });
describe("cycle API", () => {
    it("returns recommended weekdays from all BARDAT dates when selected month has none", async () => {
        mocks.latest.mockResolvedValue({ date: new Date("2026-09-01") });
        mocks.findMany.mockResolvedValue([]);
        mocks.receipts.mockResolvedValueOnce([]).mockResolvedValueOnce(["2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26"].map(date => ({ outlet_id: 1, date: new Date(date) })));
        const data = (await (await app.request("/cycle?month=9&year=2026")).json()).data;
        expect(data.pattern_weekdays).toEqual({ "1": [1] });
        expect(mocks.receipts).toHaveBeenLastCalledWith(expect.objectContaining({ where: { quantity: { gt: 0 }, outlet: { deleted_at: null } } }));
    });
    it.each([6, 7, 8, 9, 10])("projects April history into month %s through now plus one month", async month => {
        mocks.latest.mockResolvedValue({ date: new Date("2026-04-30") });
        mocks.findMany.mockResolvedValue([]);
        mocks.receipts.mockResolvedValueOnce([]).mockResolvedValueOnce(["2026-04-06", "2026-04-13", "2026-04-15", "2026-04-20", "2026-04-27"].map(date => ({ outlet_id: 1, date: new Date(date) })));
        const data = (await (await app.request(`/cycle?month=${month}&year=2026`)).json()).data;
        expect(data.entries.length).toBeGreaterThanOrEqual(4);
        expect(data.recommendation_until).toBe("2026-10");
        expect(data.entries.every((entry: { date: string; recommendation: { history_end: string } }) => new Date(entry.date).getUTCDay() === 1 && entry.recommendation.history_end === "2026-04-30")).toBe(true);
        expect(mocks.receipts).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ date: { gte: new Date("2026-02-01"), lt: new Date("2026-05-01") } }) }));
    });
    it("stops recommendations beyond now plus one month, while preserving overrides", async () => {
        mocks.latest.mockResolvedValue({ date: new Date("2026-04-30") });
        mocks.findMany.mockResolvedValue([{ ...body, id: 1, start_date: new Date("2026-11-01"), outlet: { id: 1, code: "A", name: "Toko A" } }]);
        const data = (await (await app.request("/cycle?month=11&year=2026")).json()).data;
        expect(data.entries).toHaveLength(5);
        expect(data.entries.every((entry: { source: string }) => entry.source === "OVERRIDE")).toBe(true);
        expect(mocks.receipts).toHaveBeenCalledTimes(2);
    });

    it("recommends frequent history for an empty future month and prioritizes overrides", async () => {
        mocks.latest.mockResolvedValue({ date: new Date("2026-04-30") });
        mocks.findMany.mockResolvedValue([{ ...body, id: 1, start_date: new Date("2026-05-11"), end_date: new Date("2026-05-18"), outlet: { id: 1, code: "A", name: "Toko A" } }]);
        mocks.receipts.mockResolvedValueOnce([]).mockResolvedValueOnce(["2026-04-06", "2026-04-13", "2026-04-15", "2026-04-20", "2026-04-27"].map(date => ({ outlet_id: 1, date: new Date(date) })));
        const response = await app.request("/cycle?month=5&year=2026");
        expect(response.status).toBe(200);
        const data = (await response.json()).data;
        expect(data.entries.map((entry: { date: string; source: string }) => [entry.date, entry.source])).toEqual([
            ["2026-05-04", "RECOMMENDATION"], ["2026-05-11", "OVERRIDE"], ["2026-05-18", "OVERRIDE"], ["2026-05-25", "RECOMMENDATION"],
        ]);
        expect(data.entries[0].recommendation).toMatchObject({ occurrences: 4, opportunities: 4, confidence: 100 });
        expect(mocks.receipts).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ quantity: { gt: 0 }, date: { gte: new Date("2026-02-01"), lt: new Date("2026-05-01") } }) }));
    });
    it("does not fill gaps in months containing actual receipts", async () => {
        mocks.latest.mockResolvedValue({ date: new Date("2026-05-04") });
        mocks.findMany.mockResolvedValue([]);
        mocks.receipts.mockResolvedValue([{ outlet_id: 1, date: new Date("2026-05-04") }]);
        const data = (await (await app.request("/cycle?month=5&year=2026")).json()).data;
        expect(data.entries).toHaveLength(1);
        expect(data.entries[0].source).toBe("BARDAT");
        expect(mocks.receipts).toHaveBeenCalledTimes(2);
    });

    it("exposes the latest BARDAT month when current month has no entries", async () => {
        mocks.findMany.mockResolvedValue([]);
        mocks.latest.mockResolvedValue({ date: new Date("2026-08-31") });
        const data = (await (await app.request("/cycle?month=9&year=2026")).json()).data;
        expect(data.latest_period).toBe("2026-08");
        expect(data.entries).toEqual([]);
    });
    it("uses BARDAT dates automatically with no manual rules", async () => {
        mocks.findMany.mockResolvedValue([]);
        mocks.receipts.mockResolvedValue([{ outlet_id: 1, date: new Date("2026-09-03") }, { outlet_id: 1, date: new Date("2026-09-10") }]);
        const response = await app.request("/cycle?month=9&year=2026");
        const data = (await response.json()).data;
        expect(data.entries).toEqual([
            { key: "1|2026-09-03", cycle_id: null, outlet_id: 1, outlet_code: "A", outlet_name: "Toko A", date: "2026-09-03", source: "BARDAT" },
            { key: "1|2026-09-10", cycle_id: null, outlet_id: 1, outlet_code: "A", outlet_name: "Toko A", date: "2026-09-10", source: "BARDAT" },
        ]);
        expect(mocks.receipts).toHaveBeenCalledWith(expect.objectContaining({ by: ["outlet_id", "date"], where: { date: { gte: new Date("2026-09-01"), lt: new Date("2026-10-01") }, outlet: { deleted_at: null } } }));
    });
    it("replaces only dates in the override range and keeps other stores", async () => {
        mocks.outlets.mockResolvedValue([{ id: 1, code: "A", name: "Toko A" }, { id: 2, code: "B", name: "Toko B" }]);
        mocks.findMany.mockResolvedValue([{ ...body, id: 1, start_date: new Date("2026-09-07"), end_date: new Date("2026-09-14"), outlet: { id: 1, code: "A", name: "Toko A" } }]);
        mocks.receipts.mockResolvedValue([
            { outlet_id: 1, date: new Date("2026-09-03") }, { outlet_id: 1, date: new Date("2026-09-10") },
            { outlet_id: 1, date: new Date("2026-09-14") }, { outlet_id: 1, date: new Date("2026-09-17") },
            { outlet_id: 2, date: new Date("2026-09-10") },
        ]);
        const data = (await (await app.request("/cycle?month=9&year=2026")).json()).data;
        expect(data.entries.map((entry: { key: string; source: string }) => [entry.key, entry.source])).toEqual([
            ["1|2026-09-03", "BARDAT"], ["1|2026-09-07", "OVERRIDE"], ["2|2026-09-10", "BARDAT"],
            ["1|2026-09-14", "OVERRIDE"], ["1|2026-09-17", "BARDAT"],
        ]);
    });
    it("falls back to BARDAT when override is disabled", async () => {
        mocks.findMany.mockResolvedValue([{ ...body, enabled: false, id: 1, start_date: new Date("2026-09-01"), outlet: { id: 1, code: "A", name: "Toko A" } }]);
        mocks.receipts.mockResolvedValue([{ outlet_id: 1, date: new Date("2026-09-03") }]);
        const data = (await (await app.request("/cycle?month=9&year=2026")).json()).data;
        expect(data.entries).toHaveLength(1);
        expect(data.entries[0]).toMatchObject({ date: "2026-09-03", source: "BARDAT", cycle_id: null });
    });
    it("resets override without changing receipt data", async () => {
        mocks.reset.mockResolvedValue({ count: 1 });
        const response = await app.request("/cycle/1/reset", { method: "PATCH" });
        expect(response.status).toBe(200);
        expect(mocks.reset).toHaveBeenCalledWith({ where: { outlet_id: 1 }, data: { enabled: false } });
    });

    it("keeps outlets visible before any shipping pattern is configured", async () => {
        mocks.findMany.mockResolvedValue([]);
        const res = await app.request("/cycle?month=9&year=2026");
        expect(res.status).toBe(200);
        expect((await res.json()).data).toEqual({ outlets: [{ id: 1, code: "A", name: "Toko A" }], rules: [], entries: [], pattern_weekdays: {}, latest_period: null, recommendation_until: "2026-10" });
        expect(mocks.outlets).toHaveBeenCalledWith(expect.objectContaining({ where: { deleted_at: null } }));
    });

    it("returns planned events without receipt records", async () => {
        mocks.findMany.mockResolvedValue([{ ...body, id: 1, start_date: new Date("2026-09-01"), outlet: { id: 1, code: "A", name: "Toko A" } }]);
        const res = await app.request("/cycle?month=9&year=2026");
        expect(res.status).toBe(200);
        expect((await res.json()).data.entries).toHaveLength(4);
    });
    it("saves a rule for an existing outlet", async () => {
        mocks.findFirst.mockResolvedValue({ id: 1 }); mocks.upsert.mockResolvedValue({ id: 1 });
        const res = await app.request("/cycle", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        expect(res.status).toBe(200);
        expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { outlet_id: 1 } }));
    });
    it("does not save invalid patterns", async () => {
        const res = await app.request("/cycle", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, weekdays: [] }) });
        expect(res.status).toBe(400);
        expect(mocks.upsert).not.toHaveBeenCalled();
    });
    it("does not save a deleted or missing outlet", async () => {
        mocks.findFirst.mockResolvedValue(null);
        const res = await app.request("/cycle", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        expect(res.status).toBe(404);
        expect(mocks.upsert).not.toHaveBeenCalled();
    });
});
