import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../app.js";
import prisma from "../../config/prisma.js";

vi.mock("../../config/redis.js", () => {
    const mockSession = JSON.stringify({
        email: "test@example.com",
        role: "SUPER_ADMIN",
        user: { id: "user-123", name: "Test User" },
    });
    const mockRedis = {
        get: vi.fn().mockResolvedValue(mockSession),
        set: vi.fn().mockResolvedValue("OK"),
        del: vi.fn().mockResolvedValue(1),
        expire: vi.fn().mockResolvedValue(true),
        hgetall: vi.fn().mockResolvedValue({
            email: "test@example.com",
            role: "SUPER_ADMIN",
            user: JSON.stringify({ id: "user-123", name: "Test User" }),
        }),
        type: vi.fn().mockResolvedValue("hash"),
        connect: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
        status: "ready",
    };
    return {
        redisClient: mockRedis,
        closeRedisConnection: vi.fn(),
    };
});

vi.mock("hono/cookie", async (importOriginal) => {
    const original = await importOriginal<typeof import("hono/cookie")>();
    return {
        ...original,
        getCookie: vi.fn().mockReturnValue("mock-session-id"),
    };
});

vi.mock("../../middleware/csrf.js", () => ({
    csrfMiddleware: async (c: any, next: any) => await next(),
}));

describe("PORoutes", () => {
    it("GET /api/app/purchase/po should return 200", async () => {
        // @ts-ignore
        prisma.purchaseOrder = {
            findMany: vi.fn().mockResolvedValue([]),
            count: vi.fn().mockResolvedValue(0),
        };

        const res = await app.request("/api/app/purchase/po", { method: "GET" });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.status).toBe("success");
    });

    it("POST /api/app/purchase/po should create PO and return 201", async () => {
        const payload = {
            po_type: "LOCAL",
            po_number: "PO-20260601-001",
            supplier_id: 1,
            supplier_name: "Vendor A",
            total_estimated: 1000000,
            items: [{ item_code: "RM001", item_name: "RM 1", uom: "kg", qty_ordered: 50, unit_price: 20000, subtotal: 1000000 }],
        };

        // @ts-ignore
        prisma.$transaction = vi.fn().mockImplementation(async (cb) => cb(prisma));
        // @ts-ignore
        prisma.purchaseOrder = {
            create: vi.fn().mockResolvedValue({ id: 1, po_number: "PO-001" }),
        };

        const res = await app.request("/api/app/purchase/po", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        const body = await res.json();
        expect(res.status).toBe(201);
        expect(body.status).toBe("success");
    });
});
