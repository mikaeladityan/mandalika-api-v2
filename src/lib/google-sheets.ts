import sheetsApi, { type sheets_v4 } from "@googleapis/sheets";
import { JWT } from "google-auth-library";
import { env } from "../config/env.js";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

let cachedClient: sheets_v4.Sheets | null = null;

function getClient(): sheets_v4.Sheets {
    if (cachedClient) return cachedClient;
    const auth = new JWT({
        email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
        scopes: SCOPES,
    });
    cachedClient = sheetsApi.sheets({ version: "v4", auth });
    return cachedClient;
}

async function getSheetGid(spreadsheetId: string, tabName: string): Promise<number> {
    const meta = await getClient().spreadsheets.get({ spreadsheetId });
    const sheet = meta.data.sheets?.find((s) => s.properties?.title === tabName);
    const gid = sheet?.properties?.sheetId;
    if (gid === null || gid === undefined) {
        throw new Error(`Sheet tab "${tabName}" not found in spreadsheet ${spreadsheetId}`);
    }
    return gid;
}

export class GoogleSheetsClient {
    /** Read a single-row range (e.g. "A1:H1" or "B1:I1") and return its cell values. */
    static async readHeader(
        spreadsheetId: string,
        tabName: string,
        headerRange: string,
    ): Promise<string[]> {
        const res = await getClient().spreadsheets.values.get({
            spreadsheetId,
            range: `${tabName}!${headerRange}`,
        });
        const row = res.data.values?.[0];
        return Array.isArray(row) ? row.map(String) : [];
    }

    /**
     * Read all cell values in a single-column range (e.g. "A2:A").
     * Missing cells are normalized to "".
     */
    static async readColumn(
        spreadsheetId: string,
        tabName: string,
        columnRange: string,
    ): Promise<string[]> {
        const res = await getClient().spreadsheets.values.get({
            spreadsheetId,
            range: `${tabName}!${columnRange}`,
        });
        const rows = res.data.values ?? [];
        return rows.map((r) => String(r?.[0] ?? ""));
    }

    /**
     * Scan a single column (e.g. "B2:B") for the given code. Returns the
     * 1-based sheet row index of the match, or null.
     */
    static async findRowByCode(
        spreadsheetId: string,
        tabName: string,
        codeColumnRange: string,
        code: string,
    ): Promise<number | null> {
        const res = await getClient().spreadsheets.values.get({
            spreadsheetId,
            range: `${tabName}!${codeColumnRange}`,
        });
        const rows = res.data.values ?? [];
        // Derive starting row from the range suffix (e.g. "B2:B" → 2).
        const startRow = parseStartRow(codeColumnRange);
        for (let i = 0; i < rows.length; i++) {
            if (String(rows[i]?.[0] ?? "") === code) {
                return i + startRow;
            }
        }
        return null;
    }

    /**
     * Append values as a new row, anchored to the given column range
     * (e.g. "B:B" makes the append start at column B).
     */
    static async appendRow(
        spreadsheetId: string,
        tabName: string,
        anchorRange: string,
        values: string[],
    ): Promise<void> {
        await getClient().spreadsheets.values.append({
            spreadsheetId,
            range: `${tabName}!${anchorRange}`,
            valueInputOption: "RAW",
            insertDataOption: "INSERT_ROWS",
            requestBody: { values: [values] },
        });
    }

    /** Update a specific row range (e.g. "B5:I5") with the given values. */
    static async updateRow(
        spreadsheetId: string,
        tabName: string,
        rowRange: string,
        values: string[],
    ): Promise<void> {
        await getClient().spreadsheets.values.update({
            spreadsheetId,
            range: `${tabName}!${rowRange}`,
            valueInputOption: "RAW",
            requestBody: { values: [values] },
        });
    }

    static async deleteRow(
        spreadsheetId: string,
        tabName: string,
        rowIndex: number,
    ): Promise<void> {
        const sheetId = await getSheetGid(spreadsheetId, tabName);
        await getClient().spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [
                    {
                        deleteDimension: {
                            range: {
                                sheetId,
                                dimension: "ROWS",
                                startIndex: rowIndex - 1,
                                endIndex: rowIndex,
                            },
                        },
                    },
                ],
            },
        });
    }
}

// Internal helper — extract the numeric row from a range like "B2:B" → 2.
function parseStartRow(range: string): number {
    const match = range.match(/^[A-Z]+(\d+):/);
    return match ? Number(match[1]) : 2;
}
