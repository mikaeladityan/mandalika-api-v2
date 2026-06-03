import { describe, it, expect } from "vitest";
import { productToRow } from "../../module/application/product/sheet/product-sheet.mapper.js";
import { PRODUCT_IMPORT_HEADERS } from "../../module/application/product/import/import.schema.js";

describe("productToRow", () => {
    const baseProduct = {
        id: 1,
        code: "EDP-AZUR-100",
        name: "AZURE",
        gender: "UNISEX" as const,
        distribution_percentage: 50,
        safety_percentage: 25,
        product_type: { name: "EDP" },
        unit: { name: "pcs" },
        size: { size: 100 },
    };

    it("returns 8 cells in PRODUCT_IMPORT_HEADERS order", () => {
        const row = productToRow(baseProduct as never);
        expect(row).toEqual(["EDP-AZUR-100", "AZURE", "EDP", "UNISEX", "100", "pcs", "50", "25"]);
        expect(row).toHaveLength(8);
    });

    it("substitutes empty strings for null relations", () => {
        const row = productToRow({
            ...baseProduct,
            product_type: null,
            unit: null,
            size: null,
        } as never);
        expect(row[2]).toBe("");
        expect(row[4]).toBe("");
        expect(row[5]).toBe("");
    });

    it("defaults gender to UNISEX when null", () => {
        const row = productToRow({ ...baseProduct, gender: null } as never);
        expect(row[3]).toBe("UNISEX");
    });

    it("defaults distribution and safety to 0 when null", () => {
        const row = productToRow({
            ...baseProduct,
            distribution_percentage: null,
            safety_percentage: null,
        } as never);
        expect(row[6]).toBe("0");
        expect(row[7]).toBe("0");
    });

    it("preserves PRODUCT_IMPORT_HEADERS canonical column order", () => {
        const expected = [
            "PRODUCT CODE",
            "PRODUCT NAME",
            "TYPE",
            "GENDER",
            "SIZE",
            "UOM",
            "EDAR",
            "SAFETY",
        ];
        expect(Object.values(PRODUCT_IMPORT_HEADERS)).toEqual(expected);
    });
});
