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

const mockAR = {
    id: 1,
    ar_number: "AR-20260513-001",
    partner_type: "CUSTOMER",
    partner_name: "PT Customer XYZ",
    source_doc: "SO-001",
    amount: 2000000,
    received_amount: 0,
    balance: 2000000,
    status: "OPEN",
};

describe("FinanceARRoutes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("GET /api/app/finance/ar", () => {
        it("should return 200 with paginated data", async () => {
            // @ts-ignore
            prisma.accountReceivable = {
                findMany: vi.fn().mockResolvedValue([mockAR]),
                count: vi.fn().mockResolvedValue(1),
            };

            const res = await app.request("/api/app/finance/ar", { method: "GET" });
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body.status).toBe("success");
        });
    });

    describe("GET /api/app/finance/ar/:id", () => {
        it("should return 200 for existing AR", async () => {
            // @ts-ignore
            prisma.accountReceivable = { findUniqueOrThrow: vi.fn().mockResolvedValue(mockAR) };

            const res = await app.request("/api/app/finance/ar/1", { method: "GET" });
            expect(res.status).toBe(200);
        });

        it("should return 404 for missing AR", async () => {
            // @ts-ignore
            prisma.accountReceivable = {
                findUniqueOrThrow: vi.fn().mockRejectedValue(
                    Object.assign(new Error("Not found"), { code: "P2025" }),
                ),
            };

            const res = await app.request("/api/app/finance/ar/999", { method: "GET" });
            expect(res.status).toBe(404);
        });
    });

    describe("POST /api/app/finance/ar", () => {
        it("should create AR and return 201", async () => {
            // @ts-ignore
            prisma.accountReceivable = {
                create: vi.fn().mockResolvedValue({ ...mockAR, id: 2 }),
                count: vi.fn().mockResolvedValue(0),
            };

            const res = await app.request("/api/app/finance/ar", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    partner_name: "PT Customer XYZ",
                    source_doc: "SO-001",
                    amount: 2000000,
                }),
            });

            expect(res.status).toBe(201);
        });

        it("should return 400 for invalid payload", async () => {
            const res = await app.request("/api/app/finance/ar", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ partner_name: "", amount: -1 }),
            });

            expect(res.status).toBe(400);
        });
    });

    describe("PATCH /api/app/finance/ar/:id/receipt", () => {
        it("should return 200 on successful receipt", async () => {
            // @ts-ignore
            prisma.accountReceivable = { findUniqueOrThrow: vi.fn().mockResolvedValue(mockAR) };

            const mockUpdated = { ...mockAR, received_amount: 1000000, balance: 1000000, status: "PARTIAL" };
            const mockTx = {
                accountReceivable: { update: vi.fn().mockResolvedValue(mockUpdated) },
                cashEntry: { create: vi.fn().mockResolvedValue({ id: 1 }), count: vi.fn().mockResolvedValue(0) },
                journalEntry: { create: vi.fn().mockResolvedValue({ id: 1 }), count: vi.fn().mockResolvedValue(0) },
            };
            // @ts-ignore
            prisma.$transaction = vi.fn().mockImplementation(async (cb) => cb(mockTx));

            const res = await app.request("/api/app/finance/ar/1/receipt", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    received_amount: 1000000,
                    receipt_date: "2026-05-13",
                    payment_method: "TRANSFER",
                }),
            });

            expect(res.status).toBe(200);
        });

        it("should return 400 if receipt exceeds balance", async () => {
            // @ts-ignore
            prisma.accountReceivable = { findUniqueOrThrow: vi.fn().mockResolvedValue(mockAR) };

            const res = await app.request("/api/app/finance/ar/1/receipt", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    received_amount: 9999999,
                    receipt_date: "2026-05-13",
                    payment_method: "CASH",
                }),
            });

            expect(res.status).toBe(400);
        });
    });
});
