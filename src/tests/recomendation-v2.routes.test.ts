import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import routes from "../module/application/recomendation-v2/recomendation-v2.routes.js";
import { RecomendationV2Service } from "../module/application/recomendation-v2/recomendation-v2.service.js";
import { DiscontinueService } from "../module/application/recomendation-v2/discontinue/discontinue.service.js";

const app = new Hono().route("/recommendations", routes);
afterEach(() => vi.restoreAllMocks());

describe("Discontinue recommendation HTTP contracts", () => {
    it("saves a scoped recipe anchor using the dedicated endpoint", async () => {
        const save = vi.spyOn(DiscontinueService, "save").mockResolvedValue([]);
        const body = { product_id: 1, month: 9, year: 2026, anchor_material_id: 7, quantity: 12.5 };
        const res = await app.request("/recommendations/discontinue/anchor", {
            method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        expect(res.status).toBe(200);
        expect(save).toHaveBeenCalledWith(body);
    });
    it("forwards the FG scope and all table filters to the list service", async () => {
        const list = vi.spyOn(RecomendationV2Service, "list").mockResolvedValue({
            data: [], len: 0, periods: { sales_periods: [], forecast_periods: [], po_periods: [] },
        });
        const res = await app.request("/recommendations?product_status=PENDING&page=2&take=50&month=9&year=2026&forecast_months=6&po_months=5&search=FG&sortBy=material_name&order=desc");
        expect(res.status).toBe(200);
        expect(list).toHaveBeenCalledWith(expect.objectContaining({
            product_status: "PENDING", page: 2, take: 50, month: 9, year: 2026,
            forecast_months: 6, po_months: 5, search: "FG", sortBy: "material_name", order: "desc",
        }));
        expect(list.mock.calls[0]?.[0].type).toBeUndefined();
    });

    it("preserves scope, selected rows and FG column when exporting", async () => {
        const exportData = vi.spyOn(RecomendationV2Service, "export").mockResolvedValue(new ArrayBuffer(0));
        const res = await app.request("/recommendations/export?product_status=PENDING&month=9&year=2026&selectedIds=7,8&selectedRowIds=1_7,2_8&visibleColumns=material_name,finished_goods&columnOrder=finished_goods,material_name");
        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Disposition")).toContain("DISCONTINUE");
        expect(exportData).toHaveBeenCalledWith(expect.objectContaining({
            product_status: "PENDING", selectedIds: "7,8", selectedRowIds: "1_7,2_8", visibleColumns: "material_name,finished_goods",
            columnOrder: "finished_goods,material_name", page: 1, take: 1000000,
        }));
    });

    it("forwards Discontinue scope to Bulk Save", async () => {
        const bulk = vi.spyOn(RecomendationV2Service, "bulkSaveHorizon").mockResolvedValue(2);
        const res = await app.request("/recommendations/bulk-horizon", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ product_status: "PENDING", month: 9, year: 2026, horizon: 4 }),
        });
        expect(res.status).toBe(200);
        expect(bulk).toHaveBeenCalledWith({ product_status: "PENDING", month: 9, year: 2026, horizon: 4 });
    });
});
