import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import DiscrepancyRoutes from "../../../module/application/inventory-v2/monitoring/discrepancy/discrepancy.routes.js";
import { DiscrepancyController } from "../../../module/application/inventory-v2/monitoring/discrepancy/discrepancy.controller.js";

vi.mock("../../../module/application/inventory-v2/monitoring/discrepancy/discrepancy.controller.js");

const app = new Hono();
app.route("/discrepancy", DiscrepancyRoutes);

describe("DiscrepancyRoutes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("GET /discrepancy - should call controller list", async () => {
        (DiscrepancyController.list as any).mockImplementation((c: any) => {
            return c.json({ data: [], len: 0 });
        });

        const res = await app.request("/discrepancy");
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(DiscrepancyController.list).toHaveBeenCalled();
    });

    it("GET /discrepancy/export - should call controller export", async () => {
        (DiscrepancyController.export as any).mockImplementation((c: any) => {
            return new Response("csv,data", { status: 200, headers: { "Content-Type": "text/csv" } });
        });

        const res = await app.request("/discrepancy/export");

        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Type")).toBe("text/csv");
        expect(DiscrepancyController.export).toHaveBeenCalled();
    });
});
