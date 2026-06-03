import { describe, it, expect, vi, beforeEach } from "vitest";
import { StockLocationFGService } from "../../../../module/application/inventory/monitoring/stock-location/fg/fg.service.js";
import prisma from "../../../../config/prisma.js";

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

const OUTLET_ROW = {
    product_code: "SHOES-001",
    product_name: "Sepatu Sport",
    type:         "Footwear",
    size:         42,
    gender:       "MEN",
    uom:          "pasang",
    quantity:     "15",
    min_stock:    "5",
};

describe("StockLocationFGService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("list (WAREHOUSE explicit)", () => {
        it("returns stock data and maps quantity to number", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValueOnce({ name: "Gudang SBY" });
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 1n }])
                .mockResolvedValueOnce([WAREHOUSE_ROW]);

            const result = await StockLocationFGService.list({
                location_type: "WAREHOUSE",
                location_id:   1,
            });

            expect(result.len).toBe(1);
            expect(result.location_name).toBe("Gudang SBY");
            expect(result.data[0]).toMatchObject({
                product_code:  "TSHIRT-001",
                quantity:      80,
                min_stock:     null,
                location_name: "Gudang SBY",
            });
        });

        it("throws 404 when warehouse not found / non-FG", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValueOnce(null);

            await expect(
                StockLocationFGService.list({ location_type: "WAREHOUSE", location_id: 999 }),
            ).rejects.toThrow("Gudang tidak ditemukan");
        });

        it("returns empty data when warehouse has no matching products", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValueOnce({ name: "Gudang Kosong" });
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 0n }])
                .mockResolvedValueOnce([]);

            const result = await StockLocationFGService.list({
                location_type: "WAREHOUSE",
                location_id:   2,
            });

            expect(result.len).toBe(0);
            expect(result.data).toHaveLength(0);
        });
    });

    describe("list (OUTLET explicit)", () => {
        it("returns outlet stock with numeric min_stock", async () => {
            (prisma.outlet.findFirst as any).mockResolvedValueOnce({ name: "Toko Utama" });
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 1n }])
                .mockResolvedValueOnce([OUTLET_ROW]);

            const result = await StockLocationFGService.list({
                location_type: "OUTLET",
                location_id:   1,
            });

            expect(result.location_name).toBe("Toko Utama");
            expect(result.data[0]).toMatchObject({ quantity: 15, min_stock: 5 });
        });

        it("throws 404 when outlet not found", async () => {
            (prisma.outlet.findFirst as any).mockResolvedValueOnce(null);

            await expect(
                StockLocationFGService.list({ location_type: "OUTLET", location_id: 999 }),
            ).rejects.toThrow("Outlet tidak ditemukan");
        });
    });

    describe("list (default location)", () => {
        it("defaults to GFG-SBY when location_type/id not provided", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValueOnce({ id: 1, name: "GFG Surabaya" });
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 1n }])
                .mockResolvedValueOnce([WAREHOUSE_ROW]);

            const result = await StockLocationFGService.list({});

            expect(prisma.warehouse.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ code: "GFG-SBY", type: "FINISH_GOODS" }),
                }),
            );
            expect(result.location_name).toBe("GFG Surabaya");
            expect(result.len).toBe(1);
        });

        it("falls back to first FG warehouse when GFG-SBY missing", async () => {
            (prisma.warehouse.findFirst as any)
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce({ id: 7, name: "Gudang FG Lain" });
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 0n }])
                .mockResolvedValueOnce([]);

            const result = await StockLocationFGService.list({});

            expect(result.location_name).toBe("Gudang FG Lain");
        });

        it("throws 404 when no FG warehouse exists at all", async () => {
            (prisma.warehouse.findFirst as any)
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(null);

            await expect(StockLocationFGService.list({})).rejects.toThrow("Tidak ada lokasi");
        });
    });

    describe("listAvailableLocations", () => {
        it("returns combined WAREHOUSE + OUTLET locations", async () => {
            (prisma.warehouse.findMany as any).mockResolvedValueOnce([{ id: 1, name: "Gudang SBY" }]);
            (prisma.outlet.findMany    as any).mockResolvedValueOnce([
                { id: 1, name: "Toko A" },
                { id: 2, name: "Toko B" },
            ]);

            const result = await StockLocationFGService.listAvailableLocations();

            expect(result).toHaveLength(3);
            expect(result[0]).toEqual({ id: 1, name: "Gudang SBY", type: "WAREHOUSE" });
            expect(result[1]).toEqual({ id: 1, name: "Toko A",     type: "OUTLET" });
        });

        it("returns empty array when no locations", async () => {
            (prisma.warehouse.findMany as any).mockResolvedValueOnce([]);
            (prisma.outlet.findMany    as any).mockResolvedValueOnce([]);

            const result = await StockLocationFGService.listAvailableLocations();
            expect(result).toHaveLength(0);
        });
    });

    describe("export", () => {
        it("delegates to list with EXPORT_ROW_LIMIT and page=1", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValueOnce({ name: "Gudang SBY" });
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 1n }])
                .mockResolvedValueOnce([WAREHOUSE_ROW]);

            const result = await StockLocationFGService.export({
                location_type: "WAREHOUSE",
                location_id:   1,
            });

            expect(result.location_name).toBe("Gudang SBY");
            expect(result.data).toHaveLength(1);
        });

        it("throws 400 ApiError when total exceeds EXPORT_ROW_LIMIT", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValueOnce({ name: "Gudang SBY" });
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 5_001n }])
                .mockResolvedValueOnce([WAREHOUSE_ROW]);

            await expect(
                StockLocationFGService.export({ location_type: "WAREHOUSE", location_id: 1 }),
            ).rejects.toMatchObject({ statusCode: 400 });
        });
    });
});
