import { describe, it, expect, vi, beforeEach } from "vitest";
import app from "../../../../app.js";
import prisma from "../../../../config/prisma.js";
import { redisClient } from "../../../../config/redis.js";

vi.mock("hono/cookie", async (importOriginal) => {
    const original = await importOriginal<typeof import("hono/cookie")>();
    return {
        ...original,
        getCookie: vi.fn().mockReturnValue("mock-session-id"),
    };
});

vi.mock("../../../../middleware/csrf.js", () => ({
    csrfMiddleware: async (_c: unknown, next: () => Promise<void>) => await next(),
}));

const BASE = "/api/app/inventory/fg/sizes";
const VALID_SESSION = JSON.stringify({
    email: "test@example.com",
    role: "SUPER_ADMIN",
    employee: { permissions: [] },
});

type RedisKeyArg = string | Buffer;
const keyToString = (key: RedisKeyArg): string =>
    typeof key === "string" ? key : key.toString();

const defaultRedisGet = async (key: RedisKeyArg): Promise<string | null> => {
    if (keyToString(key).startsWith("session:")) return VALID_SESSION;
    return null;
};

describe("FGSizeRoutes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(redisClient.get).mockImplementation(defaultRedisGet);
    });

    describe("GET /", () => {
        it("returns 200 with list", async () => {
            const res = await app.request(BASE, { method: "GET" });
            expect(res.status).toBe(200);
        });
    });

    describe("POST /", () => {
        it("returns 201 on create success", async () => {
            const res = await app.request(BASE, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ size: 44 }),
            });
            expect(res.status).toBe(201);
        });

        it("returns 400 on invalid body", async () => {
            const res = await app.request(BASE, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ size: 0 }),
            });
            expect(res.status).toBe(400);
        });
    });

    describe("PUT /:id", () => {
        it("returns 200 on update success", async () => {
            const res = await app.request(`${BASE}/1`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ size: 39 }),
            });
            expect(res.status).toBe(200);
        });

        it("returns 400 when id param is not numeric", async () => {
            const res = await app.request(`${BASE}/abc`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ size: 39 }),
            });
            expect(res.status).toBe(400);
        });
    });

    describe("DELETE /:id", () => {
        it("returns 200 on delete success", async () => {
            vi.mocked(prisma.productSize.findUnique).mockResolvedValueOnce({
                _count: { products: 0 },
            } as never);

            const res = await app.request(`${BASE}/1`, { method: "DELETE" });
            expect(res.status).toBe(200);
        });

        it("returns 400 when id is invalid", async () => {
            const res = await app.request(`${BASE}/0`, { method: "DELETE" });
            expect(res.status).toBe(400);
        });
    });
});
