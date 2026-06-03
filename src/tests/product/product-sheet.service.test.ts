import { describe, it, expect, vi, beforeEach } from "vitest";

const HEADERS = ["CODE", "SAFETY %", "NAME", "TYPE", "GENDER", "SIZE", "UOM", "DISTRIBUTION %"];

vi.mock("../../config/env.js", () => ({
    env: {
        GOOGLE_FG_SHEET_ID: "test-sheet",
        GOOGLE_FG_TAB_NAME: "PRODUCTS",
        PRODUCT_SHEET_SYNC_ENABLED: true,
        GOOGLE_SERVICE_ACCOUNT_EMAIL: "x",
        GOOGLE_PRIVATE_KEY: "x",
    },
}));

vi.mock("../../config/prisma.js", () => ({
    default: {
        product: {
            findUnique: vi.fn(),
        },
    },
}));

vi.mock("../../lib/google-sheets.js", () => ({
    GoogleSheetsClient: {
        readHeader: vi.fn().mockResolvedValue([
            "CODE", "SAFETY %", "NAME", "TYPE", "GENDER", "SIZE", "UOM", "DISTRIBUTION %",
        ]),
        findRowByCode: vi.fn(),
        appendRow: vi.fn(),
        updateRow: vi.fn(),
        deleteRow: vi.fn(),
    },
}));

import prisma from "../../config/prisma.js";
import { GoogleSheetsClient } from "../../lib/google-sheets.js";
import { ProductSheetSyncService } from "../../module/application/product/sheet/product-sheet.service.js";

const productFixture = {
    id: 1,
    code: "EDP-AZUR-100",
    name: "AZURE",
    gender: "UNISEX",
    distribution_percentage: 50,
    safety_percentage: 25,
    product_type: { name: "EDP" },
    unit: { name: "pcs" },
    size: { size: 100 },
};

