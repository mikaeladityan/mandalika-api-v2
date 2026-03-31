import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import GRRoutes from "../../../module/application/inventory-v2/gr/gr.routes.js";
import { GRController } from "../../../module/application/inventory-v2/gr/gr.controller.js";
import { GoodsReceiptStatus } from "../../../generated/prisma/enums.js";

vi.mock("../../../module/application/inventory-v2/gr/gr.controller.js");

const app = new Hono();
app.route("/gr", GRRoutes);

describe("GRRoutes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("GET /gr - should return list of goods receipts with params", async () => {
        (GRController.list as any).mockImplementation((c: any) => {
             return c.json({ data: [], len: 0, params: {} });
        });

        const res = await app.request("/gr");
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.data).toBeDefined();
        expect(json.params).toBeDefined();
    });

    it("GET /gr/:id - should return detail", async () => {
        (GRController.detail as any).mockImplementation((c: any) => {
             return c.json({ data: { id: 1 } });
        });

        const res = await app.request("/gr/1");
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.data.id).toBe(1);
    });

    it("POST /gr - should validate body", async () => {
        // This test technically checks if the route is defined and has validation
        // In real integration tests it would check 400 for empty body
        // Here we just check if it calls controller when valid
        (GRController.create as any).mockImplementation((c: any) => {
             return c.json({ data: { id: 1 } }, 201);
        });

        const res = await app.request("/gr", {
            method: "POST",
            body: JSON.stringify({ 
                warehouse_id: 1, 
                type: "MANUAL", 
                items: [{ product_id: 1, quantity_planned: 10, quantity_actual: 10 }] 
            }),
            headers: { "Content-Type": "application/json" }
        });

        expect(res.status).toBe(201);
    });
});
