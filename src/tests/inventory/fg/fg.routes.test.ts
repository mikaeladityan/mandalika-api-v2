import { describe, it, expect, vi, beforeEach } from "vitest";
import app from "../../../app.js";
import prisma from "../../../config/prisma.js";
import { redisClient } from "../../../config/redis.js";

vi.mock("hono/cookie", async (importOriginal) => {
    const original = await importOriginal<typeof import("hono/cookie")>();
    return {
        ...original,
        getCookie: vi.fn().mockReturnValue("mock-session-id"),
    };
});

vi.mock("../../../middleware/csrf.js", () => ({
    csrfMiddleware: async (_c: unknown, next: () => Promise<void>) => await next(),
}));

vi.mock("../../../module/application/shared/activity-logger.js", () => ({
    CreateLogger: vi.fn().mockResolvedValue({}),
    LoggingActivitySchema: {},
}));

const FG_BASE = "/api/app/inventory/fg";

const VALID_SESSION = JSON.stringify({
    email: "test@example.com",
    role: "SUPER_ADMIN",
    employee: { permissions: [] },
});

type RedisKeyArg = string | Buffer;
const keyToString = (key: RedisKeyArg): string =>
    typeof key === "string" ? key : key.toString();

// Default: auth lolos. Per-test boleh override key spesifik via mockImplementationOnce.
const defaultRedisGet = async (key: RedisKeyArg): Promise<string | null> => {
    if (keyToString(key).startsWith("session:")) return VALID_SESSION;
    return null;
};

