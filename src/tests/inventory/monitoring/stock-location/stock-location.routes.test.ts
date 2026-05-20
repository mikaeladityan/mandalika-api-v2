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

const WAREHOUSE_ROW = {
    product_code: "TSHIRT-001",
    product_name: "T-Shirt Basic",
    type:         "Apparel",
    size:         40,
    gender:       "MEN",
    uom:          "pcs",
    quantity:     "80",
    min_stock:    null,
};

const BASE_URL = "/api/app/inventory/monitoring/stock-location";

describe("StockLocationRoutes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe(`GET ${BASE_URL}`, () => {
        it("returns 200 with default GFG-SBY when no location params", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValueOnce({ id: 1, name: "GFG Surabaya" });
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 1n }])
                .mockResolvedValueOnce([WAREHOUSE_ROW]);

            const res = await app.request(BASE_URL, { method: "GET" });

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.status).toBe("success");
            expect(body.data.location_name).toBe("GFG Surabaya");
            expect(body.data.len).toBe(1);
            expect(body.data.data[0]).toMatchObject({ product_code: "TSHIRT-001", quantity: 80 });
        });

        it("returns 400 when sortBy is invalid (whitelist enforced)", async () => {
            const res = await app.request(`${BASE_URL}?sortBy=invalid_col`, { method: "GET" });
            expect(res.status).toBe(400);
        });

        it("returns 404 when explicit warehouse not found", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValueOnce(null);

            const res = await app.request(
                `${BASE_URL}?location_type=WAREHOUSE&location_id=999`,
                { method: "GET" },
            );
            expect(res.status).toBe(404);
        });
    });

    describe(`GET ${BASE_URL}/locations`, () => {
        it("returns combined warehouse + outlet list", async () => {
            (prisma.warehouse.findMany as any).mockResolvedValueOnce([{ id: 1, name: "Gudang SBY" }]);
            (prisma.outlet.findMany    as any).mockResolvedValueOnce([{ id: 1, name: "Toko A" }]);

            const res = await app.request(`${BASE_URL}/locations`, { method: "GET" });

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.data).toHaveLength(2);
        });
    });

    describe(`GET ${BASE_URL}/export`, () => {
        it("returns CSV with UTF-8 BOM + headers when data exists", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValueOnce({ name: "Gudang SBY" });
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 1n }])
                .mockResolvedValueOnce([WAREHOUSE_ROW]);

            const res = await app.request(
                `${BASE_URL}/export?location_type=WAREHOUSE&location_id=1`,
                { method: "GET" },
            );

            expect(res.status).toBe(200);
            expect(res.headers.get("Content-Type")).toMatch(/text\/csv/);
            expect(res.headers.get("Content-Disposition")).toMatch(/stock-location-/);

            const bytes = new Uint8Array(await res.arrayBuffer());
            expect(bytes[0]).toBe(0xef);
            expect(bytes[1]).toBe(0xbb);
            expect(bytes[2]).toBe(0xbf);
            const csv = new TextDecoder("utf-8").decode(bytes);
            expect(csv).toContain("Nama Lokasi");
            expect(csv).toContain("TSHIRT-001");
        });

        it("returns 200 with empty-message body when no data", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValueOnce({ name: "Gudang Kosong" });
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 0n }])
                .mockResolvedValueOnce([]);

            const res = await app.request(
                `${BASE_URL}/export?location_type=WAREHOUSE&location_id=2`,
                { method: "GET" },
            );

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.data.message).toBe("Tidak ada data untuk di-export");
        });
    });
});
