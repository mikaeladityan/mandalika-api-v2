import { beforeEach, describe, expect, it, vi } from "vitest";
import { BardatService } from "../../../../module/application/outlet/bardat/import/import.service.js";
import { BardatImportCacheService } from "../../../../module/application/outlet/bardat/import/import.cache.js";
import prisma from "../../../../config/prisma.js";

vi.mock("../../../../config/prisma.js", () => ({
    default: {
        product: { findMany: vi.fn() },
        outlet: { findMany: vi.fn() },
        $transaction: vi.fn(),
    },
}));

vi.mock("../../../../module/application/outlet/bardat/import/import.cache.js", () => ({
    BardatImportCacheService: { save: vi.fn(), get: vi.fn(), remove: vi.fn() },
}));

describe("BardatService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // reason: Vitest's Prisma mock retains the generated full-record return type.
        vi.mocked(prisma.product.findMany).mockResolvedValue([{ id: 1, code: "P001" } as never]);
        vi.mocked(prisma.outlet.findMany).mockResolvedValue([{ id: 2, code: "T1", name: "Toko 1" } as never]);
    });

    it("validates rows in batch and stores an outlet summary", async () => {
        const result = await BardatService.preview([
            ["BARDAT", "", "", "", "TOKO :", "T1"],
            ["", "", "", "", "TANGGAL :", "2026-04-01"],
            ["NO", "PRODUCT CODE", "PRODUCT NAME", "SIZE", "PRODUCT CATEGORY", ""],
            ["1", "P001", "Product", "M", "Category", 4],
            ["2", "MISSING", "Missing", "M", "Category", 2],
        ]);
        expect(result.total).toBe(2);
        expect(result.valid).toBe(1);
        expect(result.invalid).toBe(1);
        expect(result.summaries[0]).toMatchObject({ outlet_code: "T1", valid_rows: 1, invalid_rows: 1 });
        expect(BardatImportCacheService.save).toHaveBeenCalled();
    });

    it("aggregates repeated date columns for the same outlet and SKU", async () => {
        const result = await BardatService.preview([
            ["BARDAT", "", "", "", "TOKO :", "T1"],
            ["", "", "", "", "TANGGAL :", "2026-04-01"],
            ["NO", "PRODUCT CODE", "PRODUCT NAME", "SIZE", "PRODUCT CATEGORY", ""],
            ["1", "P001", "Product", "M", "Category", 2],
            ["2", "P001", "Product", "M", "Category", 3],
        ]);
        expect(result.valid).toBe(1);
        expect(result.invalid).toBe(0);
        const savedPayload = vi.mocked(BardatImportCacheService.save).mock.calls.at(-1)?.[1] as { rows: Array<{ quantity: number }> };
        expect(savedPayload.rows).toHaveLength(1);
        expect(savedPayload.rows[0]?.quantity).toBe(5);
    });

    it("rejects execute when preview session is missing", async () => {
        vi.mocked(BardatImportCacheService.get).mockResolvedValue(null);
        await expect(BardatService.execute("00000000-0000-4000-8000-000000000001"))
            .rejects.toThrow("Import session tidak ditemukan");
    });

    it("replaces the ledger and recomputes monthly inventory in one transaction", async () => {
        const payload = {
            status: "preview" as const,
            import_id: "00000000-0000-4000-8000-000000000001",
            total: 1, valid: 1, invalid: 0,
            periods: [{ month: 4, year: 2026 }],
            summaries: [], createdAt: Date.now(),
            rows: [{ product_code: "P001", outlet_code: "T1", date: "2026-04-01", quantity: 4, product_id: 1, outlet_id: 2, errors: [] }],
        };
        vi.mocked(BardatImportCacheService.get).mockResolvedValue(payload);
        const tx = {
            outletInventory: {
                deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
                createMany: vi.fn().mockResolvedValue({ count: 1 }),
            },
            outletGoodsReceipt: {
                deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
                createMany: vi.fn().mockResolvedValue({ count: 1 }),
                groupBy: vi.fn().mockResolvedValue([{ outlet_id: 2, product_id: 1, month: 4, year: 2026, _sum: { quantity: 4 } }]),
            },
        };
        // reason: The test supplies a minimal transaction client for the methods exercised by this service.
        vi.mocked(prisma.$transaction).mockImplementation((async (callback: (client: typeof tx) => Promise<void>) => callback(tx)) as never);
        await BardatService.execute(payload.import_id);
        expect(tx.outletGoodsReceipt.deleteMany).toHaveBeenCalledWith({ where: { OR: payload.periods } });
        expect(tx.outletGoodsReceipt.createMany).toHaveBeenCalled();
        expect(tx.outletInventory.deleteMany).toHaveBeenCalledWith({ where: { OR: payload.periods } });
        expect(tx.outletInventory.createMany).toHaveBeenCalledWith({
            data: [{ outlet_id: 2, product_id: 1, month: 4, year: 2026, quantity: 4 }],
        });
        expect(BardatImportCacheService.remove).toHaveBeenCalledWith(payload.import_id);
    });
});
