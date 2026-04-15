import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import StockLocationRoutes from "../../../module/application/inventory-v2/monitoring/stock-location/stock-location.routes.js";
import { StockLocationController } from "../../../module/application/inventory-v2/monitoring/stock-location/stock-location.controller.js";

vi.mock("../../../module/application/inventory-v2/monitoring/stock-location/stock-location.controller.js");

const app = new Hono();
app.route("/stock-location", StockLocationRoutes);

describe("StockLocationRoutes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("GET /stock-location - should call controller list", async () => {
        (StockLocationController.list as any).mockImplementation((c: any) => {
            return c.json({ data: [], len: 0 });
        });

        const res = await app.request("/stock-location?location_type=WAREHOUSE&location_id=1");
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(StockLocationController.list).toHaveBeenCalled();
    });

    it("GET /stock-location/locations - should call controller listAvailableLocations", async () => {
        (StockLocationController.listAvailableLocations as any).mockImplementation((c: any) => {
            return c.json({ data: [] });
        });

        const res = await app.request("/stock-location/locations");
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(StockLocationController.listAvailableLocations).toHaveBeenCalled();
    });
});
