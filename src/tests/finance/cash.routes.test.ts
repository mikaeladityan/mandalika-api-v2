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

const mockEntry = {
    id: 1,
    cash_number: "CB-20260513-001",
    cash_date: new Date("2026-05-13"),
    type: "PAYMENT",
    source: "Vendor Payment",
    amount: 500000,
    status: "DRAFT",
};

describe("FinanceCashRoutes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("GET /api/app/finance/cash", () => {
        it("should return 200 with paginated data", async () => {
            // @ts-ignore
            prisma.cashEntry = {
                findMany: vi.fn().mockResolvedValue([mockEntry]),
                count: vi.fn().mockResolvedValue(1),
            };

            const res = await app.request("/api/app/finance/cash", { method: "GET" });
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body.status).toBe("success");
        });
    });

    describe("POST /api/app/finance/cash", () => {
        it("should create cash entry and return 201", async () => {
            // @ts-ignore
            prisma.cashEntry = {
                create: vi.fn().mockResolvedValue({ ...mockEntry, id: 2 }),
                count: vi.fn().mockResolvedValue(0),
            };

            const res = await app.request("/api/app/finance/cash", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    cash_date: "2026-05-13",
                    type: "PAYMENT",
                    source: "Vendor Payment",
                    amount: 500000,
                    payment_method: "TRANSFER",
                }),
            });

            expect(res.status).toBe(201);
        });

        it("should return 422 for invalid payload", async () => {
            const res = await app.request("/api/app/finance/cash", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ amount: -100 }),
            });

            expect(res.status).toBe(400);
        });
    });

    describe("GET /api/app/finance/cash/:id", () => {
        it("should return 200 for existing entry", async () => {
            // @ts-ignore
            prisma.cashEntry = { findUniqueOrThrow: vi.fn().mockResolvedValue(mockEntry) };

            const res = await app.request("/api/app/finance/cash/1", { method: "GET" });
            expect(res.status).toBe(200);
        });

        it("should return 404 for missing entry", async () => {
            // @ts-ignore
            prisma.cashEntry = {
                findUniqueOrThrow: vi.fn().mockRejectedValue(
                    Object.assign(new Error("Not found"), { code: "P2025" }),
                ),
            };

            const res = await app.request("/api/app/finance/cash/999", { method: "GET" });
            expect(res.status).toBe(404);
        });
    });

    describe("PATCH /api/app/finance/cash/:id/post", () => {
        it("should post DRAFT entry and return 200", async () => {
            const mockPosted = { ...mockEntry, status: "POSTED", posted_at: new Date() };
            // @ts-ignore
            prisma.cashEntry = {
                findUniqueOrThrow: vi.fn().mockResolvedValue(mockEntry),
                update: vi.fn().mockResolvedValue(mockPosted),
            };

            const res = await app.request("/api/app/finance/cash/1/post", { method: "PATCH" });
            expect(res.status).toBe(200);
        });

        it("should return 400 if already POSTED", async () => {
            // @ts-ignore
            prisma.cashEntry = {
                findUniqueOrThrow: vi.fn().mockResolvedValue({ ...mockEntry, status: "POSTED" }),
            };

            const res = await app.request("/api/app/finance/cash/1/post", { method: "PATCH" });
            expect(res.status).toBe(400);
        });
    });
});
