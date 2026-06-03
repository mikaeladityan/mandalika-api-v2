import { describe, it, expect } from "vitest";
import {
    QueryForecastAccuracySchema,
    ResponseForecastAccuracySchema,
} from "../../module/application/forecast/accuracy/accuracy.schema.js";

describe("accuracy.schema", () => {
    describe("QueryForecastAccuracySchema", () => {
        it("coerces numeric query string values", () => {
            const parsed = QueryForecastAccuracySchema.parse({
                month: "5",
                year: "2026",
                page: "2",
                take: "50",
            });
            expect(parsed.month).toBe(5);
            expect(parsed.year).toBe(2026);
            expect(parsed.page).toBe(2);
            expect(parsed.take).toBe(50);
            expect(parsed.is_others).toBe(false);
        });

        it("treats month/year as optional (no defaults)", () => {
            const parsed = QueryForecastAccuracySchema.parse({});
            expect(parsed.month).toBeUndefined();
            expect(parsed.year).toBeUndefined();
            expect(parsed.page).toBe(1);
            expect(parsed.take).toBe(25);
        });

        it("rejects month outside 1..12", () => {
            expect(() => QueryForecastAccuracySchema.parse({ month: "0", year: "2026" })).toThrow();
            expect(() => QueryForecastAccuracySchema.parse({ month: "13", year: "2026" })).toThrow();
        });

        it("rejects take > 500", () => {
            expect(() => QueryForecastAccuracySchema.parse({ take: "501" })).toThrow();
        });
    });

    describe("ResponseForecastAccuracySchema", () => {
        it("accepts a well-formed response", () => {
            const ok = ResponseForecastAccuracySchema.parse({
                period: { month: 5, year: 2026 },
                summary: {
                    total_forecast: 100,
                    total_sales: 95,
                    accuracy_percentage: "95.00%",
                    product_count: 1,
                    excluded_count: 0,
                },
                data: [
                    {
                        product_id: 1,
                        product_code: "X",
                        product_name: "Test",
                        product_type: "EDP",
                        product_size: "100 pcs",
                        forecast: 100,
                        sales: 95,
                        diff: 5,
                        accuracy_percentage: "95.00%",
                    },
                ],
                len: 1,
            });
            expect(ok.data[0]?.accuracy_percentage).toBe("95.00%");
        });
    });
});
