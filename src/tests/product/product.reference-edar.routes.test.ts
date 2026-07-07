import { describe, it, expect, vi, beforeEach } from "vitest";
import app from "../../app.js";
import prisma from "../../config/prisma.js";
import { redisClient } from "../../config/redis.js";
import { sessionCache } from "../../lib/session.management.js";

vi.mock("hono/cookie", async (importOriginal) => {
    const original = await importOriginal<typeof import("hono/cookie")>();
    return {
        ...original,
        getCookie: vi.fn().mockReturnValue("mock-session-id"),
    };
});

vi.mock("../../config/redis.js", () => {
    const mockRedis = {
        get: vi.fn(),
        set: vi.fn().mockResolvedValue("OK"),
        setex: vi.fn().mockResolvedValue("OK"),
        del: vi.fn().mockResolvedValue(1),
        keys: vi.fn().mockResolvedValue([]),
        ping: vi.fn().mockResolvedValue("PONG"),
        type: vi.fn().mockResolvedValue("string"),
        hgetall: vi.fn().mockResolvedValue({
            email: "test@example.com",
            role: "DEVELOPER",
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
    };
});

vi.mock("../../middleware/csrf.js", () => ({
    csrfMiddleware: async (c: any, next: any) => await next(),
}));

vi.mock("../../config/prisma.js", () => {
    const mockPrisma = {
        $transaction: vi.fn(),
        product: {
            findUnique: vi.fn(),
            findMany: vi.fn(),
            count: vi.fn(),
            update: vi.fn(),
            create: vi.fn(),
            deleteMany: vi.fn(),
            findFirst: vi.fn(),
        },
        loggingActivity: {
            create: vi.fn().mockResolvedValue({ id: 1 }),
        },
    };
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        if (Array.isArray(cb)) return Promise.all(cb);
        return cb(mockPrisma);
    });
    return { default: mockPrisma };
});

const sessionOf = (role: string) =>
    JSON.stringify({ email: "test@example.com", role, user: { id: 1 } });

describe("PATCH /api/app/products/reference-edar", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        sessionCache.clear();
    });

    const doRequest = () =>
        app.request("/api/app/products/reference-edar", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            // UI mengirim persen (0-100); backend menyimpan fraction (0-1)
            body: JSON.stringify({ product_id: 1, reference_distribution_percentage: 45 }),
        });

    it("403 untuk role STAFF", async () => {
        vi.mocked(redisClient.get).mockResolvedValue(sessionOf("STAFF") as any);
        const res = await doRequest();
        expect(res.status).toBe(403);
    });

    it("403 untuk role SUPER_ADMIN", async () => {
        vi.mocked(redisClient.get).mockResolvedValue(sessionOf("SUPER_ADMIN") as any);
        const res = await doRequest();
        expect(res.status).toBe(403);
    });

    it("200 untuk role DEVELOPER + update tersimpan", async () => {
        vi.mocked(redisClient.get).mockResolvedValue(sessionOf("DEVELOPER") as any);
        vi.mocked(prisma.product.findUnique).mockResolvedValue({
            id: 1,
            code: "P001",
            name: "Product 1",
            reference_distribution_percentage: "0.30",
        } as any);
        vi.mocked(prisma.product.update).mockResolvedValue({
            id: 1,
            code: "P001",
            reference_distribution_percentage: "0.45",
        } as any);

        const res = await doRequest();
        expect(res.status).toBe(200);
        const body = await res.json();
        // Respons dalam persen (untuk log & UI), DB dalam fraction
        expect(body.data.old_value).toBe(30);
        expect(body.data.new_value).toBe(45);
        expect(prisma.product.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 1 },
                data: { reference_distribution_percentage: 0.45 },
            }),
        );
    });

    it("404 kalau produk tidak ada", async () => {
        vi.mocked(redisClient.get).mockResolvedValue(sessionOf("DEVELOPER") as any);
        vi.mocked(prisma.product.findUnique).mockResolvedValue(null);
        const res = await doRequest();
        expect(res.status).toBe(404);
    });
});
