import { describe, it, expect, vi, beforeEach } from "vitest";
import { StockLocationRMService } from "../../../../module/application/inventory/monitoring/stock-location/rm/rm.service.js";
import prisma from "../../../../config/prisma.js";

const RM_ROW = {
    name:          "Kain Katun",
    category:      "Fabric",
    unit:          "meter",
    material_type: "FO" as const,
    quantity:      "120",
    min_stock:     "20",
};

describe("StockLocationRMService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("list (warehouse explicit)", () => {
        it("returns RM stock and maps decimals to numbers", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValueOnce({ name: "Gudang RM SBY" });
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 1n }])
                .mockResolvedValueOnce([RM_ROW]);

            const result = await StockLocationRMService.list({ location_id: 3 });

            expect(result.len).toBe(1);
            expect(result.location_name).toBe("Gudang RM SBY");
            expect(result.data[0]).toMatchObject({
                name:          "Kain Katun",
                category:      "Fabric",
                unit:          "meter",
                material_type: "FO",
                quantity:      120,
                min_stock:     20,
                location_name: "Gudang RM SBY",
            });
        });

        it("throws 404 when warehouse not found or non-RM", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValueOnce(null);

            await expect(
                StockLocationRMService.list({ location_id: 999 }),
            ).rejects.toThrow("Gudang tidak ditemukan");
        });

        it("returns empty data when no raw materials match", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValueOnce({ name: "Gudang RM" });
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 0n }])
                .mockResolvedValueOnce([]);

            const result = await StockLocationRMService.list({ location_id: 3 });

            expect(result.len).toBe(0);
            expect(result.data).toHaveLength(0);
        });
    });

    describe("list (default location)", () => {
        it("defaults to first RAW_MATERIAL warehouse when location_id missing", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValueOnce({ id: 3, name: "Gudang RM Utama" });
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 1n }])
                .mockResolvedValueOnce([RM_ROW]);

            const result = await StockLocationRMService.list({});

            expect(prisma.warehouse.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ type: "RAW_MATERIAL" }),
                }),
            );
            expect(result.location_name).toBe("Gudang RM Utama");
            expect(result.len).toBe(1);
        });

        it("throws 404 when no RM warehouse exists", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValueOnce(null);

            await expect(StockLocationRMService.list({})).rejects.toThrow(
                "Tidak ada gudang RAW_MATERIAL",
            );
        });
    });

    describe("listAvailableLocations", () => {
        it("returns RM warehouses only", async () => {
            (prisma.warehouse.findMany as any).mockResolvedValueOnce([
                { id: 3, name: "Gudang RM SBY" },
                { id: 4, name: "Gudang RM JKT" },
            ]);

            const result = await StockLocationRMService.listAvailableLocations();

            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({ id: 3, name: "Gudang RM SBY", type: "WAREHOUSE" });
        });

        it("returns empty array when no RM warehouses", async () => {
            (prisma.warehouse.findMany as any).mockResolvedValueOnce([]);
            const result = await StockLocationRMService.listAvailableLocations();
            expect(result).toHaveLength(0);
        });
    });

    describe("export", () => {
        it("delegates to list with EXPORT_ROW_LIMIT and page=1", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValueOnce({ name: "Gudang RM SBY" });
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 1n }])
                .mockResolvedValueOnce([RM_ROW]);

            const result = await StockLocationRMService.export({ location_id: 3 });

            expect(result.location_name).toBe("Gudang RM SBY");
            expect(result.data).toHaveLength(1);
        });

        it("throws 400 ApiError when total exceeds EXPORT_ROW_LIMIT", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValueOnce({ name: "Gudang RM SBY" });
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 5_001n }])
                .mockResolvedValueOnce([RM_ROW]);

            await expect(
                StockLocationRMService.export({ location_id: 3 }),
            ).rejects.toMatchObject({ statusCode: 400 });
        });
    });
});
