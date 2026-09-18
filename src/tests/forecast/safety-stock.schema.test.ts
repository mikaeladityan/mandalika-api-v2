import { describe, expect, it } from "vitest";
import { QuerySafetyStockSchema, QuerySafetyStockSummarySchema } from "../../module/application/forecast/safety-stock/schema.js";

describe("Safety stock query schemas", () => {
    it("applies defaults", () => {
        expect(QuerySafetyStockSchema.parse({ month: "5", year: "2026" })).toMatchObject({ service_level: 80, page: 1, take: 50 });
        expect(QuerySafetyStockSummarySchema.parse({ month: "5", year: "2026" })).toMatchObject({ service_level: 80, page: 1, take: 50 });
    });

    it.each([{ month: "0" }, { month: "13" }, { year: "1899" }, { outlet_id: "0" }, { product_id: "0" }, { service_level: "81" }, { service_level: "100" }, { take: "101" }])("rejects invalid query %#", (input) => {
        expect(() => QuerySafetyStockSchema.parse({ month: "5", year: "2026", ...input })).toThrow();
    });

    it("accepts production service-level presets", () => {
        expect(QuerySafetyStockSchema.parse({ month: "5", year: "2026", service_level: "97.5" }).service_level).toBe(97.5);
    });
});
