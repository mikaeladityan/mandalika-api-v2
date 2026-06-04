import prisma from "../../../../config/prisma.js";
import { env } from "../../../../config/env.js";
import { GoogleSheetsClient } from "../../../../lib/google-sheets.js";
import { productToRow, type ProductWithSheetRelations } from "./product-sheet.mapper.js";
import type { ProductSheetSyncJob } from "./product-sheet.schema.js";

/**
 * FG sheet layout:
 *   A: UID (managed by other linked sheets — sync MUST leave it alone)
 *   B: CODE
 *   C: SAFETY %
 *   D: NAME
 *   E: TYPE
 *   F: GENDER
 *   G: SIZE
 *   H: UOM
 *   I: DISTRIBUTION %
 */
const EXPECTED_HEADERS = [
    "CODE",
    "SAFETY %",
    "NAME",
    "TYPE",
    "GENDER",
    "SIZE",
    "UOM",
    "DISTRIBUTION %",
] as const;
const HEADER_RANGE = "B1:I1";
const CODE_COLUMN_RANGE = "B2:B";
const UID_COLUMN_RANGE = "A2:A";
// Anchor spans A-I so values.append writes from column A (UID + 8 data cols).
// Anchor "B:B" silently shifted everything left because the API detects the
// table starting at A when row 1 has UID populated.
const APPEND_ANCHOR_RANGE = "A:I";
const rowDataRange = (n: number) => `B${n}:I${n}`;

/** Pick the next sequential integer UID for column A: max existing + 1, or 1 if none. */
export function computeNextUid(column: string[]): string {
    let max = 0;
    for (const v of column) {
        const n = Number(v);
        if (Number.isFinite(n) && Math.floor(n) === n && n > max) max = n;
    }
    return String(max + 1);
}

const SHEET_INCLUDES = {
    product_type: { select: { name: true } },
    unit: { select: { name: true } },
    size: { select: { size: true } },
} as const;

export class ProductSheetSyncService {
    static async handle(job: ProductSheetSyncJob): Promise<void> {
        if (!env.PRODUCT_SHEET_SYNC_ENABLED) return;

        const sheetId = env.GOOGLE_FG_SHEET_ID;
        const tab = env.GOOGLE_FG_TAB_NAME;

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
            const product = (await prisma.product.findUnique({
                where: { id: job.productId },
                include: SHEET_INCLUDES,
            })) as ProductWithSheetRelations | null;
            if (!product) throw new Error(`Product ${job.productId} not found in DB`);

            const values = productToRow(product);
            const primarySearchCode = job.oldCode ?? product.code ?? "";
            let rowIndex = await GoogleSheetsClient.findRowByCode(
                sheetId,
                tab,
                CODE_COLUMN_RANGE,
                primarySearchCode,
            );

            if (rowIndex === null && job.oldCode) {
                rowIndex = await GoogleSheetsClient.findRowByCode(
                    sheetId,
                    tab,
                    CODE_COLUMN_RANGE,
                    product.code ?? "",
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
            job.code,
        );
        if (rowIndex !== null) {
            await GoogleSheetsClient.deleteRow(sheetId, tab, rowIndex);
        }
    }
}
