import { describe, it, expect, vi, beforeEach } from "vitest";
import app from "../../app.js";
import prisma from "../../config/prisma.js";

vi.mock("../../config/redis.js", () => {
    const mockRedis = {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue("OK"),
        setex: vi.fn().mockResolvedValue("OK"),
        del: vi.fn().mockResolvedValue(1),
        keys: vi.fn().mockResolvedValue([]),
        ping: vi.fn().mockResolvedValue("PONG"),
        type: vi.fn().mockResolvedValue("hash"),
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

vi.mock("../../middleware/csrf.js", () => ({
    csrfMiddleware: async (c: any, next: any) => await next(),
}));

const mockOutlet = {
    id: 1,
    name: "Toko Utama",
    code: "TOKO001",
    phone: null,
    is_active: true,
    warehouse_id: 1,
    deleted_at: null,
    created_at: new Date(),
    updated_at: null,
    address: null,
    warehouse: { id: 1, name: "Gudang Utama", type: "FINISH_GOODS" },
    _count: { inventories: 0 },
};

describe("OutletRoutes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ─── LIST ─────────────────────────────────────────────────────────────────

    describe("GET /api/app/outlets", () => {
        it("should return 200 with list of outlets", async () => {
            // @ts-ignore
            prisma.outlet.findMany.mockResolvedValue([mockOutlet]);
            // @ts-ignore
            prisma.outlet.count.mockResolvedValue(1);

            const res = await app.request("/api/app/outlets", { method: "GET" });
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body.status).toBe("success");
            expect(body.data).toBeDefined();
        });

        it("should return 200 with empty list", async () => {
            // @ts-ignore
            prisma.outlet.findMany.mockResolvedValue([]);
            // @ts-ignore
            prisma.outlet.count.mockResolvedValue(0);

            const res = await app.request("/api/app/outlets", { method: "GET" });
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body.status).toBe("success");
        });

        it("should return 200 with search query", async () => {
            // @ts-ignore
            prisma.outlet.findMany.mockResolvedValue([mockOutlet]);
            // @ts-ignore
            prisma.outlet.count.mockResolvedValue(1);

            const res = await app.request("/api/app/outlets?search=toko", { method: "GET" });

            expect(res.status).toBe(200);
        });

        it("should return 200 filtered by is_active=true", async () => {
            // @ts-ignore
            prisma.outlet.findMany.mockResolvedValue([mockOutlet]);
            // @ts-ignore
            prisma.outlet.count.mockResolvedValue(1);

            const res = await app.request("/api/app/outlets?is_active=true", { method: "GET" });

            expect(res.status).toBe(200);
        });

        it("should return 200 filtered by warehouse_id", async () => {
            // @ts-ignore
            prisma.outlet.findMany.mockResolvedValue([mockOutlet]);
            // @ts-ignore
            prisma.outlet.count.mockResolvedValue(1);

            const res = await app.request("/api/app/outlets?warehouse_id=1", { method: "GET" });

            expect(res.status).toBe(200);
        });

        it("should return 200 with pagination params", async () => {
            // @ts-ignore
            prisma.outlet.findMany.mockResolvedValue([mockOutlet]);
            // @ts-ignore
            prisma.outlet.count.mockResolvedValue(5);

            const res = await app.request(
                "/api/app/outlets?page=1&take=10&sortBy=name&sortOrder=desc",
                { method: "GET" },
            );

            expect(res.status).toBe(200);
        });
    });

    // ─── DETAIL ───────────────────────────────────────────────────────────────

    describe("GET /api/app/outlets/:id", () => {
        it("should return 200 with outlet detail", async () => {
            // @ts-ignore
            prisma.outlet.findUnique.mockResolvedValue(mockOutlet);

            const res = await app.request("/api/app/outlets/1", { method: "GET" });
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body.status).toBe("success");
            expect(body.data).toBeDefined();
        });

        it("should return 404 if outlet not found", async () => {
            // @ts-ignore
            prisma.outlet.findUnique.mockResolvedValue(null);

            const res = await app.request("/api/app/outlets/999", { method: "GET" });
            const body = await res.json();

            expect(res.status).toBe(404);
            expect(body.success).toBe(false);
        });
    });

    // ─── CREATE ───────────────────────────────────────────────────────────────

    describe("POST /api/app/outlets", () => {
        it("should return 201 on successful create", async () => {
            // @ts-ignore
            prisma.outlet.findUnique.mockResolvedValue(null); // no duplicate
            // @ts-ignore
            prisma.outlet.create.mockResolvedValue(mockOutlet);

            const res = await app.request("/api/app/outlets", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "Toko Baru", code: "TOKO002" }),
            });
            const body = await res.json();

            expect(res.status).toBe(201);
            expect(body.status).toBe("success");
            expect(body.data.name).toBeDefined();
        });

        it("should return 201 with full payload including address", async () => {
            // @ts-ignore
            prisma.outlet.findUnique.mockResolvedValue(null);
            // @ts-ignore
            prisma.outlet.create.mockResolvedValue({ ...mockOutlet, address: { street: "Jl. Raya" } });

            const res = await app.request("/api/app/outlets", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: "Toko Lengkap",
                    code: "TOKO003",
                    phone: "08123456789",
                    warehouse_id: 1,
                    address: {
                        street: "Jl. Raya No. 1",
                        district: "Ciputat",
                        sub_district: "Ciputat Timur",
                        city: "Tangerang Selatan",
                        province: "Banten",
                        country: "Indonesia",
                        postal_code: "15411",
                    },
                }),
            });

            expect(res.status).toBe(201);
        });

        it("should return 400 if name is missing", async () => {
            const res = await app.request("/api/app/outlets", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code: "TOKO002" }),
            });

            expect(res.status).toBe(400);
        });

        it("should return 400 if code is missing", async () => {
            const res = await app.request("/api/app/outlets", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "Toko Baru" }),
            });

            expect(res.status).toBe(400);
        });

        it("should return 400 if code has invalid characters", async () => {
            const res = await app.request("/api/app/outlets", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "Toko Baru", code: "toko invalid!" }),
            });

            expect(res.status).toBe(400);
        });

        it("should return 409 if code already exists", async () => {
            // @ts-ignore
            prisma.outlet.findUnique.mockResolvedValue(mockOutlet); // duplicate

            const res = await app.request("/api/app/outlets", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "Toko Baru", code: "TOKO001" }),
            });

            expect(res.status).toBe(409);
        });

        it("should return 422 if warehouse is not FINISH_GOODS type", async () => {
            // @ts-ignore
            prisma.outlet.findUnique.mockResolvedValue(null); // no code conflict
            // id=3 returns RAW_MATERIAL from global mock

            const res = await app.request("/api/app/outlets", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "Toko Baru", code: "TOKO002", warehouse_id: 3 }),
            });

            expect(res.status).toBe(422);
        });
    });

    // ─── UPDATE ───────────────────────────────────────────────────────────────

    describe("PUT /api/app/outlets/:id", () => {
        it("should return 200 on successful update", async () => {
            // @ts-ignore
            prisma.outlet.findUnique.mockResolvedValue(mockOutlet);
            // @ts-ignore
            prisma.outlet.update.mockResolvedValue({ ...mockOutlet, name: "Toko Updated" });

            const res = await app.request("/api/app/outlets/1", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "Toko Updated" }),
            });
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body.status).toBe("success");
        });

        it("should return 404 if outlet not found", async () => {
            // @ts-ignore
            prisma.outlet.findUnique.mockResolvedValue(null);

            const res = await app.request("/api/app/outlets/999", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: "X" }),
            });
            const body = await res.json();

            expect(res.status).toBe(404);
            expect(body.success).toBe(false);
        });

        it("should return 200 when updating only phone", async () => {
            // @ts-ignore
            prisma.outlet.findUnique.mockResolvedValue(mockOutlet);
            // @ts-ignore
            prisma.outlet.update.mockResolvedValue({ ...mockOutlet, phone: "08999999999" });

            const res = await app.request("/api/app/outlets/1", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ phone: "08999999999" }),
            });

            expect(res.status).toBe(200);
        });

        it("should return 409 if new code conflicts with existing outlet", async () => {
            // @ts-ignore
            (prisma.outlet.findUnique as any)
                .mockResolvedValueOnce(mockOutlet)               // outlet exists
                .mockResolvedValueOnce({ id: 2, code: "TOKO999" }); // code conflict

            const res = await app.request("/api/app/outlets/1", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code: "TOKO999" }),
            });

            expect(res.status).toBe(409);
        });
    });

    // ─── TOGGLE STATUS ────────────────────────────────────────────────────────

    describe("PATCH /api/app/outlets/:id/status", () => {
        it("should return 200 when toggling to inactive", async () => {
            // @ts-ignore
            prisma.outlet.findUnique.mockResolvedValue({ ...mockOutlet, is_active: true });
            // @ts-ignore
            prisma.outlet.update.mockResolvedValue({ id: 1, name: "Toko Utama", code: "TOKO001", is_active: false });

            const res = await app.request("/api/app/outlets/1/status", { method: "PATCH" });
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body.status).toBe("success");
        });

        it("should return 200 when toggling to active", async () => {
            // @ts-ignore
            prisma.outlet.findUnique.mockResolvedValue({ ...mockOutlet, is_active: false });
            // @ts-ignore
            prisma.outlet.update.mockResolvedValue({ id: 1, name: "Toko Utama", code: "TOKO001", is_active: true });

            const res = await app.request("/api/app/outlets/1/status", { method: "PATCH" });
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body.status).toBe("success");
        });

        it("should return 404 if outlet not found", async () => {
            // @ts-ignore
            prisma.outlet.findUnique.mockResolvedValue(null);

            const res = await app.request("/api/app/outlets/999/status", { method: "PATCH" });
            const body = await res.json();

            expect(res.status).toBe(404);
            expect(body.success).toBe(false);
        });
    });

    // ─── CLEAN ────────────────────────────────────────────────────────────────

    describe("DELETE /api/app/outlets/clean", () => {
        it("should return 200 when inactive outlets are cleaned", async () => {
            // @ts-ignore
            prisma.outlet.count.mockResolvedValue(2);
            // @ts-ignore
            prisma.outlet.deleteMany.mockResolvedValue({ count: 2 });

            const res = await app.request("/api/app/outlets/clean", { method: "DELETE" });
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body.status).toBe("success");
        });

        it("should return 400 if no inactive outlets exist", async () => {
            // @ts-ignore
            prisma.outlet.count.mockResolvedValue(0);

            const res = await app.request("/api/app/outlets/clean", { method: "DELETE" });
            const body = await res.json();

            expect(res.status).toBe(400);
            expect(body.success).toBe(false);
        });
    });

    // ─── DELETE ───────────────────────────────────────────────────────────────

    describe("DELETE /api/app/outlets/:id", () => {
        it("should return 200 on successful soft delete", async () => {
            // @ts-ignore
            prisma.outlet.findUnique.mockResolvedValue(mockOutlet);
            // @ts-ignore
            prisma.outlet.update.mockResolvedValue({ id: 1, name: "Toko Utama", code: "TOKO001" });

            const res = await app.request("/api/app/outlets/1", { method: "DELETE" });
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body.status).toBe("success");
        });

        it("should return 404 if outlet not found", async () => {
            // @ts-ignore
            prisma.outlet.findUnique.mockResolvedValue(null);

            const res = await app.request("/api/app/outlets/999", { method: "DELETE" });
            const body = await res.json();

            expect(res.status).toBe(404);
            expect(body.success).toBe(false);
        });
    });
});
