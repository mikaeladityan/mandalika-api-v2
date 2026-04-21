import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "../../../config/prisma.js";
import { StockCardService } from "../../../module/application/inventory-v2/monitoring/stock-card/stock-card.service.js";

vi.mock("../../../../config/prisma.js", () => ({
    default: {
        warehouse: {
            findFirst: vi.fn(),
        },
        $queryRaw: vi.fn(),
    },
}));

describe("StockCardService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const mockRow = {
        id: 1,
        entity_type: 'PRODUCT',
        entity_id: 1,
        product_code: 'P001',
        product_name: 'Product 1',
        location_type: 'WAREHOUSE',
        location_id: 3,
        location_name: 'Main WH',
        movement_type: 'IN',
        quantity: 10,
        qty_before: 0,
        qty_after: 10,
        reference_id: 100,
        reference_type: 'GOODS_RECEIPT',
        reference_code: 'GR-001',
        created_by: 'tester',
        created_at: '2026-04-21T07:00:00Z'
    };

    describe("list", () => {
        it("should return formatted stock card data", async () => {
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: BigInt(1) }]) // count query
                .mockResolvedValueOnce([mockRow]); // data query

            const result = await StockCardService.list({ 
                location_type: "WAREHOUSE", 
                location_id: 3 
            });

            expect(result.len).toBe(1);
            expect(result.data[0]?.product_code).toBe('P001');
            expect(result.data[0]?.created_at).toBeInstanceOf(Date);
        });

        it("should auto-fill location if not provided", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValueOnce({ id: 99 });
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: BigInt(0) }])
                .mockResolvedValueOnce([]);

            await StockCardService.list({});

            expect(prisma.warehouse.findFirst).toHaveBeenCalled();
        });
    });

    describe("export", () => {
        it("should return mapped rows for export", async () => {
            (prisma.$queryRaw as any).mockResolvedValueOnce([mockRow]);

            const result = await StockCardService.export({ 
                location_type: "WAREHOUSE", 
                location_id: 3 
            });

            expect(result).toHaveLength(1);
            expect(result[0]?.reference_code).toBe('GR-001');
        });
    });
});
