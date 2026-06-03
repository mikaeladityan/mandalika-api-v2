import { describe, it, expect } from "vitest";
import { productToRow } from "../../module/application/product/sheet/product-sheet.mapper.js";

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

    // Sheet column layout B–I (column A reserved for external UID):
    //   B: CODE | C: SAFETY % | D: NAME | E: TYPE | F: GENDER |
    //   G: SIZE | H: UOM | I: DISTRIBUTION %
    it("returns 8 cells matching the FG sheet column order (B–I)", () => {
        const row = productToRow(baseProduct as never);
        expect(row).toEqual(["EDP-AZUR-100", "25", "AZURE", "EDP", "UNISEX", "100", "pcs", "50"]);
        expect(row).toHaveLength(8);
    });

    it("substitutes empty strings for null relations", () => {
        const row = productToRow({
            ...baseProduct,
            product_type: null,
            unit: null,
            size: null,
        } as never);
        // Indices: 3=TYPE, 5=SIZE (was 'size'), 6=UOM (was 'unit')
        expect(row[3]).toBe("");
        expect(row[5]).toBe("");
        expect(row[6]).toBe("");
    });

    it("defaults gender to UNISEX when null", () => {
        const row = productToRow({ ...baseProduct, gender: null } as never);
        expect(row[4]).toBe("UNISEX");
    });

    it("defaults safety (index 1) and distribution (index 7) to 0 when null", () => {
        const row = productToRow({
            ...baseProduct,
            distribution_percentage: null,
            safety_percentage: null,
        } as never);
        expect(row[1]).toBe("0");
        expect(row[7]).toBe("0");
    });
});
