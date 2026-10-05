import { describe, it, expect, vi } from "vitest";

vi.mock("../../config/prisma.js", () => ({
    default: {
        product: { findMany: vi.fn(), count: vi.fn() },
        forecastPercentage: { findMany: vi.fn() },
        $queryRaw: vi.fn(),
        $transaction: vi.fn(),
    },
}));

import { Prisma } from "../../generated/prisma/client.js";
import { ForecastService, type SelectedProduct, type DistField, type ForecastBatchRow } from "../../module/application/forecast/forecast.service.js";

const pctMap = new Map([["2026-1", { id: 1, value: "0.10" }], ["2026-2", { id: 2, value: "0.10" }]]);
const months2 = [
    { month: 1, year: 2026 },
    { month: 2, year: 2026 },
];

const product = (
    id: number, slug: string, size: number, edar: number, acuan = edar,
    status: "ACTIVE" | "PENDING" = "ACTIVE", name = "GORGEOUS TUBEROSE",
): SelectedProduct => ({
    id, name, status, product_type: { slug }, size: { size },
    distribution_percentage: new Prisma.Decimal(edar),
    reference_distribution_percentage: new Prisma.Decimal(acuan),
    safety_percentage: new Prisma.Decimal(0),
});

const products = [
    product(1, "atomizer", 10, 0),
    product(2, "edp", 110, 0.6, 0.5),
    product(3, "parfume-intense", 110, 0.4, 0.5),
    product(4, "edp", 2, 0.7, 0.2),
    product(5, "parfume-intense", 2, 0.3, 0.8),
];
const inputMap = new Map([[1, 9_000], [2, 600], [3, 400], [4, 140], [5, 60]]);
const compute = (
    selectedProducts = products,
    inputs = inputMap,
    distField: DistField = "distribution_percentage",
    percentages = pctMap,
) => ForecastService.computeForecastBatch({
    products: selectedProducts, inputMap: inputs, distField,
    monthsRange: months2, pctMap: percentages, is_others: false,
});
const pick = (rows: ForecastBatchRow[], id: number, month = 1) =>
    rows.find((row) => row.product_id === id && row.month === month)!;

