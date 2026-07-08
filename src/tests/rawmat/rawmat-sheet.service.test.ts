import { describe, it, expect, vi, beforeEach } from "vitest";

const HEADERS = [
    "BARCODE", "CATEGORY", "MATERIAL NAME", "UOM",
    "SUPPLIER", "SUPPLIER_FLAG", "USD", "PRICE", "MOQ", "LEAD TIME",
    "MIN STOCK", "LOCAL/IMPORT",
];

vi.mock("../../config/env.js", () => ({
    env: {
        GOOGLE_RM_SHEET_ID: "rm-sheet",
        GOOGLE_RM_TAB_NAME: "MANDALIKA",
        RAWMAT_SHEET_SYNC_ENABLED: true,
        GOOGLE_SERVICE_ACCOUNT_EMAIL: "x",
        GOOGLE_PRIVATE_KEY: "x",
    },
}));

vi.mock("../../config/prisma.js", () => ({
    default: {
        rawMaterial: {
            findUnique: vi.fn(),
        },
    },
}));

vi.mock("../../lib/google-sheets.js", () => ({
    GoogleSheetsClient: {
        readHeader: vi.fn().mockResolvedValue([
            "BARCODE", "CATEGORY", "MATERIAL NAME", "UOM",
            "SUPPLIER", "SUPPLIER_FLAG", "USD", "PRICE", "MOQ", "LEAD TIME",
            "MIN STOCK", "LOCAL/IMPORT",
        ]),
        readColumn: vi.fn().mockResolvedValue([]),
        findRowByCode: vi.fn(),
        appendRow: vi.fn(),
        updateRow: vi.fn(),
        deleteRow: vi.fn(),
    },
}));

import prisma from "../../config/prisma.js";
import { GoogleSheetsClient } from "../../lib/google-sheets.js";
import {
    RawMatSheetSyncService,
    computeNextUid,
} from "../../module/application/rawmat/sheet/rawmat-sheet.service.js";

const rmFixture = {
    id: 1,
    barcode: "RM-001",
    name: "GLYCERIN",
    min_stock: 25,
    source: "LOCAL" as const,
    raw_mat_category: { name: "BASE" },
    unit_raw_material: { name: "KG" },
    supplier_materials: [
        {
            id: 1,
            is_preferred: true,
            status: "ACTIVE",
            supplier: { name: "PT MAJU", source: "LOCAL" },
            unit_price: 12500,
            min_buy: 50,
            lead_time: 7,
        },
    ],
};

// Kolom G (SUPPLIER_FLAG) & H (USD) manual di sheet — update menulis dua
// segmen (B-F dan I-M); append menyisipkan dua sel kosong di posisi G/H.
const rowLeft = ["RM-001", "BASE", "GLYCERIN", "KG", "PT MAJU"];
const rowRight = ["12500", "50", "7", "25", "LOCAL"];
const appendValues = [...rowLeft, "", "", ...rowRight];

describe("computeNextUid", () => {
    it("returns '1' for an empty column", () => {
        expect(computeNextUid([])).toBe("1");
    });

    it("returns '1' when column has only non-numeric values", () => {
        expect(computeNextUid(["abc", "", "X-1"])).toBe("1");
    });

    it("returns max numeric + 1", () => {
        expect(computeNextUid(["1", "2", "5", "3"])).toBe("6");
    });

    it("ignores non-integer numerics", () => {
        expect(computeNextUid(["1", "2.5", "3", "abc"])).toBe("4");
    });

    it("ignores negative numbers and zero", () => {
        expect(computeNextUid(["-5", "0", "2"])).toBe("3");
    });
});

