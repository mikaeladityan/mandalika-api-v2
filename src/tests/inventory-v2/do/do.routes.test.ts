import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import DORoutes from "../../../module/application/inventory-v2/do/do.routes.js";
import { DOController } from "../../../module/application/inventory-v2/do/do.controller.js";
import { TransferStatus } from "../../../generated/prisma/enums.js";

vi.mock("../../../module/application/inventory-v2/do/do.controller.js");

const app = new Hono();
app.route("/do", DORoutes);

describe("DORoutes - Integrated Workflow", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("GET /do - should return list with params", async () => {
        (DOController.list as any).mockImplementation((c: any) => c.json({ data: [], len: 0, params: {} }));
        const res = await app.request("/do");
        const json = await res.json();
        expect(res.status).toBe(200);
        expect(json.params).toBeDefined();
    });

    it("GET /do/:id - should return detail record", async () => {
        (DOController.detail as any).mockImplementation((c: any) => c.json({ data: { id: 1, transfer_number: "DO-001" } }));
        const res = await app.request("/do/1");
        const json = await res.json();
        expect(res.status).toBe(200);
        expect(json.data.transfer_number).toBe("DO-001");
    });

    it("POST /do - should validate creation payload", async () => {
        (DOController.create as any).mockImplementation((c: any) => c.json({ data: { id: 1 } }, 201));
        const res = await app.request("/do", {
            method: "POST",
            body: JSON.stringify({ 
                date: "2026-03-31",
                from_warehouse_id: 1, 
                to_outlet_id: 2,
                items: [{ product_id: 1, quantity_requested: 50 }] 
            }),
            headers: { "Content-Type": "application/json" }
        });
        expect(res.status).toBe(201);
    });

    it("PATCH /do/:id/status - should validate status transition payload", async () => {
        (DOController.updateStatus as any).mockImplementation((c: any) => c.json({ data: { status: TransferStatus.SHIPMENT } }));
        const res = await app.request("/do/1/status", {
            method: "PATCH",
            body: JSON.stringify({ 
                status: TransferStatus.SHIPMENT,
                notes: "Shipment starting"
            }),
            headers: { "Content-Type": "application/json" }
        });
        expect(res.status).toBe(200);
    });
});