describe("FGRoutes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(redisClient.get).mockImplementation(defaultRedisGet);
    });

    describe("GET /lookup", () => {
        it("returns 200 + data dari DB saat cache miss, lalu set ke Redis", async () => {
            vi.mocked(prisma.product.findMany).mockResolvedValueOnce([
                {
                    id: 1,
                    code: "FG_001",
                    name: "FG One",
                    gender: "UNISEX",
                    size: { size: 100 },
                    unit: { name: "ml" },
                    product_type: { name: "Parfum" },
                } as never,
            ]);

            const res = await app.request(`${FG_BASE}/lookup`, { method: "GET" });
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body.status).toBe("success");
            expect(redisClient.set).toHaveBeenCalledWith(
                "fg:lookup",
                expect.any(String),
                "EX",
                3600,
            );
        });

        it("returns 200 dari cache hit tanpa hit DB", async () => {
            const cachedPayload = JSON.stringify([
                {
                    id: 1,
                    code: "FG_CACHED",
                    name: "From Cache",
                    gender: "UNISEX",
                    size: "100ml",
                    unit: "ml",
                    product_type: "Parfum",
                },
            ]);
            vi.mocked(redisClient.get).mockImplementation(async (key: RedisKeyArg) => {
                const k = keyToString(key);
                if (k.startsWith("session:")) return VALID_SESSION;
                if (k === "fg:lookup") return cachedPayload;
                return null;
            });

            const res = await app.request(`${FG_BASE}/lookup`, { method: "GET" });

            expect(res.status).toBe(200);
            expect(prisma.product.findMany).not.toHaveBeenCalled();
        });

        it("fallback ke DB saat cache payload korup (schema drift)", async () => {
            vi.mocked(redisClient.get).mockImplementation(async (key: RedisKeyArg) => {
                const k = keyToString(key);
                if (k.startsWith("session:")) return VALID_SESSION;
                if (key === "fg:lookup") return JSON.stringify([{ broken: "shape" }]);
                return null;
            });
            vi.mocked(prisma.product.findMany).mockResolvedValueOnce([]);

            const res = await app.request(`${FG_BASE}/lookup`, { method: "GET" });

            expect(res.status).toBe(200);
            expect(redisClient.del).toHaveBeenCalledWith("fg:lookup");
            expect(prisma.product.findMany).toHaveBeenCalled();
        });
    });

    describe("GET /", () => {
        it("returns 200 dengan list FG", async () => {
            vi.mocked(prisma.product.findMany).mockResolvedValueOnce([]);
            vi.mocked(prisma.product.count).mockResolvedValueOnce(0);

            const res = await app.request(`${FG_BASE}`, { method: "GET" });
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body.status).toBe("success");
        });
    });

    describe("GET /:id", () => {
        it("returns 200 dengan detail FG", async () => {
            vi.mocked(prisma.product.findUnique).mockResolvedValueOnce({
                id: 1,
                code: "FG_001",
                name: "FG One",
                z_value: "1.65",
                distribution_percentage: "0.5",
                safety_percentage: "0.1",
                product_type: { id: 1, name: "Parfum", slug: "parfum" },
                unit: { id: 1, name: "ml", slug: "ml" },
                size: { id: 1, size: 100 },
                product_inventories: [],
                recipes: [],
            } as never);

            const res = await app.request(`${FG_BASE}/1`, { method: "GET" });

            expect(res.status).toBe(200);
        });

        it("returns 404 saat FG tidak ditemukan", async () => {
            vi.mocked(prisma.product.findUnique).mockResolvedValueOnce(null);

            const res = await app.request(`${FG_BASE}/999`, { method: "GET" });

            expect(res.status).toBe(404);
        });
    });

    describe("POST /", () => {
        it("returns 201 saat create sukses dengan body valid", async () => {
            const res = await app.request(`${FG_BASE}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    code: "FG_NEW",
                    name: "Brand New FG",
                    size: 100,
                    gender: "UNISEX",
                    z_value: 1.65,
                    lead_time: 14,
                    review_period: 30,
                    product_type: "Parfum",
                    unit: "ml",
                }),
            });

            expect(res.status).toBe(201);
        });

        it("returns 400 saat body invalid (code tidak ada)", async () => {
            const res = await app.request(`${FG_BASE}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "No Code" }),
            });

            expect(res.status).toBe(400);
        });
    });

    describe("PUT /:id", () => {
        it("returns 201 saat update sukses", async () => {
            vi.mocked(prisma.product.findUnique).mockResolvedValueOnce({
                id: 1,
                code: "FG_001",
                type_id: 1,
                unit_id: 1,
                size_id: 1,
            } as never);

            const res = await app.request(`${FG_BASE}/1`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "Updated Name" }),
            });

            expect(res.status).toBe(201);
        });
    });

    describe("PATCH /status/:id", () => {
        it("returns 201 saat status valid", async () => {
            vi.mocked(prisma.product.findUnique).mockResolvedValueOnce({ id: 1 } as never);

            const res = await app.request(`${FG_BASE}/status/1?status=ACTIVE`, {
                method: "PATCH",
            });

            expect(res.status).toBe(201);
        });

        it("returns 400 saat status query invalid", async () => {
            const res = await app.request(`${FG_BASE}/status/1?status=BOGUS`, {
                method: "PATCH",
            });

            expect(res.status).toBe(400);
        });
    });

    describe("PUT /bulk-status", () => {
        it("returns 200 saat bulk-status sukses", async () => {
            vi.mocked(prisma.product.updateMany).mockResolvedValueOnce({ count: 3 });

            const res = await app.request(`${FG_BASE}/bulk-status`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids: [1, 2, 3], status: "ACTIVE" }),
            });

            expect(res.status).toBe(200);
        });

        it("returns 400 saat ids kosong (validasi Zod)", async () => {
            const res = await app.request(`${FG_BASE}/bulk-status`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids: [], status: "ACTIVE" }),
            });

            expect(res.status).toBe(400);
        });
    });

    describe("GET /export", () => {
        it("returns CSV buffer dengan Content-Type text/csv", async () => {
            vi.mocked(prisma.product.findMany).mockResolvedValueOnce([]);
            vi.mocked(prisma.product.count).mockResolvedValueOnce(0);

            const res = await app.request(`${FG_BASE}/export`, { method: "GET" });

            expect(res.status).toBe(200);
            expect(res.headers.get("Content-Type")).toContain("text/csv");
        });
    });
});
