import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../app.js";
import prisma from "../../config/prisma.js";

vi.mock("../../config/redis.js", () => ({
    redisClient: {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue("OK"),
        hgetall: vi.fn().mockResolvedValue({
            email: "test@example.com",
            role: "SUPER_ADMIN",
            user: JSON.stringify({ id: "user-123", name: "Test User" }),
        }),
        type: vi.fn().mockResolvedValue("hash"),
        connect: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
        status: "ready",
    },
    closeRedisConnection: vi.fn(),
}));

vi.mock("hono/cookie", async (importOriginal) => {
    const original = await importOriginal<typeof import("hono/cookie")>();
    return { ...original, getCookie: vi.fn().mockReturnValue("mock-session-id") };
});

vi.mock("../../middleware/csrf.js", () => ({
    csrfMiddleware: async (c: any, next: any) => await next(),
}));

const mockAP = {
    id: 1,
    ap_number: "AP-20260513-001",
    supplier_name: "PT Supplier ABC",
    amount: 1000000,
    paid_amount: 0,
    balance: 1000000,
    status: "UNPAID",
    ap_type: "GOODS_RECEIPT",
    po: null,
    receipt: null,
    payment_term: null,
    supplier: null,
};

describe("FinanceAPRoutes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("GET /api/app/finance/ap", () => {
        it("should return 200 with paginated data", async () => {
            // @ts-ignore
            prisma.accountPayable = {
                findMany: vi.fn().mockResolvedValue([mockAP]),
                count: vi.fn().mockResolvedValue(1),
            };

            const res = await app.request("/api/app/finance/ap", { method: "GET" });
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body.status).toBe("success");
            expect(body.data.data).toHaveLength(1);
        });
    });

    describe("GET /api/app/finance/ap/:id", () => {
        it("should return 200 for existing AP", async () => {
            // @ts-ignore
            prisma.accountPayable = {
                findUniqueOrThrow: vi.fn().mockResolvedValue(mockAP),
            };

            const res = await app.request("/api/app/finance/ap/1", { method: "GET" });
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body.status).toBe("success");
        });

        it("should return 404 for missing AP", async () => {
            // @ts-ignore
            prisma.accountPayable = {
                findUniqueOrThrow: vi.fn().mockRejectedValue(
                    Object.assign(new Error("Not found"), { code: "P2025" }),
                ),
            };

            const res = await app.request("/api/app/finance/ap/999", { method: "GET" });
            expect(res.status).toBe(404);
        });
    });

    describe("PATCH /api/app/finance/ap/:id/payment", () => {
        const validPayload = {
            paid_amount: 500000,
            payment_date: "2026-05-13",
            payment_method: "TRANSFER",
        };

        it("should return 200 on successful payment", async () => {
            // @ts-ignore
            prisma.accountPayable = {
                findUniqueOrThrow: vi.fn().mockResolvedValue(mockAP),
            };

            const mockUpdated = { ...mockAP, paid_amount: 500000, balance: 500000, status: "DP_PAID" };
            const mockTx = {
                accountPayable: {
                    update: vi.fn().mockResolvedValue(mockUpdated),
                    findMany: vi.fn().mockResolvedValue([{ status: "DP_PAID" }]),
                },
                cashEntry: { create: vi.fn().mockResolvedValue({ id: 1 }), count: vi.fn().mockResolvedValue(0) },
                journalEntry: { create: vi.fn().mockResolvedValue({ id: 1 }), count: vi.fn().mockResolvedValue(0) },
                purchaseTracking: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
            };
            // @ts-ignore
            prisma.$transaction = vi.fn().mockImplementation(async (cb) => cb(mockTx));

            const res = await app.request("/api/app/finance/ap/1/payment", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(validPayload),
            });

            expect(res.status).toBe(200);
        });

        it("should return 400 if payment exceeds balance", async () => {
            // @ts-ignore
            prisma.accountPayable = {
                findUniqueOrThrow: vi.fn().mockResolvedValue(mockAP),
            };

            const res = await app.request("/api/app/finance/ap/1/payment", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...validPayload, paid_amount: 9999999 }),
            });

            expect(res.status).toBe(400);
        });

        it("should return 400 if payload invalid", async () => {
            const res = await app.request("/api/app/finance/ap/1/payment", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ paid_amount: -100 }),
            });

            expect(res.status).toBe(400);
        });
    });
});
