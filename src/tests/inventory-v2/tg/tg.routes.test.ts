import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import TGRoutes from "../../../module/application/inventory-v2/tg/tg.routes.js";
import { TGController } from "../../../module/application/inventory-v2/tg/tg.controller.js";
import { TransferStatus } from "../../../generated/prisma/enums.js";

vi.mock("../../../module/application/inventory-v2/tg/tg.controller.js");

const app = new Hono();
app.route("/tg", TGRoutes);

describe("TGRoutes - Integrated Workflow", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("GET /tg - should return list", async () => {
        (TGController.list as any).mockImplementation((c: any) => c.json({ data: [], len: 0 }));
        const res = await app.request("/tg");
        const json = await res.json();
        expect(res.status).toBe(200);
        expect(json.data).toBeDefined();
    });

    it("GET /tg/:id - should return detail record", async () => {
        (TGController.detail as any).mockImplementation((c: any) => c.json({ data: { id: 1, transfer_number: "TG-001" } }));
        const res = await app.request("/tg/1");
        const json = await res.json();
        expect(res.status).toBe(200);
        expect(json.data.transfer_number).toBe("TG-001");
    });

    it("POST /tg - should validate creation payload", async () => {
        (TGController.create as any).mockImplementation((c: any) => c.json({ data: { id: 1 } }, 201));
        const res = await app.request("/tg", {
            method: "POST",
            body: JSON.stringify({ 
                date: "2026-04-01",
                from_warehouse_id: 1, 
                to_warehouse_id: 2,
                items: [{ product_id: 1, quantity_requested: 50 }] 
            }),
            headers: { "Content-Type": "application/json" }
        });
        expect(res.status).toBe(201);
    });

    it("PATCH /tg/:id/status - should validate status transition payload", async () => {
        (TGController.updateStatus as any).mockImplementation((c: any) => c.json({ data: { status: TransferStatus.APPROVED } }));
        const res = await app.request("/tg/1/status", {
            method: "PATCH",
            body: JSON.stringify({ 
                status: TransferStatus.APPROVED,
                notes: "Approving test"
            }),
            headers: { "Content-Type": "application/json" }
        });
        expect(res.status).toBe(200);
    });
});
