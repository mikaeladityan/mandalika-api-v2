import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import ReturnRoutes from "../../../module/application/inventory-v2/return/return.routes.js";
import { ReturnController } from "../../../module/application/inventory-v2/return/return.controller.js";
import { ReturnStatus, TransferLocationType } from "../../../generated/prisma/enums.js";

vi.mock("../../../module/application/inventory-v2/return/return.controller.js");

const app = new Hono();
app.route("/return", ReturnRoutes);

describe("ReturnRoutes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("GET /return - should return list of returns", async () => {
        (ReturnController.list as any).mockImplementation((c: any) => {
             return c.json({ data: [], len: 0 });
        });

        const res = await app.request("/return");
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.data).toBeDefined();
    });

    it("POST /return - should call create controller", async () => {
        (ReturnController.create as any).mockImplementation((c: any) => {
             return c.json({ data: { id: 1 } }, 201);
        });

        const res = await app.request("/return", {
            method: "POST",
            body: JSON.stringify({ 
                from_type: TransferLocationType.OUTLET,
                from_outlet_id: 1,
                to_warehouse_id: 1,
                items: [{ product_id: 1, quantity: 10 }] 
            }),
            headers: { "Content-Type": "application/json" }
        });

        expect(res.status).toBe(201);
    });

    it("GET /return/:id - should return detail", async () => {
        (ReturnController.detail as any).mockImplementation((c: any) => {
             return c.json({ data: { id: 1 } });
        });

        const res = await app.request("/return/1");
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.data.id).toBe(1);
    });

    it("PATCH /return/:id/status - should update status", async () => {
        (ReturnController.updateStatus as any).mockImplementation((c: any) => {
             return c.json({ data: { id: 1, status: ReturnStatus.SHIPPING } });
        });

        const res = await app.request("/return/1/status", {
            method: "PATCH",
            body: JSON.stringify({ status: ReturnStatus.SHIPPING }),
            headers: { "Content-Type": "application/json" }
        });

        expect(res.status).toBe(200);
    });
});
