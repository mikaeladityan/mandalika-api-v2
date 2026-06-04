import { describe, it, expect, vi, beforeEach } from "vitest";

const mockValuesGet = vi.fn();
const mockValuesAppend = vi.fn();
const mockValuesUpdate = vi.fn();
const mockBatchUpdate = vi.fn();
const mockGetSpreadsheet = vi.fn();

vi.mock("@googleapis/sheets", () => ({
    default: {
        sheets: vi.fn(() => ({
            spreadsheets: {
                values: {
                    get: mockValuesGet,
                    append: mockValuesAppend,
                    update: mockValuesUpdate,
                },
                batchUpdate: mockBatchUpdate,
                get: mockGetSpreadsheet,
            },
        })),
    },
}));

vi.mock("google-auth-library", () => ({
    JWT: function MockJWT() { return {}; },
}));

vi.mock("../../config/env.js", () => ({
    env: {
        GOOGLE_SERVICE_ACCOUNT_EMAIL: "svc@example.com",
        GOOGLE_PRIVATE_KEY: "fake-key",
    },
}));

import { GoogleSheetsClient } from "../../lib/google-sheets.js";

describe("GoogleSheetsClient", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("readHeader", () => {
        it("returns the header row values for the given range", async () => {
            mockValuesGet.mockResolvedValueOnce({
                data: { values: [["CODE", "SAFETY %", "NAME"]] },
            });
            const result = await GoogleSheetsClient.readHeader("sheet-id", "PRODUCTS", "B1:I1");
            expect(result).toEqual(["CODE", "SAFETY %", "NAME"]);
            expect(mockValuesGet).toHaveBeenCalledWith(
                expect.objectContaining({
                    spreadsheetId: "sheet-id",
                    range: "PRODUCTS!B1:I1",
                }),
            );
        });

        it("returns empty array when sheet is empty", async () => {
            mockValuesGet.mockResolvedValueOnce({ data: {} });
            const result = await GoogleSheetsClient.readHeader("sheet-id", "PRODUCTS", "B1:I1");
            expect(result).toEqual([]);
        });
    });

    describe("findRowByCode", () => {
        it("returns 1-based row index when code is present in column B", async () => {
            mockValuesGet.mockResolvedValueOnce({
                data: { values: [["A-1"], ["A-2"], ["A-3"]] },
            });
            const row = await GoogleSheetsClient.findRowByCode("sid", "PRODUCTS", "B2:B", "A-2");
            // First data row is sheet row 2 (per range "B2:B"), A-2 is at index 1 → row 3
            expect(row).toBe(3);
            expect(mockValuesGet).toHaveBeenCalledWith(
                expect.objectContaining({ range: "PRODUCTS!B2:B" }),
            );
        });

        it("returns null when code is not present", async () => {
            mockValuesGet.mockResolvedValueOnce({
                data: { values: [["A-1"], ["A-3"]] },
            });
            const row = await GoogleSheetsClient.findRowByCode("sid", "PRODUCTS", "B2:B", "A-2");
            expect(row).toBeNull();
        });

        it("returns null when sheet has no data rows", async () => {
            mockValuesGet.mockResolvedValueOnce({ data: {} });
            const row = await GoogleSheetsClient.findRowByCode("sid", "PRODUCTS", "B2:B", "ANY");
            expect(row).toBeNull();
        });
    });

    describe("appendRow", () => {
        it("calls values.append with INSERT_ROWS, RAW, and the anchor range", async () => {
            mockValuesAppend.mockResolvedValueOnce({});
            await GoogleSheetsClient.appendRow("sid", "PRODUCTS", "B:B", ["A", "B", "C"]);
            expect(mockValuesAppend).toHaveBeenCalledWith(
                expect.objectContaining({
                    spreadsheetId: "sid",
                    range: "PRODUCTS!B:B",
                    valueInputOption: "RAW",
                    insertDataOption: "INSERT_ROWS",
                    requestBody: { values: [["A", "B", "C"]] },
                }),
            );
        });
    });

    describe("readColumn", () => {
        it("returns string values from a single-column range", async () => {
            mockValuesGet.mockResolvedValueOnce({
                data: { values: [["1"], ["2"], ["3"]] },
            });
            const result = await GoogleSheetsClient.readColumn("sid", "PRODUCTS", "A2:A");
            expect(result).toEqual(["1", "2", "3"]);
            expect(mockValuesGet).toHaveBeenCalledWith(
                expect.objectContaining({
                    spreadsheetId: "sid",
                    range: "PRODUCTS!A2:A",
                }),
            );
        });

        it("returns empty array when sheet has no values", async () => {
            mockValuesGet.mockResolvedValueOnce({ data: {} });
            const result = await GoogleSheetsClient.readColumn("sid", "PRODUCTS", "A2:A");
            expect(result).toEqual([]);
        });

        it("coerces cell values to strings and substitutes '' for missing cells", async () => {
            mockValuesGet.mockResolvedValueOnce({
                data: { values: [["1"], [], ["3"], [null]] },
            });
            const result = await GoogleSheetsClient.readColumn("sid", "PRODUCTS", "A2:A");
            expect(result).toEqual(["1", "", "3", ""]);
        });
    });

    describe("updateRow", () => {
        it("calls values.update with the given row range and values", async () => {
            mockValuesUpdate.mockResolvedValueOnce({});
            await GoogleSheetsClient.updateRow("sid", "PRODUCTS", "B5:I5", ["A", "B"]);
            expect(mockValuesUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    spreadsheetId: "sid",
                    range: "PRODUCTS!B5:I5",
                    valueInputOption: "RAW",
                    requestBody: { values: [["A", "B"]] },
                }),
            );
        });
    });

    describe("deleteRow", () => {
        it("uses batchUpdate with deleteDimension", async () => {
            mockGetSpreadsheet.mockResolvedValueOnce({
                data: { sheets: [{ properties: { title: "PRODUCTS", sheetId: 42 } }] },
            });
            mockBatchUpdate.mockResolvedValueOnce({});
            await GoogleSheetsClient.deleteRow("sid", "PRODUCTS", 5);
            expect(mockBatchUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    spreadsheetId: "sid",
                    requestBody: {
                        requests: [
                            {
                                deleteDimension: {
                                    range: {
                                        sheetId: 42,
                                        dimension: "ROWS",
                                        startIndex: 4,
                                        endIndex: 5,
                                    },
                                },
                            },
                        ],
                    },
                }),
            );
        });
    });
});
