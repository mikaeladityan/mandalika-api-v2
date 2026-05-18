import { describe, it, expect, vi, beforeEach } from "vitest";
import app from "../../../../app.js";
import { redisClient } from "../../../../config/redis.js";
import { fgImportQueue } from "../../../../module/application/inventory/fg/import/queue/fg-import.queue.js";

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

const BASE = "/api/app/inventory/fg/import";

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

const cachePayload = {
    createdAt: Date.now(),
    total: 1,
    valid: 1,
    invalid: 0,
    rows: [
        {
            code: "FG_001",
            name: "Parfum",
            gender: "MEN",
            size: 100,
            type: "parfum",
            unit: "ml",
            distribution_percentage: 0,
            safety_percentage: 0,
            errors: [],
        },
    ],
};

describe("FGImportRoutes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(redisClient.get).mockImplementation(defaultRedisGet);
    });

    describe("POST /execute", () => {
        it("returns 400 saat import_id tidak ada (validateBody)", async () => {
            const res = await app.request(`${BASE}/execute`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            });
            expect(res.status).toBe(400);
        });

        it("returns 400 saat import_id bukan UUID valid", async () => {
            const res = await app.request(`${BASE}/execute`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ import_id: "not-a-uuid" }),
            });
            expect(res.status).toBe(400);
        });

        it("returns 400 saat cache tidak ditemukan", async () => {
            vi.mocked(redisClient.get).mockImplementation(defaultRedisGet);

            const res = await app.request(`${BASE}/execute`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ import_id: "123e4567-e89b-42d3-a456-426614174000" }),
            });
            expect(res.status).toBe(400);
        });

        it("returns 202 saat enqueue sukses", async () => {
            vi.mocked(redisClient.get).mockImplementation(async (key: RedisKeyArg) => {
                if (keyToString(key).startsWith("session:")) return VALID_SESSION;
                if (keyToString(key).startsWith("fg:import:")) return JSON.stringify(cachePayload);
                return null;
            });

            const res = await app.request(`${BASE}/execute`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ import_id: "123e4567-e89b-42d3-a456-426614174001" }),
            });
            expect(res.status).toBe(202);
            const body = await res.json();
            expect(body.data.state).toBe("queued");
            expect(body.data.import_id).toBe("123e4567-e89b-42d3-a456-426614174001");
        });
    });

    describe("GET /preview/:import_id", () => {
        it("returns 404 saat preview tidak ditemukan", async () => {
            vi.mocked(redisClient.get).mockImplementation(defaultRedisGet);

            const res = await app.request(`${BASE}/preview/123e4567-e89b-42d3-a456-426614174000`, {
                method: "GET",
            });
            expect(res.status).toBe(404);
        });

        it("returns 200 dengan summary + rows ketika cache valid", async () => {
            vi.mocked(redisClient.get).mockImplementation(async (key: RedisKeyArg) => {
                if (keyToString(key).startsWith("session:")) return VALID_SESSION;
                if (keyToString(key).startsWith("fg:import:")) return JSON.stringify(cachePayload);
                return null;
            });

            const res = await app.request(
                `${BASE}/preview/123e4567-e89b-42d3-a456-426614174000`,
                { method: "GET" },
            );
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.status).toBe("success");
        });
    });

    describe("GET /status/:import_id", () => {
        it("returns 404 saat job tidak ditemukan", async () => {
            vi.mocked(fgImportQueue.getJob).mockResolvedValueOnce(undefined);

            const res = await app.request(
                `${BASE}/status/123e4567-e89b-42d3-a456-426614174002`,
                { method: "GET" },
            );
            expect(res.status).toBe(404);
        });

        it("returns 200 dengan state + progress saat job aktif", async () => {
            vi.mocked(fgImportQueue.getJob).mockResolvedValueOnce({
                getState: vi.fn().mockResolvedValue("active"),
                progress: 60,
                returnvalue: null,
            } as never);

            const res = await app.request(
                `${BASE}/status/123e4567-e89b-42d3-a456-426614174003`,
                { method: "GET" },
            );
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.data.state).toBe("active");
            expect(body.data.progress).toBe(60);
        });
    });
});
