import { describe, it, expect, vi } from "vitest";

vi.mock("../../config/prisma.js", () => ({
    default: { product: { findMany: vi.fn(), count: vi.fn() }, forecastPercentage: { findMany: vi.fn() }, $queryRaw: vi.fn(), $transaction: vi.fn() },
}));

import { Prisma } from "../../generated/prisma/client.js";
import { ForecastService, type SelectedProduct, type ForecastBatchRow } from "../../module/application/forecast/forecast.service.js";

const pctMap = new Map([["2026-9", { id: 1, value: "0.08" }]]);
const months = [{ month: 9, year: 2026 }];

// Regression for family recognition, using independent bottle and Vial issuance.
const mk = (id: number, slug: string, size: number, dist: string): SelectedProduct => ({
    id, name: "GORGEOUS TUBEROSE", status: "ACTIVE",
    product_type: { slug }, size: { size },
    distribution_percentage: new Prisma.Decimal(dist),
    reference_distribution_percentage: new Prisma.Decimal(dist),
    safety_percentage: new Prisma.Decimal(1),
});

const run = (parfumSlug: string) =>
    ForecastService.computeForecastBatch({
        products: [
            mk(1, "atomizer", 10, "0"),
            mk(2, "edp", 110, "0.6"),
            mk(3, parfumSlug, 110, "0.4"),
            mk(5, parfumSlug, 2, "0.4"),
        ],
        monthsRange: months, pctMap,
        inputMap: new Map([[1, 6669.44], [2, 4000], [3, 2341], [5, 3445]]),
        is_others: false, distField: "distribution_percentage",
    });

const pick = (rows: ForecastBatchRow[], id: number) => rows.find((r) => r.product_id === id)!.final_forecast;

describe("Forecast family recognition regression", () => {
    it("recognized Parfum uses separate main-bottle and Vial totals", () => {
        const rows = run("parfum");
        const pool = pick(rows, 1);
        expect(pool).toBeCloseTo((4000 + 2341) * 1.08, 5);
        expect(pick(rows, 2)).toBeCloseTo(pool * 0.6, 0);
        expect(pick(rows, 3)).toBeCloseTo(pool * 0.4, 5);
        expect(pick(rows, 5)).toBeCloseTo(3445 * 1.08 * 0.4, 5);
    });

    it("slug 'perfum' (TYPO di DB, tidak ada di PARFUM_SLUGS): keluar dari pool", () => {
        const rows = run("perfum");
        const pool = pick(rows, 1);
        expect(pick(rows, 2)).toBeCloseTo(pool * 0.6, 0);   // EXT tetap benar
        expect(pick(rows, 3)).not.toBeCloseTo(pool * 0.4, 0); // PARF LEPAS dari pool
        expect(pick(rows, 3)).toBeCloseTo(2341 * 1.08, 0);    // = input x (1+pct) -> 2.528 (persis PDF)
        expect(pick(rows, 5)).toBeCloseTo(3445 * 1.08, 0);    // vial 2ml ikut lepas -> 3.721 (persis PDF)
    });

    it("konservasi pool rusak: EXT+PARF != pool walau EDAR total 100%", () => {
        const rows = run("perfum");
        const pool = pick(rows, 1);
        expect(pick(rows, 2) + pick(rows, 3)).not.toBeCloseTo(pool, 0);
    });
});
