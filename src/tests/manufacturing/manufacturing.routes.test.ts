import { describe, it, expect, vi, beforeEach } from "vitest";
import app from "../../app.js";
import prisma from "../../config/prisma.js";
import { ProductionStatus } from "../../generated/prisma/enums.js";

vi.mock("../../config/redis.js", () => {
    const mockRedis = {
        get: vi.fn().mockResolvedValue(null),
        hgetall: vi.fn().mockResolvedValue({ email: "test@example.com", role: "SUPER_ADMIN" }),
        ping: vi.fn().mockResolvedValue("PONG"),
        type: vi.fn().mockResolvedValue("hash"),
        expire: vi.fn().mockResolvedValue(true),
    };
    return { redisClient: mockRedis, closeRedisConnection: vi.fn() };
});

vi.mock("hono/cookie", async (importOriginal) => {
    const original = await importOriginal<typeof import("hono/cookie")>();
    return { ...original, getCookie: vi.fn().mockReturnValue("mock-session-id") };
});

vi.mock("../../middleware/csrf.js", () => ({
    csrfMiddleware: async (c: any, next: any) => await next(),
}));

const mockOrder = {
    id: 1,
    mfg_number: "MFG-202604-0001",
    product_id: 1,
    quantity_planned: 100,
    quantity_actual: null,
    quantity_accepted: null,
    quantity_rejected: null,
    status: ProductionStatus.PLANNING,
    target_date: null,
    notes: null,
    qc_notes: null,
    released_at: null,
    processing_at: null,
    completed_at: null,
    finished_at: null,
    fg_warehouse_id: null,
    created_by: "system",
    created_at: new Date(),
    updated_at: new Date(),
    items: [
        { id: 10, raw_material_id: 10, warehouse_id: 3, quantity_planned: 200, quantity_actual: null },
    ],
    product: { id: 1, name: "Parfum EDP", code: "EDP_100" },
    wastes: [],
    goods_receipt: null,
};

