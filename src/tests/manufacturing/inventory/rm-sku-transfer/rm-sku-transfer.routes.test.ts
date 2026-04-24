import { describe, it, expect, vi, beforeEach } from "vitest";
import app from "../../../../app.js";
import prisma from "../../../../config/prisma.js";

vi.mock("../../../../config/redis.js", () => {
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

vi.mock("../../../../middleware/csrf.js", () => ({
    csrfMiddleware: async (c: any, next: any) => await next(),
}));

vi.mock("../../../../config/prisma.js", () => {
    const mockPrisma = {
        $transaction: vi.fn(),
        rawMaterial: { findUnique: vi.fn() },
        warehouse: { findUnique: vi.fn() },
        rawMaterialInventory: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
        stockMovement: { create: vi.fn() },
    };
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        if (Array.isArray(cb)) return Promise.all(cb);
        return cb(mockPrisma);
    });
    return { default: mockPrisma };
});

describe("RmSkuTransferRoutes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("POST /api/app/manufacturing/inventory/rm-sku-transfer", () => {
        const payload = {
            source_rm_id: 1,
            target_rm_id: 2,
            warehouse_id: 3,
            quantity: 10,
            notes: "Test Route",
        };

        it("should return 201 on successful transfer", async () => {
            vi.mocked(prisma.rawMaterial.findUnique)
                .mockResolvedValueOnce({ id: 1, name: "RM Asal" } as any)
                .mockResolvedValueOnce({ id: 2, name: "RM Tujuan" } as any);
            vi.mocked(prisma.warehouse.findUnique).mockResolvedValueOnce({ id: 3, name: "Gudang Utama" } as any);
            
            // Mock source inventory findMany
            vi.mocked(prisma.rawMaterialInventory.findMany).mockResolvedValueOnce([
                { id: 10, quantity: 100, month: 4, year: 2026 }
            ] as any);
            
            // Mock target inventory findMany
            vi.mocked(prisma.rawMaterialInventory.findMany).mockResolvedValueOnce([
                { id: 11, quantity: 50, month: 4, year: 2026 }
            ] as any);

            vi.mocked(prisma.rawMaterialInventory.update).mockResolvedValue({} as any);
            vi.mocked(prisma.stockMovement.create).mockResolvedValue({} as any);

            const res = await app.request("/api/app/manufacturing/inventory/rm-sku-transfer", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            const body = await res.json();
            expect(res.status).toBe(201);
            expect(body.status).toBe("success");
        });

        it("should return 400 on validation failure", async () => {
            const invalidPayload = { ...payload, quantity: -5 };
            const res = await app.request("/api/app/manufacturing/inventory/rm-sku-transfer", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(invalidPayload),
            });

            expect(res.status).toBe(400);
        });

        it("should return 400 if source and target are same", async () => {
            const samePayload = { ...payload, target_rm_id: 1 };
            const res = await app.request("/api/app/manufacturing/inventory/rm-sku-transfer", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(samePayload),
            });

            expect(res.status).toBe(400);
        });
    });
});
