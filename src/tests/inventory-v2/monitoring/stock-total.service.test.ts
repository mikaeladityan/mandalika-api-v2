import { describe, it, expect, vi, beforeEach } from "vitest";
import { StockTotalService } from "../../../module/application/inventory-v2/monitoring/stock-total/stock-total.service.js";
import prisma from "../../../config/prisma.js";

describe("StockTotalService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ── list ────────────────────────────────────────────────────────────────

    describe("list", () => {
        it("should return data and len with defaults", async () => {
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 3n }])   // count
                .mockResolvedValueOnce([                   // data
                    {
                        code:            "TSHIRT-001",
                        name:            "T-Shirt Basic",
                        type:            "Apparel",
                        size:            40,
                        gender:          "MEN",
                        uom:             "pcs",
                        total_stock:     "75",
                        location_stocks: { "Gudang SBY": 50, "Toko A": 25 },
                    },
                ]);

            const result = await StockTotalService.list({ page: 1, take: 10 });

            expect(result.len).toBe(3);
            expect(result.data).toHaveLength(1);
            expect(result.data[0]?.total_stock).toBe(75);
            expect(result.data[0]?.location_stocks).toEqual({ "Gudang SBY": 50, "Toko A": 25 });
        });

        it("should return empty data when no products", async () => {
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 0n }])
                .mockResolvedValueOnce([]);

            const result = await StockTotalService.list({});

            expect(result.len).toBe(0);
            expect(result.data).toHaveLength(0);
        });

        it("should handle null location_stocks gracefully", async () => {
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 1n }])
                .mockResolvedValueOnce([
                    {
                        code:            "SHOES-001",
                        name:            "Sepatu",
                        type:            "Footwear",
                        size:            42,
                        gender:          "MEN",
                        uom:             "pasang",
                        total_stock:     "0",
                        location_stocks: null,
                    },
                ]);

            const result = await StockTotalService.list({});

            expect(result.data[0]?.location_stocks).toEqual({});
            expect(result.data[0]?.total_stock).toBe(0);
        });

        it("should call $queryRaw twice (count + data)", async () => {
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 0n }])
                .mockResolvedValueOnce([]);

            await StockTotalService.list({ search: "shirt", type_id: 1 });

            expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
        });
    });

    // ── listLocations ────────────────────────────────────────────────────────

    describe("listLocations", () => {
        it("should return combined warehouses and outlets", async () => {
            // @ts-ignore
            prisma.warehouse.findMany.mockResolvedValueOnce([
                { id: 1, name: "Gudang SBY" },
                { id: 2, name: "Gudang JKT" },
            ]);
            // @ts-ignore
            prisma.outlet.findMany.mockResolvedValueOnce([
                { id: 1, name: "Toko Utama" },
            ]);

            const result = await StockTotalService.listLocations();

            expect(result).toHaveLength(3);
            expect(result.filter((l) => l.type === "WAREHOUSE")).toHaveLength(2);
            expect(result.filter((l) => l.type === "OUTLET")).toHaveLength(1);
            expect(result[0]!.type).toBe("WAREHOUSE");
            expect(result[2]!.type).toBe("OUTLET");
        });

        it("should return empty array when no locations exist", async () => {
            // @ts-ignore
            prisma.warehouse.findMany.mockResolvedValueOnce([]);
            // @ts-ignore
            prisma.outlet.findMany.mockResolvedValueOnce([]);

            const result = await StockTotalService.listLocations();

            expect(result).toHaveLength(0);
        });
    });
});
