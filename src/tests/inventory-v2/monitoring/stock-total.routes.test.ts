import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import StockTotalRoutes from "../../../module/application/inventory-v2/monitoring/stock-total/stock-total.routes.js";
import { StockTotalController } from "../../../module/application/inventory-v2/monitoring/stock-total/stock-total.controller.js";

vi.mock("../../../module/application/inventory-v2/monitoring/stock-total/stock-total.controller.js");

const app = new Hono();
app.route("/stock-total", StockTotalRoutes);

describe("StockTotalRoutes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("GET /stock-total - should call controller list", async () => {
        (StockTotalController.list as any).mockImplementation((c: any) => {
            return c.json({ data: [], len: 0 });
        });

        const res = await app.request("/stock-total");
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.data).toBeDefined();
        expect(StockTotalController.list).toHaveBeenCalled();
    });

    it("GET /stock-total/locations - should call controller listLocations", async () => {
        (StockTotalController.listLocations as any).mockImplementation((c: any) => {
            return c.json({ data: [] });
        });

        const res = await app.request("/stock-total/locations");
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.data).toBeDefined();
        expect(StockTotalController.listLocations).toHaveBeenCalled();
    });
});
