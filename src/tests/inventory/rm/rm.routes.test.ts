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

const RM_BASE = "/api/app/inventory/rm";

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

describe("RMRoutes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(redisClient.get).mockImplementation(defaultRedisGet);
    });

    describe("GET /", () => {
        it("returns 200 dengan list raw material", async () => {
            vi.mocked(prisma.rawMaterial.findMany).mockResolvedValueOnce([] as never);
            vi.mocked(prisma.rawMaterial.count).mockResolvedValueOnce(0);

            const res = await app.request(`${RM_BASE}`, { method: "GET" });
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body.status).toBe("success");
        });

        it("returns 400 saat query invalid (page non-positive)", async () => {
            const res = await app.request(`${RM_BASE}?page=-1`, { method: "GET" });

            expect(res.status).toBe(400);
        });
    });

    describe("GET /:id", () => {
        it("returns 200 dengan detail", async () => {
            const res = await app.request(`${RM_BASE}/1`, { method: "GET" });

            expect(res.status).toBe(200);
        });

        it("returns 404 saat tidak ditemukan", async () => {
            vi.mocked(prisma.rawMaterial.findUnique).mockResolvedValueOnce(null);

            const res = await app.request(`${RM_BASE}/999`, { method: "GET" });

            expect(res.status).toBe(404);
        });

        it("returns 400 saat id non-numeric", async () => {
            const res = await app.request(`${RM_BASE}/abc`, { method: "GET" });

            expect(res.status).toBe(400);
        });
    });

    describe("POST /", () => {
        it("returns 201 saat create sukses dengan body valid", async () => {
            const res = await app.request(`${RM_BASE}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    barcode: "RM-NEW",
                    name: "Raw Material Baru",
                    unit: "kg",
                    type: "FO",
                }),
            });

            expect(res.status).toBe(201);
        });

        it("returns 400 saat body invalid (name kosong)", async () => {
            const res = await app.request(`${RM_BASE}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ unit: "kg" }),
            });

            expect(res.status).toBe(400);
        });
    });

    describe("PUT /:id", () => {
        it("returns 201 saat update sukses", async () => {
            const res = await app.request(`${RM_BASE}/1`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "Updated Name" }),
            });

            expect(res.status).toBe(201);
        });
    });

    describe("PATCH /:id/restore", () => {
        it("returns 200 saat restore raw material yang sudah deleted", async () => {
            vi.mocked(prisma.rawMaterial.findUnique).mockResolvedValueOnce({
                deleted_at: new Date(),
            } as never);

            const res = await app.request(`${RM_BASE}/1/restore`, { method: "PATCH" });

            expect(res.status).toBe(200);
        });
    });

    describe("DELETE /:id", () => {
        it("returns 200 saat soft-delete sukses", async () => {
            vi.mocked(prisma.rawMaterial.findUnique).mockResolvedValueOnce({
                deleted_at: null,
            } as never);

            const res = await app.request(`${RM_BASE}/1`, { method: "DELETE" });

            expect(res.status).toBe(200);
        });
    });

    describe("PUT /bulk-status", () => {
        it("returns 200 saat bulk-status sukses", async () => {
            vi.mocked(prisma.rawMaterial.updateMany).mockResolvedValueOnce({ count: 3 });

            const res = await app.request(`${RM_BASE}/bulk-status`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids: [1, 2, 3], status: "DELETE" }),
            });

            expect(res.status).toBe(200);
        });

        it("returns 400 saat ids kosong", async () => {
            const res = await app.request(`${RM_BASE}/bulk-status`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids: [], status: "DELETE" }),
            });

            expect(res.status).toBe(400);
        });

        it("returns 400 saat status invalid", async () => {
            const res = await app.request(`${RM_BASE}/bulk-status`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids: [1], status: "BOGUS" }),
            });

            expect(res.status).toBe(400);
        });
    });

    describe("GET /export", () => {
        it("returns CSV buffer dengan Content-Type text/csv", async () => {
            vi.mocked(prisma.rawMaterial.findMany).mockResolvedValueOnce([] as never);
            vi.mocked(prisma.rawMaterial.count).mockResolvedValueOnce(0);

            const res = await app.request(`${RM_BASE}/export`, { method: "GET" });

            expect(res.status).toBe(200);
            expect(res.headers.get("Content-Type")).toContain("text/csv");
        });
    });

});
