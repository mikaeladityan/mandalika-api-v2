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
    id:                 1,
    transfer_id:        100,
    product_id:         10,
    raw_material_id:    null,
    quantity_requested: "50",
    quantity_packed:    "50",
    quantity_received:  "48",
    quantity_fulfilled: "48",
    quantity_missing:   "2",
    quantity_rejected:  "0",
    notes:              "Kurang 2 pcs",
    product: {
        id: 10, code: "P-001", name: "T-Shirt",
        product_type: { id: 1, name: "Apparel" },
        size:         { id: 1, size: 40 },
        unit:         { id: 1, name: "pcs" },
    },
    transfer: {
        id:              100,
        transfer_number: "TRF-202605-0001",
        status:          "PARTIAL",
        created_at:      new Date("2026-05-20T08:00:00Z"),
        from_warehouse:  { id: 1, name: "Gudang SBY" },
        to_warehouse:    null,
        to_outlet:       { id: 5, name: "Toko Mandalika A" },
    },
};

const BASE_URL = "/api/app/inventory/monitoring/stock-discrepancy";

describe("StockDiscrepancyRoutes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe(`GET ${BASE_URL}`, () => {
        it("returns 200 with paginated list", async () => {
            (prisma.stockTransferItem.findMany as any).mockResolvedValueOnce([ROW_SAMPLE]);
            (prisma.stockTransferItem.count as any).mockResolvedValueOnce(1);

            const res = await app.request(BASE_URL, { method: "GET" });

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.status).toBe("success");
            expect(body.data.len).toBe(1);
            expect(body.data.data[0]).toMatchObject({
                transfer_number: "TRF-202605-0001",
                product_code:    "P-001",
                quantity_missing: 2,
            });
        });

        it("returns 400 when query validation fails", async () => {
            const res = await app.request(`${BASE_URL}?take=0`, { method: "GET" });
            expect(res.status).toBe(400);
        });
    });

    describe(`GET ${BASE_URL}/export`, () => {
        it("returns CSV with proper headers when data exists", async () => {
            (prisma.stockTransferItem.count as any).mockResolvedValueOnce(1);
            (prisma.stockTransferItem.findMany as any).mockResolvedValueOnce([ROW_SAMPLE]);

            const res = await app.request(`${BASE_URL}/export`, { method: "GET" });

            expect(res.status).toBe(200);
            expect(res.headers.get("Content-Type")).toMatch(/text\/csv/);
            expect(res.headers.get("Content-Disposition")).toMatch(/stock-discrepancy-audit-/);
            const csv = await res.text();
            expect(csv).toContain("No. Dokumen");
            expect(csv).toContain("TRF-202605-0001");
        });

        it("returns 200 with empty-message body when no data", async () => {
            (prisma.stockTransferItem.count as any).mockResolvedValueOnce(0);
            (prisma.stockTransferItem.findMany as any).mockResolvedValueOnce([]);

            const res = await app.request(`${BASE_URL}/export`, { method: "GET" });

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.data.message).toBe("Tidak ada data untuk di-export");
        });

        it("returns 400 when result exceeds EXPORT_MAX_ROWS", async () => {
            (prisma.stockTransferItem.count as any).mockResolvedValueOnce(5_001);

            const res = await app.request(`${BASE_URL}/export`, { method: "GET" });

            expect(res.status).toBe(400);
        });
    });
});
