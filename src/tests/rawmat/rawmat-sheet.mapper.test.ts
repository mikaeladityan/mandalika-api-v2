import { describe, it, expect } from "vitest";
import { rawMatToRow, pickPreferredSupplier } from "../../module/application/rawmat/sheet/rawmat-sheet.mapper.js";

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

describe("rawMatToRow", () => {
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

    it("returns 10 cells in B-K order with all fields populated", () => {
        const row = rawMatToRow(baseRm as never);
        expect(row).toEqual([
            "RM-001",     // B BARCODE
            "BASE",       // C CATEGORY
            "GLYCERIN USP", // D NAME
            "KG",         // E UOM
            "PT MAJU",    // F SUPPLIER
            "12500",      // G PRICE
            "50",         // H MOQ
            "7",          // I LEAD TIME
            "25",         // J MIN STOCK
            "LOCAL",      // K LOCAL/IMPORT
        ]);
        expect(row).toHaveLength(10);
    });

    it("substitutes empty strings for null category and source", () => {
        const row = rawMatToRow({ ...baseRm, raw_mat_category: null, source: null } as never);
        expect(row[1]).toBe(""); // C
        expect(row[9]).toBe(""); // K
    });

    it("substitutes '0' for null min_stock", () => {
        const row = rawMatToRow({ ...baseRm, min_stock: null } as never);
        expect(row[8]).toBe("0"); // J
    });

    it("leaves supplier columns blank when no ACTIVE supplier", () => {
        const row = rawMatToRow({ ...baseRm, supplier_materials: [] } as never);
        expect(row[4]).toBe(""); // F SUPPLIER
        expect(row[5]).toBe(""); // G PRICE
        expect(row[6]).toBe(""); // H MOQ
        expect(row[7]).toBe(""); // I LEAD TIME
    });

    it("emits '' for null min_buy / lead_time on preferred supplier", () => {
        const row = rawMatToRow({
            ...baseRm,
            supplier_materials: [
                { id: 1, is_preferred: true, status: "ACTIVE", supplier: { name: "PT X" }, unit_price: 100, min_buy: null, lead_time: null },
            ],
        } as never);
        expect(row[5]).toBe("100"); // G PRICE
        expect(row[6]).toBe("");    // H MOQ null
        expect(row[7]).toBe("");    // I LEAD TIME null
    });
});