describe("ManufacturingRoutes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // @ts-ignore
        prisma.$transaction.mockImplementation(async (cb) => {
            if (Array.isArray(cb)) return Promise.all(cb);
            return cb(prisma);
        });
    });

    describe("POST /api/app/manufacturing", () => {
        it("should create order and return 201", async () => {
            // @ts-ignore
            prisma.product.findUnique.mockResolvedValue({
                id: 1,
                name: "Parfum EDP",
                code: "EDP_100",
                recipes: [{ id: 1, raw_mat_id: 10, quantity: 2, is_active: true }],
            });
            // @ts-ignore
            prisma.productionOrder.create.mockResolvedValue(mockOrder);

            const payload = { product_id: 1, quantity_planned: 100 };
            const res = await app.request("/api/app/manufacturing", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            const body = (await res.json()) as any;
            if (res.status !== 201) console.log("CREATE ERROR:", JSON.stringify(body));
            expect(res.status).toBe(201);
            expect(body.status).toBe("success");
            expect(body.data.mfg_number).toBe("MFG-202604-0001");
        });

        it("should return 400 on validation failure (negative quantity)", async () => {
            const payload = { product_id: 1, quantity_planned: -5 };
            const res = await app.request("/api/app/manufacturing", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            expect(res.status).toBe(400);
        });
    });

    describe("GET /api/app/manufacturing", () => {
        it("should return paginated list", async () => {
            // @ts-ignore
            prisma.productionOrder.findMany.mockResolvedValue([mockOrder]);
            // @ts-ignore
            prisma.productionOrder.count.mockResolvedValue(1);

            const res = await app.request("/api/app/manufacturing", { method: "GET" });
            const body = (await res.json()) as any;

            expect(res.status).toBe(200);
            expect(body.data.data).toHaveLength(1);
            expect(body.data.len).toBe(1);
        });

        it("should filter by status", async () => {
            // @ts-ignore
            prisma.productionOrder.findMany.mockResolvedValue([mockOrder]);
            // @ts-ignore
            prisma.productionOrder.count.mockResolvedValue(1);

            const res = await app.request("/api/app/manufacturing?status=PLANNING", { method: "GET" });
            expect(res.status).toBe(200);
        });
    });

    describe("GET /api/app/manufacturing/:id", () => {
        it("should return order detail", async () => {
            // @ts-ignore
            prisma.productionOrder.findUnique.mockResolvedValue(mockOrder);

            const res = await app.request("/api/app/manufacturing/1", { method: "GET" });
            const body = (await res.json()) as any;

            expect(res.status).toBe(200);
            expect(body.data.id).toBe(1);
        });

        it("should return 404 when not found", async () => {
            // @ts-ignore
            prisma.productionOrder.findUnique.mockResolvedValue(null);

            const res = await app.request("/api/app/manufacturing/999", { method: "GET" });
            expect(res.status).toBe(404);
        });
    });

    describe("PATCH /api/app/manufacturing/:id/status", () => {
        it("should transition to RELEASED", async () => {
            const planningOrder = { ...mockOrder };
            // @ts-ignore
            prisma.productionOrder.findUnique.mockResolvedValue(planningOrder);
            // @ts-ignore
            prisma.rawMaterialInventory.findMany.mockResolvedValue([
                { id: 1, raw_material_id: 10, warehouse_id: 3, quantity: 500 },
            ]);
            // @ts-ignore
            prisma.productionOrderItem.updateMany.mockResolvedValue({ count: 1 });
            // @ts-ignore
            prisma.productionOrder.update.mockResolvedValue({ ...planningOrder, status: ProductionStatus.RELEASED });

            const res = await app.request("/api/app/manufacturing/1/status", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "RELEASED" }),
            });

            const body = (await res.json()) as any;
            if (res.status !== 200) console.log("RELEASED ERROR:", JSON.stringify(body));
            expect(res.status).toBe(200);
            expect(body.data.status).toBe("RELEASED");
        });

        it("should return 400 for invalid status value", async () => {
            const res = await app.request("/api/app/manufacturing/1/status", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "FINISHED" }), // FINISHED not allowed via changeStatus
            });
            expect(res.status).toBe(400);
        });
    });

    describe("POST /api/app/manufacturing/:id/result", () => {
        it("should submit production result and move to COMPLETED", async () => {
            const processingOrder = { ...mockOrder, status: ProductionStatus.PROCESSING };
            // @ts-ignore
            prisma.productionOrder.findUnique.mockResolvedValue(processingOrder);
            // @ts-ignore
            prisma.productionOrderItem.update.mockResolvedValue({});
            // @ts-ignore
            prisma.rawMaterialInventory.findFirst.mockResolvedValue({ id: 1, quantity: 0, warehouse_id: 3 });
            // @ts-ignore
            prisma.productionOrder.update.mockResolvedValue({
                ...processingOrder,
                status: ProductionStatus.COMPLETED,
                quantity_actual: 95,
                wastes: [],
            });

            const payload = {
                quantity_actual: 95,
                items: [{ id: 10, quantity_actual: 200 }],
            };

            const res = await app.request("/api/app/manufacturing/1/result", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            const body = (await res.json()) as any;
            if (res.status !== 200) console.log("RESULT ERROR:", JSON.stringify(body));
            expect(res.status).toBe(200);
            expect(body.data.status).toBe("COMPLETED");
        });

        it("should return 400 on missing required field", async () => {
            const payload = { quantity_actual: 95 }; // missing items
            const res = await app.request("/api/app/manufacturing/1/result", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            expect(res.status).toBe(400);
        });
    });

    describe("POST /api/app/manufacturing/:id/qc", () => {
        it("should finalize QC and return FINISHED", async () => {
            const qcOrder = { ...mockOrder, status: ProductionStatus.QC_REVIEW, quantity_actual: 95 };
            // @ts-ignore
            prisma.productionOrder.findUnique.mockResolvedValue(qcOrder);
            // @ts-ignore
            prisma.warehouse.findUnique.mockResolvedValue({ id: 1, name: "Gudang FG", type: "FINISH_GOODS" });
            // @ts-ignore
            prisma.goodsReceipt.create.mockResolvedValue({ id: 5, gr_number: "GR-202604-0001" });
            // @ts-ignore
            prisma.productInventory.findFirst.mockResolvedValue({ id: 1, quantity: 50 });
            // @ts-ignore
            prisma.productInventory.update.mockResolvedValue({});
            // @ts-ignore
            prisma.stockMovement.create.mockResolvedValue({});
            // @ts-ignore
            prisma.productionOrderWaste.create.mockResolvedValue({});
            // @ts-ignore
            prisma.productionOrder.update.mockResolvedValue({
                ...qcOrder,
                status: ProductionStatus.FINISHED,
                quantity_accepted: 90,
                quantity_rejected: 5,
                goods_receipt: { id: 5 },
            });

            const payload = { quantity_accepted: 90, quantity_rejected: 5, fg_warehouse_id: 1 };
            const res = await app.request("/api/app/manufacturing/1/qc", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            const body = (await res.json()) as any;
            if (res.status !== 200) console.log("QC ERROR:", JSON.stringify(body));
            expect(res.status).toBe(200);
            expect(body.data.status).toBe("FINISHED");
        });

        it("should return 400 when both accepted and rejected are 0", async () => {
            const payload = { quantity_accepted: 0, quantity_rejected: 0, fg_warehouse_id: 1 };
            const res = await app.request("/api/app/manufacturing/1/qc", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            expect(res.status).toBe(400);
        });
    });
});
