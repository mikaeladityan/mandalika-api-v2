import { describe, it, expect, vi, beforeEach } from "vitest";

const mockValuesGet = vi.fn();
const mockValuesAppend = vi.fn();
const mockValuesUpdate = vi.fn();
const mockBatchUpdate = vi.fn();
const mockGetSpreadsheet = vi.fn();

vi.mock("googleapis", () => ({
    google: {
        auth: { JWT: function MockJWT() { return {}; } },
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
        it("returns the header row values", async () => {
            mockValuesGet.mockResolvedValueOnce({
                data: { values: [["PRODUCT CODE", "PRODUCT NAME", "TYPE"]] },
            });
            const result = await GoogleSheetsClient.readHeader("sheet-id", "PRODUCTS");
            expect(result).toEqual(["PRODUCT CODE", "PRODUCT NAME", "TYPE"]);
            expect(mockValuesGet).toHaveBeenCalledWith(
                expect.objectContaining({
                    spreadsheetId: "sheet-id",
                    range: "PRODUCTS!1:1",
                }),
            );
        });

        it("returns empty array when sheet is empty", async () => {
            mockValuesGet.mockResolvedValueOnce({ data: {} });
            const result = await GoogleSheetsClient.readHeader("sheet-id", "PRODUCTS");
            expect(result).toEqual([]);
        });
    });

    describe("findRowByCode", () => {
        it("returns 1-based row index when code is present", async () => {
            mockValuesGet.mockResolvedValueOnce({
                data: { values: [["A-1"], ["A-2"], ["A-3"]] },
            });
            const row = await GoogleSheetsClient.findRowByCode("sid", "PRODUCTS", "A-2");
            expect(row).toBe(3);
            expect(mockValuesGet).toHaveBeenCalledWith(
                expect.objectContaining({ range: "PRODUCTS!A2:A" }),
            );
        });

        it("returns null when code is not present", async () => {
            mockValuesGet.mockResolvedValueOnce({
                data: { values: [["A-1"], ["A-3"]] },
            });
            const row = await GoogleSheetsClient.findRowByCode("sid", "PRODUCTS", "A-2");
            expect(row).toBeNull();
        });

        it("returns null when sheet has no data rows", async () => {
            mockValuesGet.mockResolvedValueOnce({ data: {} });
            const row = await GoogleSheetsClient.findRowByCode("sid", "PRODUCTS", "ANY");
            expect(row).toBeNull();
        });
    });

    describe("appendRow", () => {
        it("calls values.append with INSERT_ROWS and RAW", async () => {
            mockValuesAppend.mockResolvedValueOnce({});
            await GoogleSheetsClient.appendRow("sid", "PRODUCTS", ["A", "B", "C"]);
            expect(mockValuesAppend).toHaveBeenCalledWith(
                expect.objectContaining({
                    spreadsheetId: "sid",
                    range: "PRODUCTS!A:A",
                    valueInputOption: "RAW",
                    insertDataOption: "INSERT_ROWS",
                    requestBody: { values: [["A", "B", "C"]] },
                }),
            );
        });
    });

    describe("updateRow", () => {
        it("calls values.update with the correct range and values", async () => {
            mockValuesUpdate.mockResolvedValueOnce({});
            await GoogleSheetsClient.updateRow("sid", "PRODUCTS", 5, ["A", "B"]);
            expect(mockValuesUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    spreadsheetId: "sid",
                    range: "PRODUCTS!A5:H5",
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
