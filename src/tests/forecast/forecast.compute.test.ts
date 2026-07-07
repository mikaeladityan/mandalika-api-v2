import { describe, it, expect, vi } from "vitest";

vi.mock("../../config/prisma.js", () => ({
    default: {
        product: { findMany: vi.fn(), count: vi.fn() },
        forecastPercentage: { findMany: vi.fn() },
        $queryRaw: vi.fn(),
        $transaction: vi.fn(),
    },
}));

import { ForecastService } from "../../module/application/forecast/forecast.service.js";

const pctMap = new Map([["2026-1", { id: 1, value: "0.10" }], ["2026-2", { id: 2, value: "0.10" }]]);
const months2 = [
    { month: 1, year: 2026 },
    { month: 2, year: 2026 },
];

describe("ForecastService.computeForecastBatch", () => {
    it("edar=0 tapi acuan>0 menghasilkan final_acuan > 0 (kasus divergensi)", () => {
        const products: any[] = [
            {
                id: 1,
                name: "AROMA X EDP 110ML",
                product_type: { slug: "edp" },
                size: { size: 110 },
                distribution_percentage: "0",
                reference_distribution_percentage: "0.6",
                safety_percentage: "0",
            },
        ];
        const inputMap = new Map([[1, 100]]);
        const base = { products, monthsRange: [months2[0]!], pctMap, inputMap, is_others: false };

        const edar = ForecastService.computeForecastBatch({ ...base, distField: "distribution_percentage" });
        const acuan = ForecastService.computeForecastBatch({ ...base, distField: "reference_distribution_percentage" });

        // atomBase = 100 (anchor input), atomFinal = 100 * 1.1 = 110
        expect(edar[0]!.final_forecast).toBe(0); // 110 * 0
        expect(acuan[0]!.final_forecast).toBeCloseTo(66, 5); // 110 * 0.6
    });

    it("hampers mirror mengikuti distField yang dipilih", () => {
        const products: any[] = [
            {
                id: 10,
                name: "HAMPERS AROMA Y EDP 110ML",
                product_type: { slug: "hampers-edp" },
                size: { size: 110 },
                distribution_percentage: "0.4",
                reference_distribution_percentage: "0.8",
                safety_percentage: "0",
            },
            {
                id: 11,
                name: "AROMA Y EDP 110ML",
                product_type: { slug: "edp" },
                size: { size: 110 },
                distribution_percentage: "0.3",
                reference_distribution_percentage: "0.2",
                safety_percentage: "0",
            },
        ];
        const inputMap = new Map([
            [10, 50],
            [11, 100],
        ]);
        const base = { products, monthsRange: [months2[0]!], pctMap, inputMap, is_others: false };

        const edar = ForecastService.computeForecastBatch({ ...base, distField: "distribution_percentage" });
        const acuan = ForecastService.computeForecastBatch({ ...base, distField: "reference_distribution_percentage" });

        // atomBase = 50 + 100 = 150 → atomFinal = 165
        const edarHampers = edar.find((r) => r.product_id === 10)!;
        const edarRegular = edar.find((r) => r.product_id === 11)!;
        expect(edarHampers.final_forecast).toBeCloseTo(66, 5); // 165 * 0.4
        expect(edarRegular.final_forecast).toBeCloseTo(66, 5); // mirror hampers

        const acuanHampers = acuan.find((r) => r.product_id === 10)!;
        const acuanRegular = acuan.find((r) => r.product_id === 11)!;
        expect(acuanHampers.final_forecast).toBeCloseTo(132, 5); // 165 * 0.8
        expect(acuanRegular.final_forecast).toBeCloseTo(132, 5); // mirror hampers
    });

    it("chain antar-bulan: atomBase bulan-2 = atomFinal bulan-1", () => {
        const products: any[] = [
            {
                id: 1,
                name: "AROMA Z EDP 110ML",
                product_type: { slug: "edp" },
                size: { size: 110 },
                distribution_percentage: "0.5",
                reference_distribution_percentage: "0.5",
                safety_percentage: "0",
            },
        ];
        const inputMap = new Map([[1, 100]]);
        const rows = ForecastService.computeForecastBatch({
            products,
            monthsRange: months2,
            pctMap,
            inputMap,
            is_others: false,
            distField: "distribution_percentage",
        });

        const m1 = rows.find((r) => r.month === 1)!;
        const m2 = rows.find((r) => r.month === 2)!;
        expect(m1.final_forecast).toBeCloseTo(55, 5); // 110 * 0.5
        expect(m2.final_forecast).toBeCloseTo(60.5, 5); // atomFinal m2 = 110 * 1.1 = 121 → 121 * 0.5
        expect(m1.status).toBe("ADJUSTED");
        expect(m2.status).toBe("DRAFT");
    });
});
