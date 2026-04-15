import { describe, it, expect, vi, beforeEach } from "vitest";
import { StockLocationService } from "../../../module/application/inventory-v2/monitoring/stock-location/stock-location.service.js";
import prisma from "../../../config/prisma.js";

const mockWarehouseRow = {
    product_code: "TSHIRT-001",
    product_name: "T-Shirt Basic",
    type:         "Apparel",
    size:         40,
    gender:       "MEN",
    uom:          "pcs",
    quantity:     "80",
    min_stock:    null,
};

const mockOutletRow = {
    product_code: "SHOES-001",
    product_name: "Sepatu Sport",
    type:         "Footwear",
    size:         42,
    gender:       "MEN",
    uom:          "pasang",
    quantity:     "15",
    min_stock:    "5",
};

describe("StockLocationService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ── list – WAREHOUSE ─────────────────────────────────────────────────────

    describe("list (WAREHOUSE)", () => {
        it("should return stock data for warehouse", async () => {
            // @ts-ignore
            prisma.warehouse.findFirst.mockResolvedValueOnce({ name: "Gudang SBY" });
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 1n }])
                .mockResolvedValueOnce([mockWarehouseRow]);

            const result = await StockLocationService.list({
                location_type: "WAREHOUSE",
                location_id:   1,
            });

            expect(result.len).toBe(1);
            expect(result.location_name).toBe("Gudang SBY");
            expect(result.data[0]?.product_code).toBe("TSHIRT-001");
            expect(result.data[0]?.quantity).toBe(80);
            expect(result.data[0]?.min_stock).toBeNull();
        });

        it("should throw 404 if warehouse not found", async () => {
            // @ts-ignore
            prisma.warehouse.findFirst.mockResolvedValueOnce(null);

            await expect(
                StockLocationService.list({ location_type: "WAREHOUSE", location_id: 999 })
            ).rejects.toThrow("Gudang tidak ditemukan");
        });

        it("should return empty data when warehouse has no stock", async () => {
            // @ts-ignore
            prisma.warehouse.findFirst.mockResolvedValueOnce({ name: "Gudang Kosong" });
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 0n }])
                .mockResolvedValueOnce([]);

            const result = await StockLocationService.list({
                location_type: "WAREHOUSE",
                location_id:   2,
            });

            expect(result.len).toBe(0);
            expect(result.data).toHaveLength(0);
        });
    });

    // ── list – OUTLET ────────────────────────────────────────────────────────

    describe("list (OUTLET)", () => {
        it("should return stock data for outlet including min_stock", async () => {
            // @ts-ignore
            prisma.outlet.findFirst.mockResolvedValueOnce({ name: "Toko Utama" });
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 1n }])
                .mockResolvedValueOnce([mockOutletRow]);

            const result = await StockLocationService.list({
                location_type: "OUTLET",
                location_id:   1,
            });

            expect(result.len).toBe(1);
            expect(result.location_name).toBe("Toko Utama");
            expect(result.data[0]?.quantity).toBe(15);
            expect(result.data[0]?.min_stock).toBe(5);
        });

        it("should throw 404 if outlet not found", async () => {
            // @ts-ignore
            prisma.outlet.findFirst.mockResolvedValueOnce(null);

            await expect(
                StockLocationService.list({ location_type: "OUTLET", location_id: 999 })
            ).rejects.toThrow("Outlet tidak ditemukan");
        });
    });

    // ── listAvailableLocations ───────────────────────────────────────────────

    describe("listAvailableLocations", () => {
        it("should return combined WAREHOUSE + OUTLET locations", async () => {
            // @ts-ignore
            prisma.warehouse.findMany.mockResolvedValueOnce([
                { id: 1, name: "Gudang SBY" },
            ]);
            // @ts-ignore
            prisma.outlet.findMany.mockResolvedValueOnce([
                { id: 1, name: "Toko A" },
                { id: 2, name: "Toko B" },
            ]);

            const result = await StockLocationService.listAvailableLocations();

            expect(result).toHaveLength(3);
            expect(result[0]!.type).toBe("WAREHOUSE");
            expect(result[1]!.type).toBe("OUTLET");
        });

        it("should return empty array when no locations", async () => {
            // @ts-ignore
            prisma.warehouse.findMany.mockResolvedValueOnce([]);
            // @ts-ignore
            prisma.outlet.findMany.mockResolvedValueOnce([]);

            const result = await StockLocationService.listAvailableLocations();

            expect(result).toHaveLength(0);
        });
    });
});