describe("ProductSheetSyncService.handle", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(GoogleSheetsClient.readHeader).mockResolvedValue(HEADERS);
    });

    describe("upsert", () => {
        it("calls updateRow when product exists in sheet", async () => {
            vi.mocked(prisma.product.findUnique).mockResolvedValueOnce(productFixture as never);
            vi.mocked(GoogleSheetsClient.findRowByCode).mockResolvedValueOnce(5);

            await ProductSheetSyncService.handle({ action: "upsert", productId: 1 });

            expect(GoogleSheetsClient.findRowByCode).toHaveBeenCalledWith(
                "test-sheet", "PRODUCTS", "B2:B", "EDP-AZUR-100",
            );
            expect(GoogleSheetsClient.updateRow).toHaveBeenCalledWith(
                "test-sheet", "PRODUCTS", "B5:I5",
                ["EDP-AZUR-100", "25", "AZURE", "EDP", "UNISEX", "100", "pcs", "50"],
            );
            expect(GoogleSheetsClient.appendRow).not.toHaveBeenCalled();
        });

        it("calls appendRow when product missing in sheet (self-heal)", async () => {
            vi.mocked(prisma.product.findUnique).mockResolvedValueOnce(productFixture as never);
            vi.mocked(GoogleSheetsClient.findRowByCode).mockResolvedValueOnce(null);

            await ProductSheetSyncService.handle({ action: "upsert", productId: 1 });

            expect(GoogleSheetsClient.appendRow).toHaveBeenCalledWith(
                "test-sheet", "PRODUCTS", "B:B",
                ["EDP-AZUR-100", "25", "AZURE", "EDP", "UNISEX", "100", "pcs", "50"],
            );
            expect(GoogleSheetsClient.updateRow).not.toHaveBeenCalled();
        });

        it("uses oldCode for lookup when SKU changed", async () => {
            vi.mocked(prisma.product.findUnique).mockResolvedValueOnce(productFixture as never);
            vi.mocked(GoogleSheetsClient.findRowByCode).mockResolvedValueOnce(7);

            await ProductSheetSyncService.handle({
                action: "upsert",
                productId: 1,
                oldCode: "OLD-CODE",
            });

            expect(GoogleSheetsClient.findRowByCode).toHaveBeenCalledWith(
                "test-sheet", "PRODUCTS", "B2:B", "OLD-CODE",
            );
            expect(GoogleSheetsClient.updateRow).toHaveBeenCalledWith(
                "test-sheet", "PRODUCTS", "B7:I7",
                ["EDP-AZUR-100", "25", "AZURE", "EDP", "UNISEX", "100", "pcs", "50"],
            );
        });

        it("falls back to new code lookup when oldCode not in sheet", async () => {
            vi.mocked(prisma.product.findUnique).mockResolvedValueOnce(productFixture as never);
            vi.mocked(GoogleSheetsClient.findRowByCode)
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(9);

            await ProductSheetSyncService.handle({
                action: "upsert",
                productId: 1,
                oldCode: "OLD-CODE",
            });

            expect(GoogleSheetsClient.findRowByCode).toHaveBeenNthCalledWith(1,
                "test-sheet", "PRODUCTS", "B2:B", "OLD-CODE");
            expect(GoogleSheetsClient.findRowByCode).toHaveBeenNthCalledWith(2,
                "test-sheet", "PRODUCTS", "B2:B", "EDP-AZUR-100");
            expect(GoogleSheetsClient.updateRow).toHaveBeenCalledWith(
                "test-sheet", "PRODUCTS", "B9:I9",
                expect.any(Array),
            );
        });

        it("throws when product not found in DB", async () => {
            vi.mocked(prisma.product.findUnique).mockResolvedValueOnce(null);

            await expect(
                ProductSheetSyncService.handle({ action: "upsert", productId: 999 }),
            ).rejects.toThrow(/Product 999 not found/);
        });

        it("throws when sheet headers do not match expected", async () => {
            vi.mocked(GoogleSheetsClient.readHeader).mockResolvedValueOnce(["WRONG", "HEADERS"]);
            vi.mocked(prisma.product.findUnique).mockResolvedValueOnce(productFixture as never);

            await expect(
                ProductSheetSyncService.handle({ action: "upsert", productId: 1 }),
            ).rejects.toThrow(/Sheet header mismatch/);
        });
    });

    describe("delete", () => {
        it("calls deleteRow when product exists in sheet", async () => {
            vi.mocked(GoogleSheetsClient.findRowByCode).mockResolvedValueOnce(3);

            await ProductSheetSyncService.handle({
                action: "delete",
                productId: 1,
                code: "EDP-AZUR-100",
            });

            expect(GoogleSheetsClient.findRowByCode).toHaveBeenCalledWith(
                "test-sheet", "PRODUCTS", "B2:B", "EDP-AZUR-100",
            );
            expect(GoogleSheetsClient.deleteRow).toHaveBeenCalledWith(
                "test-sheet", "PRODUCTS", 3,
            );
        });

        it("is a no-op when product missing in sheet", async () => {
            vi.mocked(GoogleSheetsClient.findRowByCode).mockResolvedValueOnce(null);

            await ProductSheetSyncService.handle({
                action: "delete",
                productId: 1,
                code: "GONE",
            });

            expect(GoogleSheetsClient.deleteRow).not.toHaveBeenCalled();
        });
    });

    it("short-circuits when sync disabled", async () => {
        const envMod = await import("../../config/env.js");
        const original = envMod.env.PRODUCT_SHEET_SYNC_ENABLED;
        (envMod.env as { PRODUCT_SHEET_SYNC_ENABLED: boolean }).PRODUCT_SHEET_SYNC_ENABLED = false;

        await ProductSheetSyncService.handle({ action: "upsert", productId: 1 });

        expect(GoogleSheetsClient.readHeader).not.toHaveBeenCalled();
        expect(prisma.product.findUnique).not.toHaveBeenCalled();

        (envMod.env as { PRODUCT_SHEET_SYNC_ENABLED: boolean }).PRODUCT_SHEET_SYNC_ENABLED = original;
    });
});
