import { describe, expect, it } from "vitest";
import { calculateSafetyStock } from "../../module/application/forecast/safety-stock/calculation.js";

describe("Safety stock calculation", () => {
    it("uses sample deviation and rounds stock up", () => {
        const result = calculateSafetyStock([11, 9, 15, 10], 80);
        expect(result).toMatchObject({ total_sales: 45, weekly_average: 11.25, safety_stock: 3 });
        expect(result.standard_deviation).toBeCloseTo(Math.sqrt(20.75 / 3));
        expect(result.buffer_weeks).toBeCloseTo(3 / 11.25);
    });

    it("handles zero and non-positive averages", () => {
        expect(calculateSafetyStock([2, 2, 2, 2], 80).safety_stock).toBe(0);
        expect(calculateSafetyStock([0, 0, 0, 0], 80).buffer_weeks).toBeNull();
        expect(calculateSafetyStock([-4, 0, 0, 0], 80).buffer_weeks).toBeNull();
    });
});
