import { describe, it, expect, vi } from "vitest";
import app from "../app.js";
import prisma from "../config/prisma.js";

vi.mock("../config/redis.js", () => {
    const sessionPayload = JSON.stringify({
        email: "test@example.com",
        role: "SUPER_ADMIN",
        user: { id: 1 },
    });
    const mockRedis = {
        get: vi.fn().mockImplementation((key: string) => {
            if (key === "session:mock-session-id") return Promise.resolve(sessionPayload);
            return Promise.resolve(null);
        }),
        set: vi.fn().mockResolvedValue("OK"),
        setex: vi.fn().mockResolvedValue("OK"),
        del: vi.fn().mockResolvedValue(1),
        keys: vi.fn().mockResolvedValue([]),
        ping: vi.fn().mockResolvedValue("PONG"),
        type: vi.fn().mockResolvedValue("string"),
        hgetall: vi.fn().mockResolvedValue({ email: "test@example.com", role: "SUPER_ADMIN" }),
        expire: vi.fn().mockResolvedValue(true),
        connect: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
        quit: vi.fn().mockResolvedValue("OK"),
        disconnect: vi.fn(),
        status: "ready",
    };
    return { redisClient: mockRedis, closeRedisConnection: vi.fn() };
});

vi.mock("hono/cookie", async (importOriginal) => {
    const original = await importOriginal<typeof import("hono/cookie")>();
    return { ...original, getCookie: vi.fn().mockReturnValue("mock-session-id") };
});

vi.mock("../middleware/csrf.js", () => ({
    csrfMiddleware: async (c: any, next: any) => await next(),
}));

const BASE = "/api/app/consolidation";

describe("PATCH /api/app/consolidation/hide", () => {
    it("returns 200 with count on valid body", async () => {
        // @ts-ignore
        prisma.materialPurchaseDraft = {
            updateMany: vi.fn().mockResolvedValue({ count: 2 }),
        };

        const res = await app.request(`${BASE}/hide`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: [1, 2], hidden: true }),
        });

        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.status).toBe("success");
    });

    it("returns 400 when ids is empty", async () => {
        const res = await app.request(`${BASE}/hide`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: [], hidden: true }),
        });

        expect(res.status).toBe(400);
    });
});