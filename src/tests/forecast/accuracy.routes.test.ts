import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../config/redis.js", () => {
    const sessionPayload = JSON.stringify({
        email: "test@example.com",
        role: "SUPER_ADMIN",
        user: { id: 1 },
    });
    const mockRedis = {
        get: vi.fn().mockResolvedValue(sessionPayload),
        set: vi.fn().mockResolvedValue("OK"),
        setex: vi.fn().mockResolvedValue("OK"),
        del: vi.fn().mockResolvedValue(1),
        keys: vi.fn().mockResolvedValue([]),
        ping: vi.fn().mockResolvedValue("PONG"),
        type: vi.fn().mockResolvedValue("string"),
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

vi.mock("../../middleware/csrf.js", () => ({
    csrfMiddleware: async (_c: any, next: any) => await next(),
}));

vi.mock("../../config/prisma.js", () => ({
    default: {
        $queryRaw: vi.fn(),
    },
}));

import app from "../../app.js";
import prisma from "../../config/prisma.js";

const BASE = "/api/app/forecasts/accuracy";

describe("GET /api/app/forecasts/accuracy", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns 200 with formatted percentages for explicit month+year", async () => {
        // @ts-ignore
        prisma.$queryRaw
            .mockResolvedValueOnce([
                {
                    product_id: 1,
                    product_code: "EDP-AZUR-100",
                    product_name: "AZURE",
                    product_type_name: "EDP",
                    size: 100,
                    unit_name: "pcs",
                    forecast: 320,
                    sales: 310,
                },
            ])
            .mockResolvedValueOnce([
                {
                    product_count: 1,
                    total_forecast: 320,
                    total_sales: 310,
                    excluded_count: 0,
                },
            ]);

        const res = await app.request(`${BASE}?month=5&year=2026`);
        expect(res.status).toBe(200);

        const body = await res.json();
        // ApiResponse.sendSuccess wraps result inside the response body.
        // Inspect the body shape — if the wrapper key isn't `data`, adapt assertions accordingly.
        const payload = body.data ?? body;
        expect(payload.period).toEqual({ month: 5, year: 2026 });
        expect(payload.data[0].accuracy_percentage).toBe("96.77%");
        expect(payload.summary.accuracy_percentage).toBe("96.77%");
        expect(payload.len).toBe(1);
    });

    it("falls back to most recent period when month/year omitted", async () => {
        // First $queryRaw = resolvePeriod fallback lookup
        // @ts-ignore
        prisma.$queryRaw
            .mockResolvedValueOnce([{ month: 4, year: 2026 }])     // resolvePeriod
            .mockResolvedValueOnce([])                              // page rows (empty)
            .mockResolvedValueOnce([{                               // aggregate
                product_count: 0,
                total_forecast: null,
                total_sales: null,
                excluded_count: 0,
            }]);

        const res = await app.request(BASE);
        expect(res.status).toBe(200);

        const body = await res.json();
        const payload = body.data ?? body;
        expect(payload.period).toEqual({ month: 4, year: 2026 });
        expect(payload.summary.accuracy_percentage).toBe("N/A");
    });

    it("returns 400 on invalid month", async () => {
        const res = await app.request(`${BASE}?month=99&year=2026`);
        expect(res.status).toBe(400);
    });
});
