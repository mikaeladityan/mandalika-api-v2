import { describe, it, expect, vi, beforeEach } from "vitest";
import { StockDistributionRMService } from "../../../../module/application/inventory/monitoring/stock-distribution/rm/rm.service.js";
import prisma from "../../../../config/prisma.js";

const RM_SAMPLE = {
    id: 1,
    name: "Kain Katun",
    min_stock: "5.00",
    type: "FO",
    updated_at: new Date(),
    unit_raw_material: { name: "meter" },
    raw_mat_category: { name: "Fabric" },
};

describe("StockDistributionRMService", () => {
    beforeEach(() => vi.clearAllMocks());

    describe("list", () => {
        it("returns empty data when no raw materials match", async () => {
            // @ts-ignore
            prisma.rawMaterial.count.mockResolvedValue(0);
            // @ts-ignore
            prisma.rawMaterial.findMany.mockResolvedValue([]);

            const result = await StockDistributionRMService.list({});

            expect(result.len).toBe(0);
            expect(result.data).toEqual([]);
        });

        it("assembles matrix from RM warehouse inventory only", async () => {
            // @ts-ignore
            prisma.rawMaterial.count.mockResolvedValue(1);
            // @ts-ignore
            prisma.rawMaterial.findMany.mockResolvedValue([RM_SAMPLE]);
            // @ts-ignore
            prisma.rawMaterialInventory.findMany.mockResolvedValue([
                { raw_material_id: 1, quantity: "120", warehouse: { name: "Gudang RM A" } },
                { raw_material_id: 1, quantity: "30",  warehouse: { name: "Gudang RM B" } },
            ]);

            const result = await StockDistributionRMService.list({});

            expect(result.len).toBe(1);
            expect(result.data[0]).toMatchObject({
                name: "Kain Katun",
                category: "Fabric",
                unit: "meter",
                material_type: "FO",
                min_stock: 5,
                total_stock: 150,
                location_stocks: { "Gudang RM A": 120, "Gudang RM B": 30 },
            });
        });

        it("filters where by search/category_id/material_type", async () => {
            // @ts-ignore
            prisma.rawMaterial.count.mockResolvedValue(0);
            // @ts-ignore
            prisma.rawMaterial.findMany.mockResolvedValue([]);

            await StockDistributionRMService.list({ search: "kain", category_id: 1, material_type: "FO" });

            // @ts-ignore
            const args = prisma.rawMaterial.findMany.mock.calls[0][0];
            expect(args.where).toMatchObject({
                deleted_at: null,
                raw_mat_categories_id: 1,
                type: "FO",
                OR: expect.any(Array),
            });
        });

        it("scopes inventory join to RAW_MATERIAL warehouses only", async () => {
            // @ts-ignore
            prisma.rawMaterial.count.mockResolvedValue(1);
            // @ts-ignore
            prisma.rawMaterial.findMany.mockResolvedValue([RM_SAMPLE]);
            // @ts-ignore
            prisma.rawMaterialInventory.findMany.mockResolvedValue([]);

            await StockDistributionRMService.list({});

            // @ts-ignore
            const args = prisma.rawMaterialInventory.findMany.mock.calls[0][0];
            expect(args.where.warehouse).toMatchObject({ type: "RAW_MATERIAL", deleted_at: null });
        });
    });

    describe("list sorted by total_stock", () => {
        it("ranks raw materials by total_stock across all matching ids", async () => {
            (prisma.rawMaterial.findMany as any)
                .mockResolvedValueOnce([{ id: 1 }, { id: 2 }, { id: 3 }])
                .mockResolvedValueOnce([
                    { ...RM_SAMPLE, id: 2, name: "B" },
                    { ...RM_SAMPLE, id: 3, name: "C" },
                    { ...RM_SAMPLE, id: 1, name: "A" },
                ]);
            // @ts-ignore
            prisma.rawMaterialInventory.groupBy.mockResolvedValue([
                { raw_material_id: 1, _sum: { quantity: "10" } },
                { raw_material_id: 2, _sum: { quantity: "50" } },
                { raw_material_id: 3, _sum: { quantity: "20" } },
            ]);
            // assembleMatrix needs findMany returning page-specific rows
            // @ts-ignore
            prisma.rawMaterialInventory.findMany.mockResolvedValue([]);

            const result = await StockDistributionRMService.list({ sortBy: "total_stock", sortOrder: "desc" });

            expect(result.len).toBe(3);
            // Expected order (desc): id 2 (50), id 3 (20), id 1 (10)
            expect(result.data.map((r) => r.name)).toEqual(["B", "C", "A"]);
        });

        it("returns empty data when no matching raw materials", async () => {
            (prisma.rawMaterial.findMany as any).mockResolvedValueOnce([]);

            const result = await StockDistributionRMService.list({ sortBy: "total_stock" });

            expect(result).toEqual({ data: [], len: 0 });
        });
    });

    describe("listLocations", () => {
        it("returns only RM warehouses", async () => {
            // @ts-ignore
            prisma.warehouse.findMany.mockResolvedValue([{ id: 3, name: "Gudang RM A" }]);

            const result = await StockDistributionRMService.listLocations();

            expect(result).toEqual([{ id: 3, name: "Gudang RM A", type: "WAREHOUSE" }]);

            // @ts-ignore
            const callArgs = prisma.warehouse.findMany.mock.calls[0][0];
            expect(callArgs.where).toMatchObject({ type: "RAW_MATERIAL", deleted_at: null });
        });
    });
});
