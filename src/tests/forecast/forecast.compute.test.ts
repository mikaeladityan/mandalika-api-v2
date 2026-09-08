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

    it.each([
        { hampersSlug: "hampers-ext", regularSlug: "ext" },
        { hampersSlug: "hampers-perfume", regularSlug: "parfume-intense" },
    ])("canonical $hampersSlug mirror mengikuti distField yang dipilih", ({ hampersSlug, regularSlug }) => {
        const products: any[] = [
            {
                id: 10,
                name: "HAMPERS AROMA Y 110ML",
                product_type: { slug: hampersSlug },
                size: { size: 110 },
                distribution_percentage: "0.4",
                reference_distribution_percentage: "0.8",
                safety_percentage: "0",
            },
            {
                id: 11,
                name: "AROMA Y 110ML",
                product_type: { slug: regularSlug },
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

    it.each(["parfume-intense", "perfume-intense", "parfume"])(
        "slug Parfum baru '%s' masuk pool Atomizer dan vial menyalin induknya",
        (parfumSlug) => {
        // Data produksi memakai slug "edp", bukan "ext".
        const products: any[] = [
            {
                id: 1,
                name: "GORGEOUS TUBEROSE",
                product_type: { slug: "atomizer" },
                size: { size: 10 },
                distribution_percentage: "0",
                reference_distribution_percentage: "0",
                safety_percentage: "1.25",
            },
            {
                id: 2,
                name: "GORGEOUS TUBEROSE",
                product_type: { slug: "edp" },
                size: { size: 110 },
                distribution_percentage: "0.6",
                reference_distribution_percentage: "0.6",
                safety_percentage: "1",
            },
            {
                id: 3,
                name: "GORGEOUS TUBEROSE",
                product_type: { slug: parfumSlug },
                size: { size: 110 },
                distribution_percentage: "0.4",
                reference_distribution_percentage: "0.4",
                safety_percentage: "1",
            },
            {
                id: 4,
                name: "GORGEOUS TUBEROSE",
                product_type: { slug: "edp" },
                size: { size: 2 },
                distribution_percentage: "0.6",
                reference_distribution_percentage: "0.6",
                safety_percentage: "1.25",
            },
            {
                id: 5,
                name: "GORGEOUS TUBEROSE",
                product_type: { slug: parfumSlug },
                size: { size: 2 },
                distribution_percentage: "0.4",
                reference_distribution_percentage: "0.4",
                safety_percentage: "1.25",
            },
        ];
        const rows = ForecastService.computeForecastBatch({
            products,
            monthsRange: [months2[0]!],
            pctMap,
            inputMap: new Map([
                [1, 1_000],
                [2, 400],
                [3, 300],
                [4, 200],
                [5, 100],
            ]),
            is_others: false,
            distField: "distribution_percentage",
        });

        const pick = (id: number) => rows.find((row) => row.product_id === id)!;
        // Pool Atomizer = 1.000 × 1,10 = 1.100
        expect(pick(1).final_forecast).toBeCloseTo(1_100, 5);
        expect(pick(2).final_forecast).toBeCloseTo(660, 5); // 1.100 × 60%
        expect(pick(3).final_forecast).toBeCloseTo(440, 5); // 1.100 × 40%
        // EXT + Parfum harus tepat sama dengan pool Atomizer.
        expect(pick(2).final_forecast + pick(3).final_forecast).toBeCloseTo(1_100, 5);
        // Vial 2ml menyalin penuh nilai induk 110ml.
        expect(pick(4).final_forecast).toBeCloseTo(660, 5);
        expect(pick(5).final_forecast).toBeCloseTo(440, 5);
        },
    );
});

describe("ForecastService.calculateStockSurplus", () => {
    const item = {
        current_stock: 8_649,
        monthly_data: [
            { month: 9, year: 2026, gross_forecast: 7_203 },
            { month: 10, year: 2026, gross_forecast: 7_419 },
        ],
    };

    it("menghitung sisa stok dan daya tahannya saat tidak perlu produksi", () => {
        // 8.649 - 7.203 = 1.446, dan stok hanya cukup sampai September.
        expect(ForecastService.calculateStockSurplus(item)).toEqual({
            surplus: 1_446,
            durability: "s/d Sep'26",
        });
    });

    it("stok besar bertahan sampai bulan terakhir yang tercakup", () => {
        expect(
            ForecastService.calculateStockSurplus({ ...item, current_stock: 20_000 }).durability,
        ).toBe("s/d Okt'26");
    });
});

describe("ForecastService.calculateNeedProduce", () => {
    it("hanya Need Produce yang dikurangi stok, forecast tetap pure", () => {
        // Stok menutup seluruh forecast M1 -> Need Produce 0, tetapi FC tetap 7203.
        expect(ForecastService.calculateNeedProduce(7203, 8649)).toBe(0);
        // Stok sebagian -> sisa kebutuhan produksi.
        expect(ForecastService.calculateNeedProduce(7203, 2249)).toBe(4954);
        // Tanpa stok -> sama persis dengan gross forecast.
        expect(ForecastService.calculateNeedProduce(7203, 0)).toBe(7203);
    });
});

describe("ForecastService.applyOpeningStockToForecastBatch", () => {
    const row = (product_id: number, month: number, final_forecast: number): any => ({
        product_id,
        month,
        year: 2026,
        base_forecast: final_forecast,
        final_forecast,
        trend: "STABLE",
        forecast_percentage_id: month,
        status: "DRAFT",
    });

    it("carries opening stock forward chronologically without changing gross values", () => {
        const gross = [row(1, 1, 500), row(1, 2, 300), row(1, 3, 300)];
        const result = ForecastService.applyOpeningStockToForecastBatch(gross, new Map([[1, 1000]]));

        expect(result.map((item) => item.net_forecast)).toEqual([0, 0, 100]);
        expect(result.map((item) => item.final_forecast)).toEqual([500, 300, 300]);
        expect(gross.every((item) => item.net_forecast === undefined)).toBe(true);
    });

    it("handles partial, absent, and negative stock or demand", () => {
        const result = ForecastService.applyOpeningStockToForecastBatch(
            [row(1, 1, 500), row(2, 1, 300), row(3, 1, -20)],
            new Map([[1, 200], [2, -10], [3, 10]]),
        );
        expect(result.map((item) => item.net_forecast)).toEqual([300, 300, 0]);
    });

    it("allocates independently per SKU even when input is unsorted", () => {
        const result = ForecastService.applyOpeningStockToForecastBatch(
            [row(1, 3, 300), row(2, 2, 80), row(1, 1, 500), row(2, 1, 60), row(1, 2, 300)],
            new Map([[1, 1000], [2, 100]]),
        );
        expect(result.map((item) => item.net_forecast)).toEqual([100, 40, 0, 0, 0]);
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
