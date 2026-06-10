import { describe, it, expect } from "vitest";
import {
    obscureSupplierName,
    SUPPLIER_OBSCURE_REGEX,
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
