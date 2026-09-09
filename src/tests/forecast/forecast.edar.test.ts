import { describe, expect, it } from "vitest";
import { Prisma } from "../../generated/prisma/client.js";
import { ForecastService, type SelectedProduct } from "../../module/application/forecast/forecast.service.js";

const product = (id: number, slug: string, size: number, edar: number, status: "ACTIVE" | "PENDING" = "ACTIVE"): SelectedProduct => ({
    id, name: "GORGEOUS TUBEROSE", status, product_type: { slug }, size: { size },
    distribution_percentage: new Prisma.Decimal(edar),
    reference_distribution_percentage: new Prisma.Decimal(edar), safety_percentage: new Prisma.Decimal(0),
});
const compute = (products: SelectedProduct[]) => ForecastService.computeForecastBatch({
    products,
    monthsRange: [{ month: 9, year: 2026 }, { month: 10, year: 2026 }],
    pctMap: new Map([["2026-9", { id: 1, value: "0.1" }], ["2026-10", { id: 2, value: "0.1" }]]),
    inputMap: new Map([[1, 1000], [2, 500], [3, 500]]),
    is_others: false, distField: "distribution_percentage",
});

describe("Forecast with independent EDAR pairs and discontinued FG", () => {
    it("uses Vial 70/30 independently of bottle 60/40", () => {
        const rows = compute([
            product(1, "atomizer", 10, 0), product(2, "edp", 110, 0.6), product(3, "parfum", 110, 0.4),
            product(4, "edp", 2, 0.7), product(5, "parfum", 2, 0.3),
        ]);
        expect(rows.filter((row) => row.month === 9).map((row) => row.final_forecast)).toEqual([1100, 660, 440, 770, 330]);
    });
    it("writes zero for discontinued product and allocates entire pool to its active partner", () => {
        const rows = compute([product(2, "edp", 110, 0, "PENDING"), product(3, "parfum", 110, 1)]);
        expect(rows.filter((row) => row.product_id === 2).every((row) => row.final_forecast === 0 && row.base_forecast === 0)).toBe(true);
        expect(rows.find((row) => row.product_id === 3 && row.month === 9)?.final_forecast).toBe(1100);
    });
    it("writes zero for all-discontinued group across the entire horizon", () => {
        const rows = compute([product(2, "edp", 110, 0, "PENDING"), product(3, "parfum", 110, 0, "PENDING")]);
        expect(rows).toHaveLength(4);
        expect(rows.every((row) => row.base_forecast === 0 && row.final_forecast === 0)).toBe(true);
    });
    it("does not mirror positive hampers forecast into a discontinued regular FG", () => {
        const hampers = product(4, "hampers-ext", 110, 1);
        hampers.name = "HAMPERS GORGEOUS TUBEROSE";
        const rows = compute([product(1, "atomizer", 10, 0), hampers, product(2, "edp", 110, 0, "PENDING")]);
        expect(rows.filter((row) => row.product_id === 2)).toHaveLength(2);
        expect(rows.filter((row) => row.product_id === 2).every((row) => row.final_forecast === 0)).toBe(true);
    });
});
