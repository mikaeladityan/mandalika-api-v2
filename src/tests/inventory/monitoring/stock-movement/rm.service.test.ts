import { describe, it, expect, vi, beforeEach } from "vitest";
import { StockMovementRMService } from "../../../../module/application/inventory/monitoring/stock-movement/rm/rm.service.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import prisma from "../../../../config/prisma.js";

const ROW_SAMPLE = {
    id:                1,
    entity_id:         12,
    barcode:           "BC-001",
    rm_name:           "Cotton 30s",
    category:          "Fabric",
    unit:              "Meter",
    material_type:     "FO",
    location_id:       3,
    location_name:     "Gudang RM SBY",
    movement_type:     "IN",
    quantity:          "100",
    qty_before:        "200",
    qty_after:         "300",
    reference_id:      55,
    reference_type:    "GOODS_RECEIPT",
    reference_code:    "PR-2026-001",
    reference_subtype: "GR",
    destination_name:  "Supplier ABC",
    created_by:        "system",
    created_at:        new Date("2026-05-20T08:00:00Z"),
};

describe("StockMovementRMService", () => {
    beforeEach(() => vi.clearAllMocks());

    describe("list", () => {
        it("returns paginated rows with len and DTO mapping", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValueOnce({ id: 3 });
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 2n }])
                .mockResolvedValueOnce([ROW_SAMPLE]);

            const result = await StockMovementRMService.list({});

            expect(result.len).toBe(2);
            expect(result.data).toHaveLength(1);
            expect(result.data[0]).toMatchObject({
                id:               1,
                entity_id:        12,
                rm_name:          "Cotton 30s",
                quantity:         100,
                qty_before:       200,
                qty_after:        300,
                reference_id:     55,
                reference_code:   "PR-2026-001",
                destination_name: "Supplier ABC",
            });
        });

        it("applies default RM warehouse when location_id not provided", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValueOnce({ id: 3 });
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 0n }])
                .mockResolvedValueOnce([]);

            await StockMovementRMService.list({});

            expect(prisma.warehouse.findFirst).toHaveBeenCalledWith({
                where:   { type: "RAW_MATERIAL", deleted_at: null },
                select:  { id: true },
                orderBy: { id: "asc" },
            });
        });

        it("skips default warehouse lookup when location_id provided", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValue(null);
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 0n }])
                .mockResolvedValueOnce([]);

            await StockMovementRMService.list({ location_id: 7 });

            expect(prisma.warehouse.findFirst).not.toHaveBeenCalled();
        });

        it("continues without location filter when no RM warehouse found", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValueOnce(null);
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 1n }])
                .mockResolvedValueOnce([ROW_SAMPLE]);

            const result = await StockMovementRMService.list({});

            expect(result.len).toBe(1);
        });

        it("returns len=0 when no data", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValueOnce({ id: 3 });
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([]);

            const result = await StockMovementRMService.list({});

            expect(result.len).toBe(0);
            expect(result.data).toEqual([]);
        });
    });

    describe("export", () => {
        it("returns rows when count below EXPORT_MAX_ROWS", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValueOnce({ id: 3 });
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 100n }])
                .mockResolvedValueOnce([ROW_SAMPLE, { ...ROW_SAMPLE, id: 2 }]);

            const data = await StockMovementRMService.export({});

            expect(data).toHaveLength(2);
            expect(data[0]!.id).toBe(1);
            expect(data[1]!.id).toBe(2);
        });

        it("throws 400 ApiError when total exceeds EXPORT_MAX_ROWS", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValueOnce({ id: 3 });
            (prisma.$queryRaw as any).mockResolvedValueOnce([{ total: 50_001n }]);

            await expect(StockMovementRMService.export({})).rejects.toBeInstanceOf(ApiError);
        });

        it("returns empty array when no data", async () => {
            (prisma.warehouse.findFirst as any).mockResolvedValueOnce({ id: 3 });
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 0n }])
                .mockResolvedValueOnce([]);

            const data = await StockMovementRMService.export({});

            expect(data).toEqual([]);
        });
    });
});
