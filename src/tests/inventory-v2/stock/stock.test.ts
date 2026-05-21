import { describe, it, expect, vi, beforeEach } from "vitest";
import { StockService } from "../../../module/application/inventory-v2/stock/stock.service.js";
import { StockImportService } from "../../../module/application/inventory-v2/stock/import/import.service.js";
import prisma from "../../../config/prisma.js";
import { StockImportCacheService } from "../../../module/application/inventory-v2/stock/import/import.cache.js";

vi.mock("../../../module/application/inventory-v2/stock/import/import.cache.js", () => ({
    StockImportCacheService: {
        save: vi.fn().mockResolvedValue(true),
        get: vi.fn(),
        remove: vi.fn().mockResolvedValue(true),
    },
}));

describe("StockService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("listProductStock", () => {
        it("should return list of product stocks", async () => {
            const mockProducts = [
                {
                    code: "P001",
                    name: "Product 1",
                    type: "Apparel",
                    size: 40,
                    gender: "MEN",
                    uom: "pcs",
                    amount: "100",
                },
            ];

            // @ts-ignore
            prisma.$queryRaw.mockResolvedValueOnce([{ total: 1n }]);
            // @ts-ignore
            prisma.$queryRaw.mockResolvedValueOnce(mockProducts);

            const result = await StockService.listProductStock({
                page: 1,
                take: 10,
                month: 1,
                year: 2024,
            });

            expect(result.data).toHaveLength(1);
            expect(result.data).toBeDefined();
            expect(result.data[0]?.amount).toBe(100);
            expect(result.len).toBe(1);
        });
    });
});

describe("StockImportService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("preview", () => {
        it("should parse rows and return preview result", async () => {
            const rows = [
                { "PRODUCT CODE": "P001", "CURRENT STOCK": "100" },
                { "PRODUCT CODE": "INVALID", "CURRENT STOCK": "abc" },
            ];

            // @ts-ignore
            prisma.product.findMany.mockResolvedValue([{ id: 1, code: "P001" }]);

            const result = await StockImportService.preview(rows);

            expect(result.total).toBe(2);
            expect(result.valid).toBe(1);
            expect(result.invalid).toBe(1);
            expect(StockImportCacheService.save).toHaveBeenCalled();
        });
    });

    describe("execute", () => {
        it("should bulk insert valid rows and clear cache", async () => {
            const importId = "test-id";
            const mockCache = {
                status: "preview",
                rows: [{ code: "P001", product_id: 1, amount: 100, errors: [] }],
            };

            // @ts-ignore
            StockImportCacheService.get.mockResolvedValue(mockCache);
            // @ts-ignore
            prisma.$executeRaw.mockResolvedValue(1);

            const result = await StockImportService.execute(importId, 1, 1, 2024);

            expect(result.total).toBe(1);
            expect(prisma.$executeRaw).toHaveBeenCalled();
            expect(StockImportCacheService.remove).toHaveBeenCalledWith(importId);
        });

        it("should throw error if session not found", async () => {
            // @ts-ignore
            StockImportCacheService.get.mockResolvedValue(null);

            await expect(StockImportService.execute("invalid", 1, 1, 2024)).rejects.toThrow(
                "Import session expired or not found",
            );
        });
    });
});
