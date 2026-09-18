import { Hono } from "hono";
import routes from "../../module/application/recomendation-v2/recomendation-v2.routes.js";
import { ApiError } from "../../lib/errors/api.error.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequestBulkResetSchema } from "../../module/application/recomendation-v2/recomendation-v2.schema.js";
import { RecomendationV2Service } from "../../module/application/recomendation-v2/recomendation-v2.service.js";
const db = vi.hoisted(() => ({ $executeRaw: vi.fn(), $queryRaw: vi.fn() }));
vi.mock("../../config/prisma.js", () => ({ default: db }));

describe("Bulk reset Work Orders", () => {
    beforeEach(() => vi.resetAllMocks());
    it.each([{}, { month: 0, year: 2026, type: "ffo" }, { month: 9.5, year: 2026, type: "ffo" }, { month: 9, year: 2026 }, { month: 9, year: 2026, type: "tester" }, { month: 9, year: 2026, type: "ffo", product_status: "PENDING" }])("rejects unsafe scope %j", body => {
        expect(RequestBulkResetSchema.safeParse(body).success).toBe(false);
    });
    it.each(["ffo", "impor", "lokal"] as const)("restricts %s deletion to exact period, ACTIVE and deletable statuses", async type => {
        db.$executeRaw.mockResolvedValue(3);
        expect(await RecomendationV2Service.bulkResetWorkOrders({ month: 9, year: 2026, type })).toEqual({ count: 3 });
        const sql = db.$executeRaw.mock.calls[0]![0];
        expect(sql.text).toContain('d.month = $1 AND d.year = $2');
        expect(sql.values.slice(0, 2)).toEqual([9, 2026]);
        expect(sql.text).toContain("d.product_status = 'ACTIVE'");
        expect(sql.text).toContain("d.status IN ('DRAFT', 'ACC')");
        expect(sql.text).toContain('DELETE FROM "material_purchase_drafts"');
        if (type === "ffo") expect(sql.text).toContain("%fragrance-oil%");
        else expect(sql.text).toContain(type === "impor" ? "s.source = 'IMPORT'" : "s.source = 'LOCAL'");
    });
    it("previews same scope without deleting", async () => {
        db.$queryRaw.mockResolvedValue([{ count: 5 }]);
        expect(await RecomendationV2Service.previewBulkReset({ month: 1, year: 2027, type: "ffo" })).toEqual({ count: 5 });
        expect(db.$executeRaw).not.toHaveBeenCalled();
        expect(db.$queryRaw.mock.calls[0]![0].values.slice(0, 2)).toEqual([1, 2027]);
    });
    it("returns zero for empty scope", async () => {
        db.$executeRaw.mockResolvedValue(0);
        expect(await RecomendationV2Service.bulkResetWorkOrders({ month: 9, year: 2026, type: "ffo" })).toEqual({ count: 0 });
    });
});


describe("Bulk reset HTTP contract", () => {
    const app = new Hono().route("/", routes);
    app.onError((error, c) => c.json({ message: error.message }, error instanceof ApiError ? error.statusCode : 500));
    it("rejects missing month before reaching the database", async () => {
        db.$executeRaw.mockClear();
        const response = await app.request("/bulk-reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ year: 2026, type: "ffo" }) });
        expect(response.status).toBe(400);
        expect(db.$executeRaw).not.toHaveBeenCalled();
    });
    it("routes preview and reset separately with standard response", async () => {
        db.$queryRaw.mockResolvedValue([{ count: 2 }]);
        db.$executeRaw.mockResolvedValue(2);
        const init = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month: 12, year: 2026, type: "lokal" }) };
        const preview = await app.request("/bulk-reset/preview", init);
        expect(preview.status).toBe(200);
        expect((await preview.json()).data).toEqual({ count: 2 });
        const reset = await app.request("/bulk-reset", init);
        expect(reset.status).toBe(200);
        expect((await reset.json()).data).toEqual({ count: 2 });
    });
});
