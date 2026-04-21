import { beforeEach, describe, expect, it, vi } from "vitest";
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
        hgetall: vi.fn().mockResolvedValue({
            email: "test@example.com",
            role: "SUPER_ADMIN",
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

vi.mock("hono/cookie", async (importOriginal) => {
    const original = await importOriginal<typeof import("hono/cookie")>();
    return {
        ...original,
        getCookie: vi.fn().mockReturnValue("mock-session-id"),
    };
});

vi.mock("../../middleware/csrf.js", () => ({
    csrfMiddleware: async (c: any, next: any) => await next(),
}));

vi.mock("../../config/prisma.js", () => {
    const mockPrisma = {
        $transaction: vi.fn(),
        rawMaterial: { 
            create: vi.fn().mockResolvedValue({ id: 1, name: "RM A" }), 
            findUnique: vi.fn().mockResolvedValue({ id: 1, name: "RM A", deleted_at: null }), 
            findMany: vi.fn().mockResolvedValue([{ id: 1, name: "RM A" }]), 
            count: vi.fn().mockResolvedValue(1), 
            update: vi.fn().mockResolvedValue({ id: 1, name: "Updated RM" }), 
            deleteMany: vi.fn().mockResolvedValue({ count: 1 }), 
            findFirst: vi.fn().mockResolvedValue({ id: 1, name: "RM A", deleted_at: null }) 
        },
        unitRawMaterial: { 
            findUnique: vi.fn().mockResolvedValue({ id: 1, name: "Unit A" }), 
            count: vi.fn().mockResolvedValue(1), 
            findMany: vi.fn().mockResolvedValue([{ id: 1, name: "Unit A" }]) 
        },
        rawMatCategories: { 
            findUnique: vi.fn().mockResolvedValue({ id: 1, name: "Cat A" }), 
            count: vi.fn().mockResolvedValue(1), 
            findMany: vi.fn().mockResolvedValue([{ id: 1, name: "Cat A" }]) 
        },
        supplier: { 
            findUnique: vi.fn().mockResolvedValue({ id: 1, name: "Sup A" }), 
            count: vi.fn().mockResolvedValue(1), 
            findMany: vi.fn().mockResolvedValue([{ id: 1, name: "Sup A" }]) 
        },
        stockMovement: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
        $queryRaw: vi.fn().mockResolvedValue([{ id: 1, name: "RM A", code: "RM-A" }]),
    };
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        if (Array.isArray(cb)) return Promise.all(cb);
        return cb(mockPrisma);
    });
    return { default: mockPrisma };
});

describe("RawMaterialRoutes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ─── LIST ─────────────────────────────────────────────────────────────────

    it("GET /api/app/rawmat should return 200", async () => {
        const res = await app.request("/api/app/rawmat", { method: "GET" });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.status).toBe("success");
    });

    it("GET /api/app/rawmat?status=deleted should return 200", async () => {
        const res = await app.request("/api/app/rawmat?status=deleted", { method: "GET" });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.status).toBe("success");
    });

    it("GET /api/app/rawmat?search=katun should return 200", async () => {
        const res = await app.request("/api/app/rawmat?search=katun", { method: "GET" });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.status).toBe("success");
    });

    // ─── DETAIL ───────────────────────────────────────────────────────────────

    it("GET /api/app/rawmat/:id should return 200", async () => {
        const res = await app.request("/api/app/rawmat/1", { method: "GET" });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.status).toBe("success");
    });

    // ─── CREATE ───────────────────────────────────────────────────────────────

    it("POST /api/app/rawmat should create raw material and return 201", async () => {
        // @ts-ignore
        prisma.rawMaterial.findUnique.mockResolvedValue(null);
        // @ts-ignore
        prisma.rawMaterial.create.mockResolvedValue({ id: 99, name: "Kain Polyester" });

        const payload = {
            barcode: "BARCODE_NOTFOUND",
            name: "Kain Polyester",
            price: 30000,
            unit: "meter",
        };

        const res = await app.request("/api/app/rawmat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        const body = await res.json();
        expect(res.status).toBe(201);
        expect(body.status).toBe("success");
    });

    it("POST /api/app/rawmat should return 400 if required fields missing", async () => {
        const res = await app.request("/api/app/rawmat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ barcode: "RM-INCOMPLETE" }),
        });

        expect(res.status).toBe(400);
    });

    // ─── UPDATE ───────────────────────────────────────────────────────────────

    it("PUT /api/app/rawmat/:id should update raw material and return 201", async () => {
        // @ts-ignore
        prisma.rawMaterial.findUnique.mockResolvedValue({ id: 1, name: "RM A" });
        // @ts-ignore
        prisma.rawMaterial.update.mockResolvedValue({ id: 1, name: "Updated RM" });

        const payload = { name: "Kain Katun Updated" };

        const res = await app.request("/api/app/rawmat/1", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        expect(res.status).toBe(201);
    });

    // ─── DELETE (soft) ────────────────────────────────────────────────────────

    it("DELETE /api/app/rawmat/:id should soft delete and return 200", async () => {
        // @ts-ignore
        prisma.rawMaterial.findUnique.mockResolvedValue({ id: 1, name: "RM A", deleted_at: null });
        // @ts-ignore
        prisma.rawMaterial.update.mockResolvedValue({ id: 1, name: "RM A", deleted_at: new Date() });

        const res = await app.request("/api/app/rawmat/1", { method: "DELETE" });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.status).toBe("success");
    });

    // ─── RESTORE ──────────────────────────────────────────────────────────────

    it("PATCH /api/app/rawmat/:id/restore should restore and return 200", async () => {
        // @ts-ignore
        prisma.rawMaterial.findUnique.mockResolvedValue({ id: 2, name: "RM B", deleted_at: new Date() });
        // @ts-ignore
        prisma.rawMaterial.update.mockResolvedValue({ id: 2, name: "RM B", deleted_at: null });

        const res = await app.request("/api/app/rawmat/2/restore", { method: "PATCH" });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.status).toBe("success");
    });

    // ─── CLEAN ────────────────────────────────────────────────────────────────

    it("DELETE /api/app/rawmat/clean should permanently delete and return 200", async () => {
        // @ts-ignore
        prisma.rawMaterial.count.mockResolvedValue(1);
        // @ts-ignore
        prisma.rawMaterial.findMany.mockResolvedValue([{ id: 1 }]);
        // @ts-ignore
        prisma.rawMaterial.deleteMany.mockResolvedValue({ count: 1 });

        const res = await app.request("/api/app/rawmat/clean", { method: "DELETE" });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.status).toBe("success");
    });

    // ─── UTILS ────────────────────────────────────────────────────────────────

    it("GET /api/app/rawmat/utils should return 200", async () => {
        const res = await app.request("/api/app/rawmat/utils", { method: "GET" });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.status).toBe("success");
    });

    it("GET /api/app/rawmat/count-utils should return 200", async () => {
        const res = await app.request("/api/app/rawmat/count-utils", { method: "GET" });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.status).toBe("success");
    });

    it("GET /api/app/rawmat/redis should return 200", async () => {
        const res = await app.request("/api/app/rawmat/redis", { method: "GET" });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.status).toBe("success");
    });
});
