import { describe, it, expect, vi } from "vitest";

vi.mock("../../config/prisma.js", () => ({
    default: { product: { findMany: vi.fn(), count: vi.fn() }, forecastPercentage: { findMany: vi.fn() }, $queryRaw: vi.fn(), $transaction: vi.fn() },
}));

import { ForecastService } from "../../module/application/forecast/forecast.service.js";

const pctMap = new Map([["2026-9", { id: 1, value: "0.08" }]]);
const months = [{ month: 9, year: 2026 }];

// Replikasi GORGEOUS TUBEROSE dari PDF (Sep'26):
//   Atomizer pool Sep = 7.203 ; EDAR: EXT 60%, PARF 40%
//   PDF: PW110E-GOR = 4.322  (= 7203 x 60%)  -> ikut pool  OK
//   PDF: PW110P-GOR = 2.528  (BUKAN 7203 x 40% = 2.881)   -> BUG
const mk = (id: number, slug: string, size: number, dist: string) => ({
    id, name: "GORGEOUS TUBEROSE",
    product_type: { slug }, size: { size },
    distribution_percentage: dist, reference_distribution_percentage: dist, safety_percentage: "1",
});

const run = (parfumSlug: string) =>
    ForecastService.computeForecastBatch({
        products: [
            mk(1, "atomizer", 10, "0"),
            mk(2, "edp", 110, "0.6"),
            mk(3, parfumSlug, 110, "0.4"),
            mk(5, parfumSlug, 2, "0.4"),
        ] as any,
        monthsRange: months, pctMap,
        inputMap: new Map([[1, 6669.44], [2, 4000], [3, 2341], [5, 3445]]),
        is_others: false, distField: "distribution_percentage",
    });

const pick = (rows: any[], id: number) => rows.find((r) => r.product_id === id)!.final_forecast;

describe("BUG: slug parfum tidak dikenali -> keluar dari pool Atomizer", () => {
    it("slug 'parfum' (dikenali): anchor & vial ikut pool", () => {
        const rows = run("parfum");
        const pool = pick(rows, 1);
        expect(pool).toBeCloseTo(7203, 0);
        expect(pick(rows, 2)).toBeCloseTo(pool * 0.6, 0);
        expect(pick(rows, 3)).toBeCloseTo(pool * 0.4, 0); // 2.881
        expect(pick(rows, 5)).toBeCloseTo(pool * 0.4, 0);
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
