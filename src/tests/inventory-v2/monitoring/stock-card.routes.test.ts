import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import StockCardRoutes from "../../../module/application/inventory-v2/monitoring/stock-card/stock-card.routes.js";
import { StockCardController } from "../../../module/application/inventory-v2/monitoring/stock-card/stock-card.controller.js";

vi.mock("../../../module/application/inventory-v2/monitoring/stock-card/stock-card.controller.js");

const app = new Hono();
app.route("/stock-card", StockCardRoutes);

describe("StockCardRoutes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("GET /stock-card - should call controller list", async () => {
        (StockCardController.list as any).mockImplementation((c: any) => {
            return c.json({ data: [], len: 0 });
        });

        const res = await app.request("/stock-card");
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(StockCardController.list).toHaveBeenCalled();
    });

    it("GET /stock-card/export - should call controller export", async () => {
        (StockCardController.export as any).mockImplementation((c: any) => {
            return new Response("csv,data", { status: 200, headers: { "Content-Type": "text/csv" } });
        });

        const res = await app.request("/stock-card/export");
        
        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Type")).toBe("text/csv");
        expect(StockCardController.export).toHaveBeenCalled();
    });
});
