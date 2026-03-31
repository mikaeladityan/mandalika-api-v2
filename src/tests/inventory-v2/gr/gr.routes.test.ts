import { describe, it, expect, vi, beforeEach } from "vitest";
import app from "../../../app.js";
import prisma from "../../../config/prisma.js";
import { GoodsReceiptStatus, GoodsReceiptType } from "../../../generated/prisma/enums.js";

vi.mock("../../../config/redis.js", () => {
    const mockRedis = {
        get: vi.fn().mockResolvedValue(null),
        hgetall: vi.fn().mockResolvedValue({ email: "test@example.com", role: "SUPER_ADMIN" }),
        ping: vi.fn().mockResolvedValue("PONG"),
        type: vi.fn().mockResolvedValue("hash"),
        expire: vi.fn().mockResolvedValue(true)
    };
    return { redisClient: mockRedis, closeRedisConnection: vi.fn() };
});

vi.mock("hono/cookie", async (importOriginal) => {
    const original = await importOriginal<typeof import("hono/cookie")>();
    return { ...original, getCookie: vi.fn().mockReturnValue("mock-session-id") };
});

vi.mock("../../../middleware/csrf.js", () => ({
    csrfMiddleware: async (c: any, next: any) => await next(),
}));

const mockGR = {
    id: 1,
    gr_number: "GR-202603-001",
    status: GoodsReceiptStatus.PENDING,
    type: GoodsReceiptType.MANUAL,
    warehouse_id: 1,
    created_by: "system",
    created_at: new Date(),
    updated_at: new Date(),
    items: [
        { id: 1, product_id: 1, quantity_planned: 100, quantity_actual: 100 }
    ]
};

describe("InventoryV2 GR Routes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // @ts-ignore
        prisma.$transaction.mockImplementation(async (callback) => {
            if (Array.isArray(callback)) {
                return Promise.all(callback);
            }
            return callback(prisma);
        });
    });

    describe("POST /api/app/inventory-v2/gr", () => {
        it("should return 201 on success", async () => {
            // @ts-ignore
            prisma.goodsReceipt.create.mockResolvedValue(mockGR);

            const payload = {
                type: "MANUAL",
                warehouse_id: 1,
                items: [{ product_id: 1, quantity_planned: 100, quantity_actual: 100 }]
            };

            const res = await app.request("/api/app/inventory-v2/gr", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            const body = (await res.json()) as any;
            expect(res.status).toBe(201);
            expect(body.data.id).toBe(1);
        });

        it("should return 400 for validation failure (no items)", async () => {
            const payload = {
                type: "MANUAL",
                warehouse_id: 1,
                items: []
            };

            const res = await app.request("/api/app/inventory-v2/gr", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            expect(res.status).toBe(400);
        });
    });

    describe("GET /api/app/inventory-v2/gr", () => {
        it("should return list of GR", async () => {
            // @ts-ignore
            prisma.goodsReceipt.findMany.mockResolvedValue([mockGR]);
            // @ts-ignore
            prisma.goodsReceipt.count.mockResolvedValue(1);

            const res = await app.request("/api/app/inventory-v2/gr", { method: "GET" });
            const body = (await res.json()) as any;

            expect(res.status).toBe(200);
            expect(body.data).toHaveLength(1);
        });
    });

    describe("GET /api/app/inventory-v2/gr/:id", () => {
        it("should return detail of GR", async () => {
            // @ts-ignore
            prisma.goodsReceipt.findUnique.mockResolvedValue(mockGR);

            const res = await app.request("/api/app/inventory-v2/gr/1", { method: "GET" });
            const body = (await res.json()) as any;

            expect(res.status).toBe(200);
            expect(body.data.id).toBe(1);
        });

        it("should return 404 if GR not found", async () => {
            // @ts-ignore
            prisma.goodsReceipt.findUnique.mockResolvedValue(null);

            const res = await app.request("/api/app/inventory-v2/gr/999", { method: "GET" });
            expect(res.status).toBe(404);
        });
    });

    describe("POST /api/app/inventory-v2/gr/:id/post", () => {
        it("should post GR and return results", async () => {
            // @ts-ignore
            prisma.goodsReceipt.findUnique.mockResolvedValue(mockGR);
            // @ts-ignore
            prisma.goodsReceipt.update.mockResolvedValue({ ...mockGR, status: GoodsReceiptStatus.COMPLETED });

            const res = await app.request("/api/app/inventory-v2/gr/1/post", {
                method: "POST"
            });

            const body = (await res.json()) as any;
            expect(res.status).toBe(200);
            expect(body.data.status).toBe(GoodsReceiptStatus.COMPLETED);
        });
    });
});
