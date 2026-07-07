import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../config/prisma.js", () => ({
    default: {
        product: { findMany: vi.fn(), count: vi.fn() },
        forecastPercentage: { findMany: vi.fn() },
        $queryRaw: vi.fn(),
        $transaction: vi.fn(),
    },
}));

import prisma from "../../config/prisma.js";
import { ForecastService } from "../../module/application/forecast/forecast.service.js";

describe("ForecastService.compare", () => {
    beforeEach(() => vi.clearAllMocks());

    it("menghitung delta EDAR vs ACUAN tanpa write DB", async () => {
        (prisma.forecastPercentage.findMany as any).mockResolvedValue([
            { id: 1, month: 1, year: 2026, value: "0.10" },
        ]);
        (prisma.product.findMany as any).mockResolvedValue([
            {
                id: 1,
                code: "P001",
                name: "AROMA X EDP 110ML",
                product_type: { slug: "edp" },
                size: { size: 110 },
                distribution_percentage: "0",
                reference_distribution_percentage: "0.6",
                safety_percentage: "0",
            },
        ]);
        // loadBaseSalesInput
        (prisma.$queryRaw as any).mockResolvedValue([{ product_id: 1, total_quantity: 300 }]);

        const result = await ForecastService.compare({ start_month: 1, start_year: 2026, horizon: 1 });

        expect(result.data).toHaveLength(1);
        const row = result.data[0]!;
        // input = 300/3 = 100 → atomFinal = 110
        expect(row.monthly[0]!.final_edar).toBe(0);
        expect(row.monthly[0]!.final_acuan).toBeCloseTo(66, 5);
        expect(row.monthly[0]!.delta).toBeCloseTo(66, 5);
        expect(row.monthly[0]!.delta_pct).toBeNull(); // final_edar = 0
        expect(row.total_acuan).toBeCloseTo(66, 5);
        // pct dalam persen (fraction DB ×100) untuk display
        expect(row.edar_pct).toBe(0);
        expect(row.acuan_pct).toBeCloseTo(60, 5);
        // read-only: tidak ada transaksi/write
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("404 kalau percentage periode belum diatur", async () => {
        (prisma.forecastPercentage.findMany as any).mockResolvedValue([]);
        await expect(
            ForecastService.compare({ start_month: 1, start_year: 2026, horizon: 1 }),
        ).rejects.toMatchObject({ statusCode: 404 });
    });
});
