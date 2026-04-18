import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "../../../../config/prisma.js";
import app from "../../../../app.js";

// Mocking prisma
vi.mock("../../../../config/prisma.js", () => ({
    default: {
        stockTransfer: {
            findMany: vi.fn(),
            count: vi.fn(),
            findUnique: vi.fn(),
        },
        stockTransferItem: {
            update: vi.fn(),
        },
        $transaction: vi.fn((cb) => cb(prisma)),
    },
}));

// Mocking redis directly in test file to avoid resolution issues
vi.mock("../../../../config/redis.js", () => {
    const mockRedis = {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue("OK"),
        setex: vi.fn().mockResolvedValue("OK"),
        del: vi.fn().mockResolvedValue(1),
        keys: vi.fn().mockResolvedValue([]),
        ping: vi.fn().mockResolvedValue("PONG"),
        type: vi.fn().mockResolvedValue("hash"),
        hgetall: vi.fn().mockResolvedValue({
            email: "test@example.com",
            role: "SUPER_ADMIN",
        }),
        expire: vi.fn().mockResolvedValue(true),
        connect: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
        quit: vi.fn().mockResolvedValue("OK"),
        disconnect: vi.fn(),
        status: "ready",
    };
    return {
        redisClient: mockRedis,
        closeRedisConnection: vi.fn(),
        Cache: {
            invalidateList: vi.fn(),
        },
    };
});

vi.mock("hono/cookie", async (importOriginal) => {
    const original = await importOriginal<typeof import("hono/cookie")>();
    return {
        ...original,
        getCookie: vi.fn().mockReturnValue("mock-session-id"),
    };
});

// Mocking CSRF check to pass
vi.mock("../../../../middleware/csrf.js", () => ({
    csrfMiddleware: async (c: any, next: any) => await next(),
}));

describe("RmReceipt Routes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("GET /api/app/manufacturing/inventory/rm-receipt", () => {
        it("should return success and data", async () => {
            (prisma.stockTransfer.findMany as any).mockResolvedValue([]);
            (prisma.stockTransfer.count as any).mockResolvedValue(0);

            const res = await app.request("/api/app/manufacturing/inventory/rm-receipt", {
                method: "GET",
            });

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.status).toBe("success");
            expect(body.data.data).toBeDefined();
        });
    });

    describe("GET /api/app/manufacturing/inventory/rm-receipt/:id", () => {
        it("should return 404 if data not found", async () => {
            (prisma.stockTransfer.findUnique as any).mockResolvedValue(null);

            const res = await app.request("/api/app/manufacturing/inventory/rm-receipt/999", {
                method: "GET",
            });

            expect(res.status).toBe(404);
        });

        it("should return 200 if found", async () => {
            (prisma.stockTransfer.findUnique as any).mockResolvedValue({ id: 1, transfer_number: "TRM-1" });

            const res = await app.request("/api/app/manufacturing/inventory/rm-receipt/1", {
                method: "GET",
            });

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.status).toBe("success");
            expect(body.data.id).toBe(1);
        });
    });
});