describe("RawMatSheetSyncService.handle", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(GoogleSheetsClient.readHeader).mockResolvedValue(HEADERS);
        vi.mocked(GoogleSheetsClient.readColumn).mockResolvedValue([]);
    });

    describe("upsert", () => {
        it("calls updateRow when row exists in sheet (no UID touched)", async () => {
            vi.mocked(prisma.rawMaterial.findUnique).mockResolvedValueOnce(rmFixture as never);
            vi.mocked(GoogleSheetsClient.findRowByCode).mockResolvedValueOnce(5);

            await RawMatSheetSyncService.handle({ action: "upsert", rawMaterialId: 1 });

            expect(GoogleSheetsClient.findRowByCode).toHaveBeenCalledWith(
                "rm-sheet", "MANDALIKA", "B2:B", "RM-001",
            );
            expect(GoogleSheetsClient.updateRow).toHaveBeenCalledWith(
                "rm-sheet", "MANDALIKA", "B5:F5", rowLeft,
            );
            expect(GoogleSheetsClient.updateRow).toHaveBeenCalledWith(
                "rm-sheet", "MANDALIKA", "I5:M5", rowRight,
            );
            expect(GoogleSheetsClient.appendRow).not.toHaveBeenCalled();
            expect(GoogleSheetsClient.readColumn).not.toHaveBeenCalled();
        });

        it("appendRow gets UID + 12 data cells anchored to A:M when row missing (self-heal)", async () => {
            vi.mocked(prisma.rawMaterial.findUnique).mockResolvedValueOnce(rmFixture as never);
            vi.mocked(GoogleSheetsClient.findRowByCode).mockResolvedValueOnce(null);
            vi.mocked(GoogleSheetsClient.readColumn).mockResolvedValueOnce(["1", "2", "3"]);

            await RawMatSheetSyncService.handle({ action: "upsert", rawMaterialId: 1 });

            expect(GoogleSheetsClient.readColumn).toHaveBeenCalledWith(
                "rm-sheet", "MANDALIKA", "A2:A",
            );
            expect(GoogleSheetsClient.appendRow).toHaveBeenCalledWith(
                "rm-sheet", "MANDALIKA", "A:M",
                ["4", ...appendValues],
            );
            expect(GoogleSheetsClient.updateRow).not.toHaveBeenCalled();
        });

        it("uses UID '1' when column A is empty on first-ever append", async () => {
            vi.mocked(prisma.rawMaterial.findUnique).mockResolvedValueOnce(rmFixture as never);
            vi.mocked(GoogleSheetsClient.findRowByCode).mockResolvedValueOnce(null);
            vi.mocked(GoogleSheetsClient.readColumn).mockResolvedValueOnce([]);

            await RawMatSheetSyncService.handle({ action: "upsert", rawMaterialId: 1 });

            expect(GoogleSheetsClient.appendRow).toHaveBeenCalledWith(
                "rm-sheet", "MANDALIKA", "A:M",
                ["1", ...appendValues],
            );
        });

        it("uses oldBarcode for lookup when barcode changed", async () => {
            vi.mocked(prisma.rawMaterial.findUnique).mockResolvedValueOnce(rmFixture as never);
            vi.mocked(GoogleSheetsClient.findRowByCode).mockResolvedValueOnce(9);

            await RawMatSheetSyncService.handle({
                action: "upsert",
                rawMaterialId: 1,
                oldBarcode: "RM-OLD",
            });

            expect(GoogleSheetsClient.findRowByCode).toHaveBeenCalledWith(
                "rm-sheet", "MANDALIKA", "B2:B", "RM-OLD",
            );
            expect(GoogleSheetsClient.updateRow).toHaveBeenCalledWith(
                "rm-sheet", "MANDALIKA", "B9:F9", rowLeft,
            );
            expect(GoogleSheetsClient.updateRow).toHaveBeenCalledWith(
                "rm-sheet", "MANDALIKA", "I9:M9", rowRight,
            );
        });

        it("falls back to new barcode when oldBarcode not in sheet", async () => {
            vi.mocked(prisma.rawMaterial.findUnique).mockResolvedValueOnce(rmFixture as never);
            vi.mocked(GoogleSheetsClient.findRowByCode)
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(11);

            await RawMatSheetSyncService.handle({
                action: "upsert",
                rawMaterialId: 1,
                oldBarcode: "RM-OLD",
            });

            expect(GoogleSheetsClient.findRowByCode).toHaveBeenNthCalledWith(
                1, "rm-sheet", "MANDALIKA", "B2:B", "RM-OLD",
            );
            expect(GoogleSheetsClient.findRowByCode).toHaveBeenNthCalledWith(
                2, "rm-sheet", "MANDALIKA", "B2:B", "RM-001",
            );
            expect(GoogleSheetsClient.updateRow).toHaveBeenCalledWith(
                "rm-sheet", "MANDALIKA", "B11:F11", rowLeft,
            );
            expect(GoogleSheetsClient.updateRow).toHaveBeenCalledWith(
                "rm-sheet", "MANDALIKA", "I11:M11", rowRight,
            );
        });

        it("throws when RM not found in DB", async () => {
            vi.mocked(prisma.rawMaterial.findUnique).mockResolvedValueOnce(null);
            await expect(
                RawMatSheetSyncService.handle({ action: "upsert", rawMaterialId: 999 }),
            ).rejects.toThrow(/Raw material 999 not found/);
        });

        it("throws when RM has empty barcode and no oldBarcode (precondition leak)", async () => {
            vi.mocked(prisma.rawMaterial.findUnique).mockResolvedValueOnce({
                ...rmFixture, barcode: null,
            } as never);
            await expect(
                RawMatSheetSyncService.handle({ action: "upsert", rawMaterialId: 1 }),
            ).rejects.toThrow(/has no barcode/);
        });

        it("throws when sheet headers do not match expected", async () => {
            vi.mocked(GoogleSheetsClient.readHeader).mockResolvedValueOnce(["WRONG"]);
            vi.mocked(prisma.rawMaterial.findUnique).mockResolvedValueOnce(rmFixture as never);
            await expect(
                RawMatSheetSyncService.handle({ action: "upsert", rawMaterialId: 1 }),
            ).rejects.toThrow(/Sheet header mismatch/);
        });
    });

    describe("delete", () => {
        it("calls deleteRow when row found", async () => {
            vi.mocked(GoogleSheetsClient.findRowByCode).mockResolvedValueOnce(3);
            await RawMatSheetSyncService.handle({
                action: "delete", rawMaterialId: 1, barcode: "RM-001",
            });
            expect(GoogleSheetsClient.findRowByCode).toHaveBeenCalledWith(
                "rm-sheet", "MANDALIKA", "B2:B", "RM-001",
            );
            expect(GoogleSheetsClient.deleteRow).toHaveBeenCalledWith(
                "rm-sheet", "MANDALIKA", 3,
            );
        });

        it("is a no-op when row missing", async () => {
            vi.mocked(GoogleSheetsClient.findRowByCode).mockResolvedValueOnce(null);
            await RawMatSheetSyncService.handle({
                action: "delete", rawMaterialId: 1, barcode: "GONE",
            });
            expect(GoogleSheetsClient.deleteRow).not.toHaveBeenCalled();
        });
    });

    it("short-circuits when sync disabled", async () => {
        const envMod = await import("../../config/env.js");
        const original = envMod.env.RAWMAT_SHEET_SYNC_ENABLED;
        (envMod.env as { RAWMAT_SHEET_SYNC_ENABLED: boolean }).RAWMAT_SHEET_SYNC_ENABLED = false;

        await RawMatSheetSyncService.handle({ action: "upsert", rawMaterialId: 1 });

        expect(GoogleSheetsClient.readHeader).not.toHaveBeenCalled();
        expect(prisma.rawMaterial.findUnique).not.toHaveBeenCalled();

        (envMod.env as { RAWMAT_SHEET_SYNC_ENABLED: boolean }).RAWMAT_SHEET_SYNC_ENABLED = original;
    });
});
