import { describe, it, expect, vi, beforeEach } from "vitest";
import { StockDistributionFGService } from "../../../../module/application/inventory-v2/monitoring/stock-distribution/fg/fg.service.js";
import prisma from "../../../../config/prisma.js";

const PRODUCT_SAMPLE = {
    id: 1,
    code: "TSHIRT",
    name: "T-Shirt",
    gender: "UNISEX",
    updated_at: new Date(),
    product_type: { name: "Apparel" },
    unit: { name: "pcs" },
    size: { size: 40 },
};

describe("StockDistributionFGService", () => {
    beforeEach(() => vi.clearAllMocks());

    describe("list", () => {
        it("returns empty data when no products match", async () => {
            // @ts-ignore
            prisma.product.count.mockResolvedValue(0);
            // @ts-ignore
            prisma.product.findMany.mockResolvedValue([]);

            const result = await StockDistributionFGService.list({});

            expect(result.len).toBe(0);
            expect(result.data).toEqual([]);
        });

        it("assembles matrix from warehouse + outlet inventory", async () => {
            // @ts-ignore
            prisma.product.count.mockResolvedValue(1);
            // @ts-ignore
            prisma.product.findMany.mockResolvedValue([PRODUCT_SAMPLE]);
            // @ts-ignore
            prisma.productInventory.findMany.mockResolvedValue([
                { product_id: 1, quantity: "40", warehouse: { name: "Gudang SBY" } },
            ]);
            // @ts-ignore
            prisma.outletInventory.findMany.mockResolvedValue([
                { product_id: 1, quantity: "10", outlet: { name: "Toko A" } },
            ]);
            // @ts-ignore
            prisma.stockTransferItem.groupBy.mockResolvedValue([
                { product_id: 1, _sum: { quantity_missing: "2" } },
            ]);

            const result = await StockDistributionFGService.list({});

            expect(result.len).toBe(1);
            expect(result.data[0]).toMatchObject({
                code: "TSHIRT",
                name: "T-Shirt",
                type: "Apparel",
                size: 40,
                gender: "UNISEX",
                uom: "pcs",
                total_stock: 50,
                total_missing: 2,
                location_stocks: { "Gudang SBY": 40, "Toko A": 10 },
            });
        });

        it("filters product where by search/type_id/gender", async () => {
            // @ts-ignore
            prisma.product.count.mockResolvedValue(0);
            // @ts-ignore
            prisma.product.findMany.mockResolvedValue([]);

            await StockDistributionFGService.list({ search: "shoe", type_id: 2, gender: "MALE" });

            // @ts-ignore
            const callArgs = prisma.product.findMany.mock.calls[0][0];
            expect(callArgs.where).toMatchObject({
                deleted_at: null,
                type_id: 2,
                gender: "MALE",
                OR: expect.any(Array),
            });
        });

        it("uses period from query when provided", async () => {
            // @ts-ignore
            prisma.product.count.mockResolvedValue(0);
            // @ts-ignore
            prisma.product.findMany.mockResolvedValue([{ ...PRODUCT_SAMPLE, id: 7 }]);
            // @ts-ignore
            prisma.productInventory.findMany.mockResolvedValue([]);
            // @ts-ignore
            prisma.outletInventory.findMany.mockResolvedValue([]);
            // @ts-ignore
            prisma.stockTransferItem.groupBy.mockResolvedValue([]);

            await StockDistributionFGService.list({ month: 3, year: 2025 });

            // @ts-ignore
            const piCall = prisma.productInventory.findMany.mock.calls[0][0];
            expect(piCall.where).toMatchObject({ month: 3, year: 2025 });
            // @ts-ignore
            const oiCall = prisma.outletInventory.findMany.mock.calls[0][0];
            expect(oiCall.where).toMatchObject({ month: 3, year: 2025 });
        });
    });

    describe("listLocations", () => {
        it("merges FG warehouses with outlets and labels each type", async () => {
            // @ts-ignore
            prisma.warehouse.findMany.mockResolvedValue([{ id: 10, name: "Gudang SBY" }]);
            // @ts-ignore
            prisma.outlet.findMany.mockResolvedValue([{ id: 20, name: "Toko A" }]);

            const result = await StockDistributionFGService.listLocations();

            expect(result).toEqual([
                { id: 10, name: "Gudang SBY", type: "WAREHOUSE" },
                { id: 20, name: "Toko A", type: "OUTLET" },
            ]);
        });
    });

    describe("export", () => {
        it("delegates to list with EXPORT_ROW_LIMIT and page=1", async () => {
            // @ts-ignore
            prisma.product.count.mockResolvedValue(0);
            // @ts-ignore
            prisma.product.findMany.mockResolvedValue([]);

            await StockDistributionFGService.export({});

            // @ts-ignore
            const args = prisma.product.findMany.mock.calls[0][0];
            expect(args.skip).toBe(0);
            expect(args.take).toBe(5000);
        });
    });
});
