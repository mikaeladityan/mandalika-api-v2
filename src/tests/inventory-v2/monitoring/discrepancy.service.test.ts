import { describe, it, expect, vi, beforeEach } from "vitest";
import { DiscrepancyService } from "../../../module/application/inventory-v2/monitoring/discrepancy/discrepancy.service.js";
import prisma from "../../../config/prisma.js";

const mockTransferItem = {
    id: 1,
    product_id: 10,
    quantity_requested: 50,
    quantity_packed: 50,
    quantity_received: 45,
    quantity_fulfilled: 40,
    quantity_missing: 5,
    quantity_rejected: 5,
    notes: "Rusak di perjalanan",
    product: {
        id: 10,
        code: "TSHIRT-001",
        name: "T-Shirt Basic",
        product_type: { name: "Apparel" },
        size: { size: 40 },
        unit: { name: "pcs" },
    },
    transfer: {
        id: 1,
        transfer_number: "DO-202604-001",
        created_at: new Date("2026-04-01T08:00:00Z"),
        status: "COMPLETED",
        from_warehouse: { name: "GFG-SBY" },
        to_warehouse: null,
        to_outlet: { name: "Toko Utama" },
    },
};

describe("DiscrepancyService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ── list ─────────────────────────────────────────────────────────────────

    describe("list", () => {
        it("should return paginated data and len", async () => {
            (prisma.stockTransferItem.findMany as any).mockResolvedValueOnce([mockTransferItem]);
            (prisma.stockTransferItem.count as any).mockResolvedValueOnce(1);

            const result = await DiscrepancyService.list({ page: 1, take: 25 });

            expect(result.len).toBe(1);
            expect(result.data).toHaveLength(1);
            expect(result.data[0]).toEqual(mockTransferItem);
        });

        it("should return empty array and len=0 when no discrepancies", async () => {
            (prisma.stockTransferItem.findMany as any).mockResolvedValueOnce([]);
            (prisma.stockTransferItem.count as any).mockResolvedValueOnce(0);

            const result = await DiscrepancyService.list({ page: 1, take: 25 });

            expect(result.len).toBe(0);
            expect(result.data).toHaveLength(0);
        });

        it("should call findMany with correct where conditions (missing OR rejected > 0)", async () => {
            (prisma.stockTransferItem.findMany as any).mockResolvedValueOnce([]);
            (prisma.stockTransferItem.count as any).mockResolvedValueOnce(0);

            await DiscrepancyService.list({ page: 1, take: 10 });

            const callArgs = (prisma.stockTransferItem.findMany as any).mock.calls[0][0];
            expect(callArgs.where.AND).toBeDefined();
            expect(callArgs.where.AND).toBeInstanceOf(Array);
            expect(callArgs.skip).toBe(0);
            expect(callArgs.take).toBe(10);
        });

        it("should apply search filter when provided", async () => {
            (prisma.stockTransferItem.findMany as any).mockResolvedValueOnce([]);
            (prisma.stockTransferItem.count as any).mockResolvedValueOnce(0);

            await DiscrepancyService.list({ page: 1, take: 25, search: "DO-2026" });

            const callArgs = (prisma.stockTransferItem.findMany as any).mock.calls[0][0];
            // Should have 3 AND conditions: missing/rejected OR, transfer status, search
            expect(callArgs.where.AND).toHaveLength(3);
        });

        it("should not add search condition when search is empty", async () => {
            (prisma.stockTransferItem.findMany as any).mockResolvedValueOnce([]);
            (prisma.stockTransferItem.count as any).mockResolvedValueOnce(0);

            await DiscrepancyService.list({ page: 1, take: 25 });

            const callArgs = (prisma.stockTransferItem.findMany as any).mock.calls[0][0];
            // Should have only 2 AND conditions: missing/rejected OR, transfer status
            expect(callArgs.where.AND).toHaveLength(2);
        });

        it("should paginate correctly with page 2", async () => {
            (prisma.stockTransferItem.findMany as any).mockResolvedValueOnce([]);
            (prisma.stockTransferItem.count as any).mockResolvedValueOnce(30);

            await DiscrepancyService.list({ page: 2, take: 25 });

            const callArgs = (prisma.stockTransferItem.findMany as any).mock.calls[0][0];
            expect(callArgs.skip).toBe(25);
            expect(callArgs.take).toBe(25);
        });
    });

    // ── export ────────────────────────────────────────────────────────────────

    describe("export", () => {
        it("should delegate to list with max rows and page 1", async () => {
            (prisma.stockTransferItem.findMany as any).mockResolvedValueOnce([mockTransferItem]);
            (prisma.stockTransferItem.count as any).mockResolvedValueOnce(1);

            const result = await DiscrepancyService.export({ search: "DO" });

            expect(result).toHaveLength(1);
            // Verify it called list with take=EXPORT_ROW_LIMIT (5000) and page=1
            const callArgs = (prisma.stockTransferItem.findMany as any).mock.calls[0][0];
            expect(callArgs.take).toBe(5000);
            expect(callArgs.skip).toBe(0);
        });

        it("should return empty array when no data", async () => {
            (prisma.stockTransferItem.findMany as any).mockResolvedValueOnce([]);
            (prisma.stockTransferItem.count as any).mockResolvedValueOnce(0);

            const result = await DiscrepancyService.export({});

            expect(result).toHaveLength(0);
        });
    });
});
