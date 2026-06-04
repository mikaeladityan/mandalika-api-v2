import prisma from "../../../../config/prisma.js";
import { env } from "../../../../config/env.js";
import { GoogleSheetsClient } from "../../../../lib/google-sheets.js";
import { rawMatToRow, type RawMatWithSheetRelations } from "./rawmat-sheet.mapper.js";
import type { RawMatSheetSyncJob } from "./rawmat-sheet.schema.js";

/**
 * RM sheet layout:
 *   A: UID (auto-iterated integer assigned by sync on append)
 *   B: BARCODE
 *   C: CATEGORY
 *   D: MATERIAL NAME
 *   E: UOM
 *   F: SUPPLIER (preferred)
 *   G: PRICE
 *   H: MOQ
 *   I: LEAD TIME
 *   J: MIN STOCK
 *   K: LOCAL/IMPORT
 *
 * Update path uses an explicit B{n}:K{n} range so UID at column A is never
 * touched on update. Append path uses anchor A:K with the UID prepended so
 * Google's values.append does not silently left-shift the row (same fix as
 * FG product sheet).
 */
const EXPECTED_HEADERS = [
    "BARCODE",
    "CATEGORY",
    "MATERIAL NAME",
    "UOM",
    "SUPPLIER",
    "PRICE",
    "MOQ",
    "LEAD TIME",
    "MIN STOCK",
    "LOCAL/IMPORT",
] as const;
const HEADER_RANGE = "B1:K1";
const CODE_COLUMN_RANGE = "B2:B";
const UID_COLUMN_RANGE = "A2:A";
const APPEND_ANCHOR_RANGE = "A:K";
const rowDataRange = (n: number) => `B${n}:K${n}`;

const SHEET_INCLUDES = {
    raw_mat_category: { select: { name: true } },
    unit_raw_material: { select: { name: true } },
    supplier_materials: {
        select: {
            id: true,
            is_preferred: true,
            status: true,
            unit_price: true,
            min_buy: true,
            lead_time: true,
            supplier: { select: { name: true, source: true } },
        },
    },
} as const;

/** Pick the next sequential integer UID for column A: max existing + 1, or 1 if none. */
export function computeNextUid(column: string[]): string {
    let max = 0;
    for (const v of column) {
        const n = Number(v);
        if (Number.isFinite(n) && Math.floor(n) === n && n > max) max = n;
    }
    return String(max + 1);
}

export class RawMatSheetSyncService {
    static async handle(job: RawMatSheetSyncJob): Promise<void> {
        if (!env.RAWMAT_SHEET_SYNC_ENABLED) return;

        const sheetId = env.GOOGLE_RM_SHEET_ID;
        const tab = env.GOOGLE_RM_TAB_NAME;

        const headers = await GoogleSheetsClient.readHeader(sheetId, tab, HEADER_RANGE);
        if (
            headers.length < EXPECTED_HEADERS.length ||
            EXPECTED_HEADERS.some((h, i) => headers[i] !== h)
        ) {
            throw new Error(
                `Sheet header mismatch. Expected: ${EXPECTED_HEADERS.join(",")} Got: ${headers.join(",")}`,
            );
        }

        if (job.action === "upsert") {
            const rm = (await prisma.rawMaterial.findUnique({
                where: { id: job.rawMaterialId },
                include: SHEET_INCLUDES,
            })) as RawMatWithSheetRelations | null;
            if (!rm) throw new Error(`Raw material ${job.rawMaterialId} not found in DB`);

            const primarySearchCode = job.oldBarcode ?? rm.barcode ?? "";
            if (!primarySearchCode) {
                throw new Error(
                    `Raw material ${job.rawMaterialId} has no barcode — cannot sync to sheet`,
                );
            }

            const values = rawMatToRow(rm);
            let rowIndex = await GoogleSheetsClient.findRowByCode(
                sheetId,
                tab,
                CODE_COLUMN_RANGE,
                primarySearchCode,
            );

            if (rowIndex === null && job.oldBarcode) {
                rowIndex = await GoogleSheetsClient.findRowByCode(
                    sheetId,
                    tab,
                    CODE_COLUMN_RANGE,
                    rm.barcode ?? "",
                );
            }

            if (rowIndex === null) {
                const uidColumn = await GoogleSheetsClient.readColumn(
                    sheetId,
                    tab,
                    UID_COLUMN_RANGE,
                );
                const nextUid = computeNextUid(uidColumn);
                await GoogleSheetsClient.appendRow(
                    sheetId,
                    tab,
                    APPEND_ANCHOR_RANGE,
                    [nextUid, ...values],
                );
            } else {
                await GoogleSheetsClient.updateRow(sheetId, tab, rowDataRange(rowIndex), values);
            }
            return;
        }

        // action === "delete"
        const rowIndex = await GoogleSheetsClient.findRowByCode(
            sheetId,
            tab,
            CODE_COLUMN_RANGE,
            job.barcode,
        );
        if (rowIndex !== null) {
            await GoogleSheetsClient.deleteRow(sheetId, tab, rowIndex);
        }
    }
}
