import { describe, it, expect, vi, beforeEach } from "vitest";
import { StockDiscrepancyService } from "../../../../module/application/inventory/monitoring/stock-discrepancy/stock-discrepancy.service.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import prisma from "../../../../config/prisma.js";

const ROW_SAMPLE = {
    id:                 1,
    transfer_id:        100,
    product_id:         10,
    raw_material_id:    null,
    quantity_requested: "50",
    quantity_packed:    "50",
    quantity_received:  "48",
    quantity_fulfilled: "48",
    quantity_missing:   "2",
    quantity_rejected:  "0",
    notes:              "Kurang 2 pcs saat unloading",
    product: {
        id: 10,
        code: "P-001",
        name: "T-Shirt",
        product_type: { id: 1, name: "Apparel" },
        size:         { id: 1, size: 40 },
        unit:         { id: 1, name: "pcs" },
    },
    transfer: {
        id:              100,
        transfer_number: "TRF-202605-0001",
        status:          "PARTIAL",
        created_at:      new Date("2026-05-20T08:00:00Z"),
        from_warehouse:  { id: 1, name: "Gudang SBY" },
        to_warehouse:    null,
        to_outlet:       { id: 5, name: "Toko Mandalika A" },
    },
};

describe("StockDiscrepancyService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("list", () => {
        it("returns paginated rows with DTO mapping", async () => {
            (prisma.stockTransferItem.findMany as any).mockResolvedValueOnce([ROW_SAMPLE]);
            (prisma.stockTransferItem.count as any).mockResolvedValueOnce(1);

            const result = await StockDiscrepancyService.list({});

            expect(result.len).toBe(1);
            expect(result.data).toHaveLength(1);
            expect(result.data[0]).toMatchObject({
                id:                 1,
                transfer_id:        100,
                transfer_number:    "TRF-202605-0001",
                from_location:      "Gudang SBY",
                to_location:        "Toko Mandalika A",
                product_id:         10,
                product_code:       "P-001",
                product_name:       "T-Shirt",
                quantity_requested: 50,
                quantity_missing:   2,
                quantity_rejected:  0,
                notes:              "Kurang 2 pcs saat unloading",
            });
        });

        it("applies search filter on transfer_number + product name/code", async () => {
            (prisma.stockTransferItem.findMany as any).mockResolvedValueOnce([]);
            (prisma.stockTransferItem.count as any).mockResolvedValueOnce(0);

            await StockDiscrepancyService.list({ search: "TSHIRT" });

            const args = (prisma.stockTransferItem.findMany as any).mock.calls[0][0];
            const andClause = args.where.AND;
            const searchClause = andClause[andClause.length - 1];
            expect(searchClause.OR).toEqual(expect.arrayContaining([
                { transfer: { transfer_number: { contains: "TSHIRT", mode: "insensitive" } } },
                { product:  { name:            { contains: "TSHIRT", mode: "insensitive" } } },
                { product:  { code:            { contains: "TSHIRT", mode: "insensitive" } } },
            ]));
        });

        it("filters only completed/partial/missing/rejected transfers with discrepancy", async () => {
            (prisma.stockTransferItem.findMany as any).mockResolvedValueOnce([]);
            (prisma.stockTransferItem.count as any).mockResolvedValueOnce(0);

            await StockDiscrepancyService.list({});

            const args = (prisma.stockTransferItem.findMany as any).mock.calls[0][0];
            const andClause = args.where.AND;
            const qtyCondition    = andClause[0];
            const statusCondition = andClause[1];

            expect(qtyCondition.OR).toEqual([
                { quantity_missing:  { gt: 0 } },
                { quantity_rejected: { gt: 0 } },
            ]);
            expect(statusCondition.transfer.status.in).toEqual(
                expect.arrayContaining(["COMPLETED", "PARTIAL", "MISSING", "REJECTED"]),
            );
        });

        it("maps null product/locations correctly", async () => {
            (prisma.stockTransferItem.findMany as any).mockResolvedValueOnce([{
                ...ROW_SAMPLE,
                product:  null,
                transfer: { ...ROW_SAMPLE.transfer, from_warehouse: null, to_outlet: null, to_warehouse: null },
            }]);
            (prisma.stockTransferItem.count as any).mockResolvedValueOnce(1);

            const result = await StockDiscrepancyService.list({});

            expect(result.data[0]).toMatchObject({
                product_id:    null,
                product_code:  null,
                product_name:  null,
                from_location: null,
                to_location:   null,
            });
        });

        it("handles null quantity_missing/rejected as 0", async () => {
            (prisma.stockTransferItem.findMany as any).mockResolvedValueOnce([{
                ...ROW_SAMPLE,
                quantity_missing:  null,
                quantity_rejected: null,
            }]);
            (prisma.stockTransferItem.count as any).mockResolvedValueOnce(1);

            const result = await StockDiscrepancyService.list({});

            expect(result.data[0]!.quantity_missing).toBe(0);
            expect(result.data[0]!.quantity_rejected).toBe(0);
        });

        it("returns empty when no data", async () => {
            (prisma.stockTransferItem.findMany as any).mockResolvedValueOnce([]);
            (prisma.stockTransferItem.count as any).mockResolvedValueOnce(0);

            const result = await StockDiscrepancyService.list({});

            expect(result).toEqual({ data: [], len: 0 });
        });
    });

    describe("export", () => {
        it("returns rows when count below EXPORT_MAX_ROWS", async () => {
            (prisma.stockTransferItem.count as any).mockResolvedValueOnce(100);
            (prisma.stockTransferItem.findMany as any).mockResolvedValueOnce([ROW_SAMPLE]);

            const data = await StockDiscrepancyService.export({});

            expect(data).toHaveLength(1);
            expect(data[0]!.transfer_number).toBe("TRF-202605-0001");
        });

        it("throws 400 ApiError when total exceeds EXPORT_MAX_ROWS", async () => {
            (prisma.stockTransferItem.count as any).mockResolvedValueOnce(5_001);

            await expect(StockDiscrepancyService.export({})).rejects.toBeInstanceOf(ApiError);
        });

        it("returns empty when no data", async () => {
            (prisma.stockTransferItem.count as any).mockResolvedValueOnce(0);
            (prisma.stockTransferItem.findMany as any).mockResolvedValueOnce([]);

            const data = await StockDiscrepancyService.export({});

            expect(data).toEqual([]);
        });
    });
});
