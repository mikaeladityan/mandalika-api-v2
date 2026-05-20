import { describe, it, expect, vi, beforeEach } from "vitest";
import app from "../../../../app.js";
import prisma from "../../../../config/prisma.js";

vi.mock("../../../../config/redis.js", () => {
    const sessionJson = JSON.stringify({
        email: "test@example.com",
        role:  "SUPER_ADMIN",
        user:  { id: "u-1" },
        employee: { permissions: [] },
    });
    const mockRedis = {
        get:     vi.fn().mockResolvedValue(sessionJson),
        set:     vi.fn().mockResolvedValue("OK"),
        setex:   vi.fn().mockResolvedValue("OK"),
        del:     vi.fn().mockResolvedValue(1),
        keys:    vi.fn().mockResolvedValue([]),
        hgetall: vi.fn().mockResolvedValue({ email: "test@example.com", role: "SUPER_ADMIN" }),
        ping:    vi.fn().mockResolvedValue("PONG"),
        type:    vi.fn().mockResolvedValue("hash"),
        expire:  vi.fn().mockResolvedValue(true),
        connect: vi.fn().mockResolvedValue(undefined),
        on:      vi.fn(),
        quit:    vi.fn().mockResolvedValue("OK"),
        disconnect: vi.fn(),
        status:  "ready",
    };
    return { redisClient: mockRedis, closeRedisConnection: vi.fn() };
});

vi.mock("hono/cookie", async (importOriginal) => {
    const original = await importOriginal<typeof import("hono/cookie")>();
    return { ...original, getCookie: vi.fn().mockReturnValue("mock-session-id") };
});

vi.mock("../../../../middleware/csrf.js", () => ({
    csrfMiddleware: async (_c: unknown, next: () => Promise<void>) => await next(),
}));

const ROW_SAMPLE = {
    id:                1,
    entity_type:       "PRODUCT",
    entity_id:         10,
    product_code:      "P-001",
    product_name:      "T-Shirt",
    barcode:           null,
    category:          "Apparel",
    size:              "M",
    location_type:     "WAREHOUSE",
    location_id:       5,
    location_name:     "Gudang SBY",
    movement_type:     "TRANSFER_OUT",
    quantity:          "50",
    qty_before:        "100",
    qty_after:         "50",
    reference_id:      99,
    reference_type:    "STOCK_TRANSFER",
    reference_code:    "TRF-001",
    reference_subtype: "DO",
    destination_name:  "Toko A",
    created_by:        "system",
    created_at:        new Date("2026-05-20T08:00:00Z"),
};

const BASE_URL = "/api/app/inventory/monitoring/stock-movement";

describe("StockMovementRoutes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe(`GET ${BASE_URL}`, () => {
        it("returns 200 with paginated list", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValueOnce({ id: 5 });
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 1n }])
                .mockResolvedValueOnce([ROW_SAMPLE]);

            const res = await app.request(BASE_URL, { method: "GET" });

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.status).toBe("success");
            expect(body.data.len).toBe(1);
            expect(body.data.data[0]).toMatchObject({
                id:           1,
                product_code: "P-001",
                quantity:     50,
            });
        });

        it("returns 400 when query validation fails", async () => {
            const res = await app.request(`${BASE_URL}?entity_type=INVALID`, { method: "GET" });
            expect(res.status).toBe(400);
        });
    });

    describe(`GET ${BASE_URL}/export`, () => {
        it("returns CSV with proper headers when data exists", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValueOnce({ id: 5 });
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 1n }])
                .mockResolvedValueOnce([ROW_SAMPLE]);

            const res = await app.request(`${BASE_URL}/export`, { method: "GET" });

            expect(res.status).toBe(200);
            expect(res.headers.get("Content-Type")).toMatch(/text\/csv/);
            expect(res.headers.get("Content-Disposition")).toMatch(/stock-movement-/);
            const csv = await res.text();
            expect(csv).toContain("Product Code");
            expect(csv).toContain("P-001");
        });

        it("returns 200 with empty-message body when no data", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValueOnce({ id: 5 });
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 0n }])
                .mockResolvedValueOnce([]);

            const res = await app.request(`${BASE_URL}/export`, { method: "GET" });

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.data.message).toBe("Tidak ada data untuk di-export");
        });

        it("returns 400 when result exceeds EXPORT_MAX_ROWS", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValueOnce({ id: 5 });
            (prisma.$queryRaw as any).mockResolvedValueOnce([{ total: 50_001n }]);

            const res = await app.request(`${BASE_URL}/export`, { method: "GET" });

            expect(res.status).toBe(400);
        });
    });
});
