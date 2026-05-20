import { describe, it, expect, vi, beforeEach } from "vitest";
import { StockMovementFGService } from "../../../../module/application/inventory/monitoring/stock-movement/fg/fg.service.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import prisma from "../../../../config/prisma.js";

const ROW_SAMPLE = {
    id:                1,
    entity_id:         10,
    product_code:      "P-001",
    product_name:      "T-Shirt",
    category:          "Apparel",
    size:              "M",
    gender:            "UNISEX",
    location_type:     "WAREHOUSE",
    location_id:       5,
    location_name:     "Gudang SBY",
    movement_type:     "TRANSFER_OUT",
    quantity:          "50",
    qty_before:        "100",
    qty_after:         "50",
    reference_id:      99,
    reference_type:    "STOCK_TRANSFER",
    reference_code:    "TRF-001",
    reference_subtype: "DO",
    destination_name:  "Toko A",
    created_by:        "system",
    created_at:        new Date("2026-05-20T08:00:00Z"),
};

describe("StockMovementFGService", () => {
    beforeEach(() => vi.clearAllMocks());

    describe("list", () => {
        it("returns paginated rows with len and DTO mapping", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValueOnce({ id: 5 });
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 2n }])
                .mockResolvedValueOnce([ROW_SAMPLE]);

            const result = await StockMovementFGService.list({});

            expect(result.len).toBe(2);
            expect(result.data).toHaveLength(1);
            expect(result.data[0]).toMatchObject({
                id:               1,
                entity_id:        10,
                product_code:     "P-001",
                quantity:         50,
                qty_before:       100,
                qty_after:        50,
                reference_id:     99,
                reference_code:   "TRF-001",
                destination_name: "Toko A",
            });
        });

        it("applies default FG warehouse (GFG-SBY) when location not provided", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValueOnce({ id: 5 });
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 0n }])
                .mockResolvedValueOnce([]);

            await StockMovementFGService.list({});

            expect(prisma.warehouse.findFirst).toHaveBeenCalledWith({
                where:  { code: "GFG-SBY", deleted_at: null },
                select: { id: true },
            });
        });

        it("skips default warehouse lookup when location_id provided", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValue(null);
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 0n }])
                .mockResolvedValueOnce([]);

            await StockMovementFGService.list({ location_id: 7, location_type: "WAREHOUSE" });

            expect(prisma.warehouse.findFirst).not.toHaveBeenCalled();
        });

        it("continues without location filter when default warehouse not found", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValueOnce(null);
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 1n }])
                .mockResolvedValueOnce([ROW_SAMPLE]);

            const result = await StockMovementFGService.list({});

            expect(result.len).toBe(1);
        });

        it("returns len=0 when no data", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValueOnce({ id: 5 });
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([]);

            const result = await StockMovementFGService.list({});

            expect(result.len).toBe(0);
            expect(result.data).toEqual([]);
        });
    });

    describe("export", () => {
        it("returns rows when count below EXPORT_MAX_ROWS", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValueOnce({ id: 5 });
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 100n }])
                .mockResolvedValueOnce([ROW_SAMPLE, { ...ROW_SAMPLE, id: 2 }]);

            const data = await StockMovementFGService.export({});

            expect(data).toHaveLength(2);
            expect(data[0]!.id).toBe(1);
            expect(data[1]!.id).toBe(2);
        });

        it("throws 400 ApiError when total exceeds EXPORT_MAX_ROWS", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValueOnce({ id: 5 });
            (prisma.$queryRaw as any).mockResolvedValueOnce([{ total: 50_001n }]);

            await expect(StockMovementFGService.export({})).rejects.toBeInstanceOf(ApiError);
        });

        it("returns empty array when no data", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValueOnce({ id: 5 });
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 0n }])
                .mockResolvedValueOnce([]);

            const data = await StockMovementFGService.export({});

            expect(data).toEqual([]);
        });
    });
});