describe("ForecastService.computeForecastBatch", () => {
    it("uses bottle issuance, applies Growth, then distributes EDAR; Atomizer copies the grown bottle total", () => {
        const rows = compute();
        expect(pick(rows, 1).final_forecast).toBeCloseTo(1_100, 5);
        expect(pick(rows, 2).final_forecast).toBeCloseTo(660, 5);
        expect(pick(rows, 3).final_forecast).toBeCloseTo(440, 5);
        expect(pick(rows, 1).base_forecast).toBeCloseTo(1_100, 5);
        expect(pick(rows, 2).base_forecast).toBeCloseTo(1_100, 5);
        expect(pick(rows, 2).final_forecast + pick(rows, 3).final_forecast)
            .toBeCloseTo(pick(rows, 1).final_forecast, 5);
        expect(pick(rows, 1).status).toBe("ADJUSTED");
    });

    it("uses Vial issuance independently of bottle and Atomizer issuance", () => {
        const rows = compute();
        expect(pick(rows, 4).base_forecast).toBeCloseTo(220, 5);
        expect(pick(rows, 4).final_forecast).toBeCloseTo(154, 5);
        expect(pick(rows, 5).final_forecast).toBeCloseTo(66, 5);
        const changed = compute(products, new Map([...inputMap, [1, 50_000], [2, 6_000]]));
        expect(pick(changed, 4).final_forecast).toBe(pick(rows, 4).final_forecast);
        expect(pick(changed, 5).final_forecast).toBe(pick(rows, 5).final_forecast);
    });

    it("uses independent Vial issuance and reference percentages for ACUAN, without copying bottles", () => {
        const rows = compute(products, inputMap, "reference_distribution_percentage");
        expect(pick(rows, 1).final_forecast).toBeCloseTo(1_100, 5);
        expect(pick(rows, 2).final_forecast).toBeCloseTo(550, 5);
        expect(pick(rows, 3).final_forecast).toBeCloseTo(550, 5);
        expect(pick(rows, 4).final_forecast).toBeCloseTo(44, 5);
        expect(pick(rows, 5).final_forecast).toBeCloseTo(176, 5);
    });

    it.each(["distribution_percentage", "reference_distribution_percentage"] as const)(
        "chains each group's grown total separately across months (%s)", (field) => {
            const rows = compute(products, inputMap, field);
            expect(pick(rows, 1, 2).final_forecast).toBeCloseTo(1_210, 5);
            expect(pick(rows, 2, 2).base_forecast).toBeCloseTo(1_210, 5);
            expect(pick(rows, 4, 2).base_forecast).toBeCloseTo(242, 5);
            expect(pick(rows, 2, 2).final_forecast + pick(rows, 3, 2).final_forecast).toBeCloseTo(1_210, 5);
            expect(pick(rows, 4, 2).final_forecast + pick(rows, 5, 2).final_forecast).toBeCloseTo(242, 5);
            expect(pick(rows, 1, 2).status).toBe("DRAFT");
        },
    );

    it("supports negative Growth followed by positive Growth", () => {
        const rows = compute(products, inputMap, "distribution_percentage", new Map([
            ["2026-1", { id: 1, value: "-0.05" }],
            ["2026-2", { id: 2, value: "0.03" }],
        ]));
        expect(pick(rows, 1).final_forecast).toBeCloseTo(950, 5);
        expect(pick(rows, 1, 2).final_forecast).toBeCloseTo(978.5, 5);
        expect(pick(rows, 4, 2).base_forecast).toBeCloseTo(195.7, 5);
    });

    it.each([100, 110, 120])("recognizes main bottle size %s without requiring an Atomizer", (size) => {
        const rows = compute([product(2, "ext", size, 0.6), product(3, "parfum", size, 0.4)]);
        expect(pick(rows, 2).final_forecast).toBeCloseTo(660, 5);
        expect(pick(rows, 3, 2).final_forecast).toBeCloseTo(484, 5);
    });

    it.each(["parfume-intense", "perfume-intense", "parfume", "parfum", "perfume"])(
        "recognizes Parfum alias %s for both bottle and Vial issuance", (slug) => {
            const rows = compute([products[0]!, products[1]!, product(3, slug, 110, 0.4),
                products[3]!, product(5, slug, 2, 0.3)]);
            expect(pick(rows, 1).final_forecast).toBeCloseTo(1_100, 5);
            expect(pick(rows, 5).final_forecast).toBeCloseTo(66, 5);
        },
    );

    it("forecasts Vial without main bottles, and never falls back to Atomizer issuance", () => {
        const rows = compute([products[0]!, products[3]!, products[4]!]);
        expect(pick(rows, 1).final_forecast).toBe(0);
        expect(pick(rows, 4).final_forecast).toBeCloseTo(154, 5);
        const noVialIssuance = compute(products, new Map([[1, 9_000], [2, 600], [3, 400]]));
        expect(pick(noVialIssuance, 4).final_forecast).toBe(0);
        expect(pick(noVialIssuance, 5, 2).final_forecast).toBe(0);
    });

    it("does not mix issuance from different aromas or unrelated sizes", () => {
        const rows = compute([...products, product(6, "edp", 110, 1, 1, "ACTIVE", "OTHER AROMA"),
            product(7, "edp", 30, 1)], new Map([...inputMap, [6, 2_000], [7, 3_000]]));
        expect(pick(rows, 1).final_forecast).toBeCloseTo(1_100, 5);
        expect(pick(rows, 6).final_forecast).toBeCloseTo(2_200, 5);
        expect(pick(rows, 7).final_forecast).toBeCloseTo(3_300, 5);
    });

    it("keeps theoretical totals when EDAR is zero or incomplete instead of reapplying it each month", () => {
        const rows = compute([product(1, "atomizer", 10, 0), product(2, "edp", 110, 0, 0.6)]);
        expect(pick(rows, 1, 2).final_forecast).toBeCloseTo(726, 5);
        expect(pick(rows, 2, 2).final_forecast).toBe(0);
        const acuan = compute([product(2, "edp", 110, 0, 0.6)], inputMap, "reference_distribution_percentage");
        expect(pick(acuan, 2).final_forecast).toBeCloseTo(396, 5);
        expect(pick(acuan, 2, 2).final_forecast).toBeCloseTo(435.6, 5);
    });

    it.each([
        { hampersSlug: "hampers-ext", regularSlug: "ext" },
        { hampersSlug: "hampers-perfume", regularSlug: "parfume-intense" },
    ])("preserves $hampersSlug bottle mirroring without copying bottles into Vial or inflating subsequent totals", ({ hampersSlug, regularSlug }) => {
        const selected = [
            product(10, hampersSlug, 110, 0.4, 0.8, "ACTIVE", "HAMPERS GORGEOUS TUBEROSE"),
            product(11, regularSlug, 110, 0.3, 0.2),
            product(12, regularSlug, 2, 1, 1),
        ];
        const inputs = new Map([[10, 50], [11, 100], [12, 20]]);
        for (const field of ["distribution_percentage", "reference_distribution_percentage"] as const) {
            const rows = compute(selected, inputs, field);
            const expected = field === "distribution_percentage" ? 66 : 132;
            expect(pick(rows, 10).final_forecast).toBeCloseTo(expected, 5);
            expect(pick(rows, 11).final_forecast).toBeCloseTo(expected, 5);
            expect(pick(rows, 11, 2).final_forecast).toBeCloseTo(expected * 1.1, 5);
            expect(pick(rows, 12).final_forecast).toBeCloseTo(22, 5);
            expect(pick(rows, 12, 2).final_forecast).toBeCloseTo(24.2, 5);
        }
    });

    it("does not let opening stock allocation affect either group's Growth or Atomizer", () => {
        const rows = ForecastService.applyOpeningStockToForecastBatch(compute(), new Map([[1, 2_000], [2, 800], [4, 200]]));
        expect(pick(rows, 1).net_forecast).toBeCloseTo(1_100, 5);
        expect(pick(rows, 1).final_forecast).toBeCloseTo(200, 5);
        expect(pick(rows, 1, 2).net_forecast).toBeCloseTo(1_210, 5);
        expect(pick(rows, 1, 2).final_forecast).toBeCloseTo(1_210, 5);
        expect(pick(rows, 2, 2).net_forecast).toBeCloseTo(726, 5);
        expect(pick(rows, 2, 2).final_forecast).toBeCloseTo(726, 5);
        expect(pick(rows, 4, 2).net_forecast).toBeCloseTo(169.4, 5);
        expect(pick(rows, 4, 2).final_forecast).toBeCloseTo(169.4, 5);
    });

    it("retains the existing stop rule for missing or zero Growth", () => {
        expect(compute(products, inputMap, "distribution_percentage", new Map())).toEqual([]);
        const rows = compute(products, inputMap, "distribution_percentage", new Map([
            ["2026-1", { id: 1, value: "0.1" }], ["2026-2", { id: 2, value: "0" }],
        ]));
        expect(rows).toHaveLength(5);
    });
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
        // Sisa tahap Need Produce 1.446 belum cukup menutup Forecast M1 7.203.
        expect(ForecastService.calculateStockSurplus(item)).toEqual({
            surplus: 1_446,
            durability: null,
        });
    });

    it("stok besar bertahan sampai bulan terakhir yang tercakup", () => {
        expect(
            ForecastService.calculateStockSurplus({ ...item, current_stock: 25_000 }).durability,
        ).toBe("s/d Okt'26");
    });
});

