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
                name: "AROMA X EXT 110ML",
                product_type: { slug: "ext" },
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
                name: "HAMPERS AROMA Y EXT 110ML",
                product_type: { slug: "hampers-ext" },
                size: { size: 110 },
                distribution_percentage: "0.4",
                reference_distribution_percentage: "0.8",
                safety_percentage: "0",
            },
            {
                id: 11,
                name: "AROMA Y EXT 110ML",
                product_type: { slug: "ext" },
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
                name: "AROMA Z EXT 110ML",
                product_type: { slug: "ext" },
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

    it("membagi gross Forecast Atomizer ke EXT dan Parfum sesuai EDAR", () => {
        const atomizerPctMap = new Map([
            ["2026-1", { id: 1, value: "-0.05" }],
            ["2026-2", { id: 2, value: "0.03" }],
        ]);
        const products: any[] = [
            {
                id: 1,
                name: "GORGEOUS TUBEROSE",
                product_type: { slug: "ext" },
                size: { size: 110 },
                distribution_percentage: "0.6",
                reference_distribution_percentage: "0.6",
                safety_percentage: "1",
            },
            {
                id: 3,
                name: "GORGEOUS TUBEROSE",
                product_type: { slug: "parfum" },
                size: { size: 110 },
                distribution_percentage: "0.4",
                reference_distribution_percentage: "0.4",
                safety_percentage: "1",
            },
            {
                id: 2,
                name: "GORGEOUS TUBEROSE",
                product_type: { slug: "atomizer" },
                size: { size: 10 },
                distribution_percentage: "0",
                reference_distribution_percentage: "0",
                safety_percentage: "1.25",
            },
        ];
        const rows = ForecastService.computeForecastBatch({
            products,
            monthsRange: months2,
            pctMap: atomizerPctMap,
            inputMap: new Map([
                [1, 4_000],
                [2, 7_500],
                [3, 3_000],
            ]),
            is_others: false,
            distField: "distribution_percentage",
        });

        const atomizerM1 = rows.find((row) => row.product_id === 2 && row.month === 1)!;
        const atomizerM2 = rows.find((row) => row.product_id === 2 && row.month === 2)!;
        const extM1 = rows.find((row) => row.product_id === 1 && row.month === 1)!;
        const parfumM1 = rows.find((row) => row.product_id === 3 && row.month === 1)!;
        const extM2 = rows.find((row) => row.product_id === 1 && row.month === 2)!;
        const parfumM2 = rows.find((row) => row.product_id === 3 && row.month === 2)!;
        expect(atomizerM1.base_forecast).toBeCloseTo(7_125, 5);
        expect(atomizerM1.final_forecast).toBeCloseTo(7_125, 5);
        expect(extM1.final_forecast).toBeCloseTo(4_275, 5);
        expect(parfumM1.final_forecast).toBeCloseTo(2_850, 5);
        expect(atomizerM2.base_forecast).toBeCloseTo(7_338.75, 5);
        expect(atomizerM2.final_forecast).toBeCloseTo(7_338.75, 5);
        expect(extM2.final_forecast).toBeCloseTo(4_403.25, 5);
        expect(parfumM2.final_forecast).toBeCloseTo(2_935.5, 5);
        expect(extM1.final_forecast + parfumM1.final_forecast).toBeCloseTo(
            atomizerM1.final_forecast,
            5,
        );
    });
});

describe("ForecastService.applyOpeningStockToForecastBatch", () => {
    it("membawa sisa stok dari M1 ke bulan berikutnya", () => {
        const rows = [
            { product_id: 1, month: 1, year: 2026, base_forecast: 100, final_forecast: 100, trend: "STABLE", forecast_percentage_id: 1, status: "ADJUSTED" },
            { product_id: 1, month: 2, year: 2026, base_forecast: 100, final_forecast: 100, trend: "STABLE", forecast_percentage_id: 1, status: "DRAFT" },
            { product_id: 1, month: 3, year: 2026, base_forecast: 100, final_forecast: 100, trend: "STABLE", forecast_percentage_id: 1, status: "DRAFT" },
        ] as const;

        const result = ForecastService.applyOpeningStockToForecastBatch(
            rows.map((row) => ({ ...row })),
            new Map([[1, 250]]),
        );

        expect(result.map((row) => row.final_forecast)).toEqual([100, 100, 100]);
        expect(result.map((row) => row.net_forecast)).toEqual([0, 0, 50]);
        expect(ForecastService.calculateNeedProduce(100, 250)).toBe(0);
    });

    it("menghabiskan sisa stok sebelum menghasilkan kebutuhan bulan berikutnya", () => {
        const rows = [
            { product_id: 1, month: 2, year: 2026, base_forecast: 500, final_forecast: 500, trend: "STABLE", forecast_percentage_id: 1, status: "DRAFT" },
            { product_id: 1, month: 3, year: 2026, base_forecast: 300, final_forecast: 300, trend: "STABLE", forecast_percentage_id: 1, status: "DRAFT" },
            { product_id: 1, month: 4, year: 2026, base_forecast: 300, final_forecast: 300, trend: "STABLE", forecast_percentage_id: 1, status: "DRAFT" },
        ] as const;

        const result = ForecastService.applyOpeningStockToForecastBatch(
            rows.map((row) => ({ ...row })),
            new Map([[1, 1000]]),
        );

        expect(result.map((row) => row.net_forecast)).toEqual([0, 0, 100]);
    });

    it("membawa surplus stok Atomizer M1 ke M2", () => {
        const rows = [
            { product_id: 1, month: 9, year: 2026, base_forecast: 7203, final_forecast: 7203, trend: "DOWN", forecast_percentage_id: 1, status: "ADJUSTED" },
            { product_id: 1, month: 10, year: 2026, base_forecast: 7419.09, final_forecast: 7419.09, trend: "UP", forecast_percentage_id: 2, status: "DRAFT" },
        ] as const;

        const result = ForecastService.applyOpeningStockToForecastBatch(
            rows.map((row) => ({ ...row })),
            new Map([[1, 8649]]),
        );

        expect(result[0]!.net_forecast).toBe(0);
        expect(result[1]!.net_forecast).toBeCloseTo(5973.09, 5);
    });
});

describe("ForecastService.calculateSafetyStock", () => {
    it("uses the 3-month actual issuance average instead of forecast", () => {
        expect(ForecastService.calculateSafetyStock(120, 0.25)).toEqual({
            horizon: 3,
            average: 120,
            total: 360,
            quantity: 30,
        });
    });
});
