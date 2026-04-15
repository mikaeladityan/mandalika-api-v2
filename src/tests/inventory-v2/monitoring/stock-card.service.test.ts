import { describe, it, expect, vi, beforeEach } from "vitest";
import { StockCardService } from "../../../module/application/inventory-v2/monitoring/stock-card/stock-card.service.js";
import prisma from "../../../config/prisma.js";

const mockRow = {
    id:             1,
    entity_type:    "PRODUCT",
    entity_id:      10,
    product_code:   "TSHIRT-001",
    product_name:   "T-Shirt Basic",
    location_type:  "WAREHOUSE",
    location_id:    1,
    location_name:  "Gudang SBY",
    movement_type:  "IN",
    quantity:       "50",
    qty_before:     "100",
    qty_after:      "150",
    reference_id:   3,
    reference_type: "GOODS_RECEIPT",
    created_by:     "admin@test.com",
    created_at:     new Date("2026-04-01T08:00:00Z"),
};

describe("StockCardService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ── list ─────────────────────────────────────────────────────────────────

    describe("list", () => {
        it("should return paginated data and len", async () => {
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 1n }])
                .mockResolvedValueOnce([mockRow]);

            const result = await StockCardService.list({ page: 1, take: 10 });

            expect(result.len).toBe(1);
            expect(result.data).toHaveLength(1);
            expect(result.data[0]?.product_name).toBe("T-Shirt Basic");
            expect(result.data[0]?.qty_before).toBe(100);
            expect(result.data[0]?.qty_after).toBe(150);
        });

        it("should return 0 and empty array when no movements", async () => {
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 0n }])
                .mockResolvedValueOnce([]);

            const result = await StockCardService.list({});

            expect(result.len).toBe(0);
            expect(result.data).toHaveLength(0);
        });

        it("should call $queryRaw twice (count + data)", async () => {
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 0n }])
                .mockResolvedValueOnce([]);

            await StockCardService.list({ search: "shirt", date_from: "2026-01-01", date_to: "2026-01-31" });

            expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
        });

        it("should handle null product_code and product_name gracefully", async () => {
            const rowNoProduct = { ...mockRow, product_code: null, product_name: null };
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 1n }])
                .mockResolvedValueOnce([rowNoProduct]);

            const result = await StockCardService.list({});

            expect(result.data[0]?.product_code).toBeNull();
            expect(result.data[0]?.product_name).toBeNull();
        });

        it("should handle null reference_id gracefully", async () => {
            const rowNoRef = { ...mockRow, reference_id: null, reference_type: null };
            (prisma.$queryRaw as any)
                .mockResolvedValueOnce([{ total: 1n }])
                .mockResolvedValueOnce([rowNoRef]);

            const result = await StockCardService.list({});

            expect(result.data[0]?.reference_id).toBeNull();
            expect(result.data[0]?.reference_type).toBeNull();
        });
    });

    // ── export ────────────────────────────────────────────────────────────────

    describe("export", () => {
        it("should return all rows without pagination (calls $queryRaw once)", async () => {
            // @ts-ignore
            prisma.$queryRaw.mockResolvedValueOnce([mockRow, mockRow]);

            const result = await StockCardService.export({});

            expect(result).toHaveLength(2);
            expect(prisma.$queryRaw).toHaveBeenCalledTimes(1); // no count call
        });

        it("should return empty array when no data", async () => {
            // @ts-ignore
            prisma.$queryRaw.mockResolvedValueOnce([]);

            const result = await StockCardService.export({});

            expect(result).toHaveLength(0);
        });
    });
});
