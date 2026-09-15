import { describe, expect, it } from "vitest";
import { periodsFromRows, unpivotIssuance } from "../../../../module/application/outlet/issuance/import/import.parser.js";

describe("Issuance parser", () => {
    it("un pivots outlet/date headers and skips blank quantities", () => {
        const rows = unpivotIssuance([
            ["ISSUANCE", "", "", "", "TOKO :", "TOKO 1", null, "TOKO 2", null],
            ["", "", "", "", "TANGGAL :", "1/4", "1/4", "4/4", "4/4"],
            ["NO", "PRODUCT CODE", "PRODUCT NAME", "SIZE", "PRODUCT CATEGORY", "", "", "", ""],
            ["1", "P001", "Product", "M", "Category", 0, null, 2, 3],
        ]);
        expect(rows).toHaveLength(3);
        const year = new Date().getUTCFullYear();
        expect(rows[0]).toMatchObject({ product_code: "P001", outlet_code: "TOKO-1", quantity: 0, date: `${year}-04-01` });
        expect(rows[1]).toMatchObject({ product_code: "P001", outlet_code: "TOKO-2", quantity: 2, date: `${year}-04-04` });
        expect(rows[2]).toMatchObject({ product_code: "P001", outlet_code: "TOKO-2", quantity: 3, date: `${year}-04-04` });
    });

    it("derives distinct periods from logical rows", () => {
        expect(periodsFromRows([
            { product_code: "P001", outlet_code: "T1", date: "2026-04-01", quantity: 1, product_id: 1, outlet_id: 1, errors: [] },
            { product_code: "P001", outlet_code: "T1", date: "2026-05-01", quantity: 1, product_id: 1, outlet_id: 1, errors: [] },
        ])).toEqual([{ month: 4, year: 2026 }, { month: 5, year: 2026 }]);
    });

    it("normalizes outlet names with spaces into outlet codes", () => {
        const rows = unpivotIssuance([
            ["ISSUANCE", "", "", "", "TOKO :", "TSM CBB"],
            ["", "", "", "", "TANGGAL :", "1/4"],
            ["NO", "PRODUCT CODE", "PRODUCT NAME", "SIZE", "PRODUCT CATEGORY", ""],
            ["1", "P001", "Product", "M", "Category", 2],
        ]);
        expect(rows[0]?.outlet_code).toBe("TSM-CBB");
    });

});
