import { describe, it, expect } from "vitest";
import { rawMatToRowSegments, pickPreferredSupplier } from "../../module/application/rawmat/sheet/rawmat-sheet.mapper.js";

describe("pickPreferredSupplier", () => {
    it("returns the is_preferred ACTIVE supplier first", () => {
        const result = pickPreferredSupplier([
            { id: 1, is_preferred: false, status: "ACTIVE", supplier: { name: "A" }, unit_price: 10, min_buy: null, lead_time: null } as never,
            { id: 2, is_preferred: true,  status: "ACTIVE", supplier: { name: "B" }, unit_price: 20, min_buy: null, lead_time: null } as never,
            { id: 3, is_preferred: true,  status: "BLOCK",  supplier: { name: "C" }, unit_price: 30, min_buy: null, lead_time: null } as never,
        ]);
        expect(result?.supplier.name).toBe("B");
    });

    it("falls back to lowest-id ACTIVE when no preferred", () => {
        const result = pickPreferredSupplier([
            { id: 7, is_preferred: false, status: "ACTIVE", supplier: { name: "A" }, unit_price: 10, min_buy: null, lead_time: null } as never,
            { id: 3, is_preferred: false, status: "ACTIVE", supplier: { name: "B" }, unit_price: 20, min_buy: null, lead_time: null } as never,
            { id: 5, is_preferred: false, status: "BLOCK",  supplier: { name: "C" }, unit_price: 30, min_buy: null, lead_time: null } as never,
        ]);
        expect(result?.supplier.name).toBe("B");
    });

    it("returns undefined when no ACTIVE supplier", () => {
        const result = pickPreferredSupplier([
            { id: 1, is_preferred: true, status: "BLOCK", supplier: { name: "X" }, unit_price: 10, min_buy: null, lead_time: null } as never,
        ]);
        expect(result).toBeUndefined();
    });

    it("returns undefined for empty list", () => {
        expect(pickPreferredSupplier([])).toBeUndefined();
    });
});

describe("rawMatToRowSegments", () => {
    const baseRm = {
        id: 1,
        barcode: "RM-001",
        name: "GLYCERIN USP",
        min_stock: 25,
        source: "LOCAL" as const,
        raw_mat_category: { name: "BASE" },
        unit_raw_material: { name: "KG" },
        supplier_materials: [
            { id: 1, is_preferred: true, status: "ACTIVE", supplier: { name: "PT MAJU" }, unit_price: 12500, min_buy: 50, lead_time: 7 },
        ],
    };

    it("returns B-F and I-M segments with all fields populated", () => {
        const { left, right } = rawMatToRowSegments(baseRm as never);
        expect(left).toEqual([
            "RM-001",       // B BARCODE
            "BASE",         // C CATEGORY
            "GLYCERIN USP", // D NAME
            "KG",           // E UOM
            "PT MAJU",      // F SUPPLIER
        ]);
        expect(right).toEqual([
            "12500",  // I PRICE
            "50",     // J MOQ
            "7",      // K LEAD TIME
            "25",     // L MIN STOCK
            "LOCAL",  // M LOCAL/IMPORT
        ]);
    });

    it("substitutes empty strings for null category and source", () => {
        const { left, right } = rawMatToRowSegments({ ...baseRm, raw_mat_category: null, source: null } as never);
        expect(left[1]).toBe("");  // C
        expect(right[4]).toBe(""); // M
    });

    it("substitutes '0' for null min_stock", () => {
        const { right } = rawMatToRowSegments({ ...baseRm, min_stock: null } as never);
        expect(right[3]).toBe("0"); // L
    });

    it("leaves supplier columns blank when no ACTIVE supplier", () => {
        const { left, right } = rawMatToRowSegments({ ...baseRm, supplier_materials: [] } as never);
        expect(left[4]).toBe("");  // F SUPPLIER
        expect(right[0]).toBe(""); // I PRICE
        expect(right[1]).toBe(""); // J MOQ
        expect(right[2]).toBe(""); // K LEAD TIME
    });

    it("emits '' for null min_buy / lead_time on preferred supplier", () => {
        const { right } = rawMatToRowSegments({
            ...baseRm,
            supplier_materials: [
                { id: 1, is_preferred: true, status: "ACTIVE", supplier: { name: "PT X" }, unit_price: 100, min_buy: null, lead_time: null },
            ],
        } as never);
        expect(right[0]).toBe("100"); // I PRICE
        expect(right[1]).toBe("");    // J MOQ null
        expect(right[2]).toBe("");    // K LEAD TIME null
    });
});
