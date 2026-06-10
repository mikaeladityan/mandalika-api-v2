import { describe, it, expect } from "vitest";
import {
    obscureSupplierName,
    SUPPLIER_OBSCURE_REGEX,
    withObscuredSupplierName,
    withObscuredSupplierRelation,
} from "../../lib/utils/supplier-obscure.js";

describe("obscureSupplierName", () => {
    it("formats id <= 999 with SUP- prefix and 3-digit padding", () => {
        expect(obscureSupplierName(1)).toBe("SUP-001");
        expect(obscureSupplierName(42)).toBe("SUP-042");
        expect(obscureSupplierName(999)).toBe("SUP-999");
    });

    it("formats id 1000..9999 with SUP prefix (no dash) and 4-digit padding", () => {
        expect(obscureSupplierName(1000)).toBe("SUP1000");
        expect(obscureSupplierName(9999)).toBe("SUP9999");
    });

    it("returns SUP-??? for null/undefined", () => {
        expect(obscureSupplierName(null)).toBe("SUP-???");
        expect(obscureSupplierName(undefined)).toBe("SUP-???");
    });

    it("throws for id > 9999 (capacity exceeded)", () => {
        expect(() => obscureSupplierName(10000)).toThrow(/exceeds 7-char/);
    });

    it("throws for negative, zero, NaN, Infinity, and non-integer ids", () => {
        expect(() => obscureSupplierName(-1)).toThrow(/not a valid positive integer/);
        expect(() => obscureSupplierName(0)).toThrow(/not a valid positive integer/);
        expect(() => obscureSupplierName(1.5)).toThrow(/not a valid positive integer/);
        expect(() => obscureSupplierName(NaN)).toThrow(/not a valid positive integer/);
        expect(() => obscureSupplierName(Infinity)).toThrow(/not a valid positive integer/);
    });

    it("always produces output of length 7", () => {
        for (const id of [1, 9, 10, 99, 100, 999, 1000, 5000, 9999]) {
            expect(obscureSupplierName(id)).toHaveLength(7);
        }
        expect(obscureSupplierName(null)).toHaveLength(7);
    });

    it("SUPPLIER_OBSCURE_REGEX matches every legal output", () => {
        for (const id of [1, 42, 999, 1000, 9999]) {
            expect(obscureSupplierName(id)).toMatch(SUPPLIER_OBSCURE_REGEX);
        }
        expect(obscureSupplierName(null)).toMatch(SUPPLIER_OBSCURE_REGEX);
    });
});

describe("withObscuredSupplierName", () => {
    it("replaces supplier_name based on supplier_id and does not mutate input", () => {
        const input = { supplier_id: 42, supplier_name: "PT Sumber Makmur", other: 1 };
        const output = withObscuredSupplierName(input);
        expect(output).not.toBe(input);
        expect(input.supplier_name).toBe("PT Sumber Makmur");
        expect(output.supplier_name).toBe("SUP-042");
        expect(output.other).toBe(1);
    });

    it("uses SUP-??? fallback when supplier_id is null", () => {
        const output = withObscuredSupplierName({ supplier_id: null, supplier_name: "Anything" });
        expect(output.supplier_name).toBe("SUP-???");
    });

    it("returns row unchanged when supplier_name key is absent", () => {
        const input = { other: 1 } as { other: number; supplier_name?: string; supplier_id?: number };
        const output = withObscuredSupplierName(input);
        expect(output).toBe(input);
    });
});

describe("withObscuredSupplierRelation", () => {
    it("replaces nested supplier.name based on supplier.id and does not mutate input", () => {
        const input = {
            id: 1,
            supplier: { id: 7, name: "PT Sumber Makmur", country: "ID" },
        };
        const output = withObscuredSupplierRelation(input);
        expect(output).not.toBe(input);
        expect(output.supplier).not.toBe(input.supplier);
        expect(input.supplier.name).toBe("PT Sumber Makmur");
        expect(output.supplier?.name).toBe("SUP-007");
        expect(output.supplier?.country).toBe("ID");
    });

    it("uses SUP-??? when nested supplier.id is null/undefined", () => {
        const output = withObscuredSupplierRelation({
            supplier: { id: null, name: "Anything" },
        });
        expect(output.supplier?.name).toBe("SUP-???");
    });

    it("returns row unchanged when supplier relation is null or missing", () => {
        const a = { id: 1, supplier: null };
        expect(withObscuredSupplierRelation(a)).toBe(a);
        const b = { id: 2 } as { id: number; supplier?: null };
        expect(withObscuredSupplierRelation(b)).toBe(b);
    });
});
