import { google, sheets_v4 } from "googleapis";
import { env } from "../config/env.js";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

let cachedClient: sheets_v4.Sheets | null = null;

function getClient(): sheets_v4.Sheets {
    if (cachedClient) return cachedClient;
    const auth = new google.auth.JWT({
        email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
        scopes: SCOPES,
    });
    cachedClient = google.sheets({ version: "v4", auth });
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
    static async readHeader(spreadsheetId: string, tabName: string): Promise<string[]> {
        const res = await getClient().spreadsheets.values.get({
            spreadsheetId,
            range: `${tabName}!1:1`,
        });
        const row = res.data.values?.[0];
        return Array.isArray(row) ? row.map(String) : [];
    }

    static async findRowByCode(
        spreadsheetId: string,
        tabName: string,
        code: string,
    ): Promise<number | null> {
        const res = await getClient().spreadsheets.values.get({
            spreadsheetId,
            range: `${tabName}!A2:A`,
        });
        const rows = res.data.values ?? [];
        for (let i = 0; i < rows.length; i++) {
            if (String(rows[i]?.[0] ?? "") === code) {
                return i + 2; // first data row is sheet row 2
            }
        }
        return null;
    }

    static async appendRow(
        spreadsheetId: string,
        tabName: string,
        values: string[],
    ): Promise<void> {
        await getClient().spreadsheets.values.append({
            spreadsheetId,
            range: `${tabName}!A:A`,
            valueInputOption: "RAW",
            insertDataOption: "INSERT_ROWS",
            requestBody: { values: [values] },
        });
    }

    static async updateRow(
        spreadsheetId: string,
        tabName: string,
        rowIndex: number,
        values: string[],
    ): Promise<void> {
        await getClient().spreadsheets.values.update({
            spreadsheetId,
            range: `${tabName}!A${rowIndex}:H${rowIndex}`,
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