describe("ForecastService.applyOpeningStockToForecastBatch", () => {
    const row = (product_id: number, month: number, gross: number) => ({
        product_id,
        month,
        year: 2026,
        base_forecast: gross,
        final_forecast: gross,
        trend: "STABLE" as const,
        forecast_percentage_id: 1,
        status: "DRAFT" as const,
    });

    it("uses the same M1 for Need Produce first, then allocates its surplus from M1 again", () => {
        const batch = [row(1, 1, 500), row(1, 2, 300), row(1, 3, 200), row(1, 4, 500)];
        const result = ForecastService.applyOpeningStockToForecastBatch(batch, new Map([[1, 1_500]]));
        expect(result.map((r) => r.final_forecast)).toEqual([0, 0, 0, 500]);
        expect(batch.map((r) => r.final_forecast)).toEqual([500, 300, 200, 500]);
        expect(ForecastService.calculateStockSurplus({ current_stock: 1_500,
            monthly_data: batch.map((r) => ({ ...r, gross_forecast: r.final_forecast })),
        })).toEqual({ surplus: 1_000, durability: "s/d Mar'26" });
    });

    it("keeps Forecast M1 separate from Need Produce when the surplus covers only part of M1", () => {
        const result = ForecastService.applyOpeningStockToForecastBatch(
            [row(1, 10, 7_522.56), row(1, 11, 7_447.33)], new Map([[1, 10_336]]));
        expect(result[0]!.final_forecast).toBeCloseTo(4_709.12, 5);
        expect(result[1]!.final_forecast).toBeCloseTo(7_447.33, 5);
    });

    it("stores gross in legacy net_forecast and allocates Stock SO chronologically", () => {
        const result = ForecastService.applyOpeningStockToForecastBatch(
            [row(1, 1, 1_000), row(1, 2, 1_400), row(1, 3, 1_200)],
            new Map([[1, 2_000]]),
        );

        expect(result.map(({ net_forecast }) => net_forecast)).toEqual([1_000, 1_400, 1_200]);
        expect(result.map(({ final_forecast }) => final_forecast)).toEqual([0, 1_400, 1_200]);
    });

    it("sorts periods and keeps each SKU stock allocation independent", () => {
        const result = ForecastService.applyOpeningStockToForecastBatch(
            [row(2, 2, 100), row(1, 2, 100), row(2, 1, 80), row(1, 1, 80)],
            new Map([[1, 100], [2, 50]]),
        );
        const operational = new Map(result.map((r) => [`${r.product_id}-${r.month}`, r.final_forecast]));

        expect(operational).toEqual(new Map([
            ["2-2", 100], ["1-2", 100], ["2-1", 80], ["1-1", 60],
        ]));
    });

    it("reallocates an edited M2 from M1 so full opening stock is not restarted", () => {
        const result = ForecastService.applyOpeningStockToForecastBatch(
            [row(1, 1, 1_000), { ...row(1, 2, 1_600), net_forecast: 1_600 }, row(1, 3, 1_200)],
            new Map([[1, 2_000]]),
        );

        expect(result.map(({ final_forecast }) => final_forecast)).toEqual([0, 1_600, 1_200]);
    });
});

describe("ForecastService.calculateSafetyStock", () => {
    it("uses the 4-month forecast average for safety stock", () => {
        expect(ForecastService.calculateSafetyStock(120, 0.25)).toEqual({
            horizon: 4,
            average: 120,
            total: 480,
            quantity: 30,
        });
    });
});
