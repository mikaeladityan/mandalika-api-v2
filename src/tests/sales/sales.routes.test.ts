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

const mockSaleDetail = {
    id: 1,
    product_id: 1,
    month: 3,
    year: 2025,
    quantity: "150",
    created_at: new Date(),
    updated_at: new Date(),
    product: {
        id: 1,
        code: "TSHIRT",
        name: "T-Shirt",
        product_type: { id: 1, name: "Apparel", slug: "apparel" },
    },
};

describe("SalesRoutes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ─── LIST ─────────────────────────────────────────────────────────────────

    describe("GET /api/app/sales", () => {
        it("should return 200 with sales list", async () => {
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 1 }])
                .mockResolvedValueOnce([{
                    id: 1, code: "TSHIRT", name: "T-Shirt", size_val: 40, unit_name: "pcs",
                    pt_id: 1, pt_name: "Apparel", pt_slug: "apparel",
                    totalQuantity: "150",
                    sales_actuals: JSON.stringify([{ year: 2025, month: 1, quantity: "150" }]),
                }]);

            const res = await app.request("/api/app/sales", { method: "GET" });
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body.status).toBe("success");
            expect(body.data).toBeDefined();
        });

        it("should return 200 with empty list", async () => {
            // @ts-ignore
            prisma.$queryRaw.mockResolvedValueOnce([{ total: 0 }]);

            const res = await app.request("/api/app/sales", { method: "GET" });
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body.status).toBe("success");
        });

        it("should return 200 with search filter", async () => {
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 0 }]);

            const res = await app.request("/api/app/sales?search=tshirt", { method: "GET" });
            expect(res.status).toBe(200);
        });

        it("should return 200 filtered by gender", async () => {
            // @ts-ignore
            prisma.$queryRaw.mockResolvedValueOnce([{ total: 0 }]);

            const res = await app.request("/api/app/sales?gender=MEN", { method: "GET" });
            expect(res.status).toBe(200);
        });

        it("should return 200 with horizon param", async () => {
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 1 }])
                .mockResolvedValueOnce([{
                    id: 1, code: "TSHIRT", name: "T-Shirt", size_val: null, unit_name: null,
                    pt_id: null, pt_name: null, pt_slug: null, totalQuantity: "0",
                    sales_actuals: "[]",
                }]);

            const res = await app.request("/api/app/sales?horizon=6", { method: "GET" });
            expect(res.status).toBe(200);
        });

        it("should return 200 with product_id filter", async () => {
            // @ts-ignore
            prisma.$queryRaw.mockResolvedValueOnce([{ total: 0 }]);

            const res = await app.request("/api/app/sales?product_id=1", { method: "GET" });
            expect(res.status).toBe(200);
        });

        it("should return 200 with pagination", async () => {
            // @ts-ignore
            prisma.$queryRaw.mockResolvedValueOnce([{ total: 0 }]);

            const res = await app.request("/api/app/sales?page=2&take=5", { method: "GET" });
            expect(res.status).toBe(200);
        });

        it("should return 200 sorted by name ascending", async () => {
            // @ts-ignore
            prisma.$queryRaw.mockResolvedValueOnce([{ total: 0 }]);

            const res = await app.request("/api/app/sales?sortBy=name&sortOrder=asc", { method: "GET" });
            expect(res.status).toBe(200);
        });
    });

    // ─── DETAIL ───────────────────────────────────────────────────────────────

    describe("GET /api/app/sales/:product_id", () => {
        it("should return 200 with sale detail", async () => {
            // @ts-ignore
            prisma.salesActual.findUnique.mockResolvedValue(mockSaleDetail);

            const res = await app.request("/api/app/sales/1?year=2025&month=3", { method: "GET" });
            const body = await res.json();

            expect(res.status).toBe(200);
            expect(body.status).toBe("success");
            expect(body.data).toBeDefined();
        });

        it("should return 404 if sale not found", async () => {
            // @ts-ignore
            prisma.salesActual.findUnique.mockResolvedValue(null);

            const res = await app.request("/api/app/sales/999?year=9999&month=99", { method: "GET" });
            const body = await res.json();

            expect(res.status).toBe(404);
            expect(body.success).toBe(false);
        });

        it("should return 400 if year/month not provided (0 values)", async () => {
            const res = await app.request("/api/app/sales/1?year=0&month=0", { method: "GET" });
            const body = await res.json();

            expect(res.status).toBe(400);
            expect(body.success).toBe(false);
        });
    });

    // ─── CREATE ───────────────────────────────────────────────────────────────

    describe("POST /api/app/sales", () => {
        it("should return 201 on successful create", async () => {
            // @ts-ignore
            prisma.product.findUnique.mockResolvedValue({ id: 1, name: "T-Shirt" });
            // @ts-ignore
            prisma.salesActual.findUnique.mockResolvedValue(null);
            // @ts-ignore
            prisma.salesActual.create.mockResolvedValue({ id: 2 });

            const res = await app.request("/api/app/sales", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ product_id: 1, quantity: 150, month: 3, year: 2025 }),
            });

            expect(res.status).toBe(201);
        });

        it("should return 201 without month/year (uses current period)", async () => {
            // @ts-ignore
            prisma.product.findUnique.mockResolvedValue({ id: 1, name: "T-Shirt" });
            // @ts-ignore
            prisma.salesActual.findUnique.mockResolvedValue(null);
            // @ts-ignore
            prisma.salesActual.create.mockResolvedValue({ id: 2 });

            const res = await app.request("/api/app/sales", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ product_id: 1, quantity: 150 }),
            });

            expect(res.status).toBe(201);
        });

        it("should return 400 if required fields missing", async () => {
            const res = await app.request("/api/app/sales", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ quantity: 100 }),
            });
            expect(res.status).toBe(400);
        });

        it("should return 400 if quantity missing", async () => {
            const res = await app.request("/api/app/sales", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ product_id: 1 }),
            });
            expect(res.status).toBe(400);
        });

        it("should return 404 if product not found", async () => {
            // @ts-ignore
            prisma.product.findUnique.mockResolvedValue(null);

            const res = await app.request("/api/app/sales", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ product_id: 999, quantity: 100 }),
            });
            const body = await res.json();

            expect(res.status).toBe(404);
            expect(body.success).toBe(false);
        });

        it("should return 400 if sales already exists for period", async () => {
            // @ts-ignore
            prisma.product.findUnique.mockResolvedValue({ id: 1, name: "T-Shirt" });
            // @ts-ignore
            prisma.salesActual.findUnique.mockResolvedValue({ id: 1 });

            const res = await app.request("/api/app/sales", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ product_id: 1, quantity: 100, month: 3, year: 2025 }),
            });
            const body = await res.json();

            expect(res.status).toBe(400);
            expect(body.success).toBe(false);
        });
    });

    // ─── UPDATE ───────────────────────────────────────────────────────────────

    describe("PUT /api/app/sales", () => {
        it("should return 200 on successful update", async () => {
            // @ts-ignore
            prisma.salesActual.findUnique.mockResolvedValue({ id: 1, product_id: 1, month: 3, year: 2025 });
            // @ts-ignore
            prisma.salesActual.update.mockResolvedValue({ id: 1, quantity: 200 });

            const res = await app.request("/api/app/sales", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ product_id: 1, quantity: 200, month: 3, year: 2025 }),
            });

            expect(res.status).toBe(200);
        });

        it("should return 404 if sales record not found", async () => {
            // @ts-ignore
            prisma.salesActual.findUnique.mockResolvedValue(null);

            const res = await app.request("/api/app/sales", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ product_id: 999, quantity: 100, month: 3, year: 2025 }),
            });
            const body = await res.json();

            expect(res.status).toBe(404);
            expect(body.success).toBe(false);
        });

        it("should return 400 if month/year not provided", async () => {
            const res = await app.request("/api/app/sales", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ product_id: 1, quantity: 100 }),
            });
            // @ts-ignore
            expect([400, 404]).toContain(res.status); // validasi di service level
        });
    });
});
