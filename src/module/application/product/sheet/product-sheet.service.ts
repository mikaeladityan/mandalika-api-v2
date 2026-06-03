import prisma from "../../../../config/prisma.js";
import { env } from "../../../../config/env.js";
import { GoogleSheetsClient } from "../../../../lib/google-sheets.js";
import { PRODUCT_IMPORT_HEADERS } from "../import/import.schema.js";
import { productToRow, type ProductWithSheetRelations } from "./product-sheet.mapper.js";
import type { ProductSheetSyncJob } from "./product-sheet.schema.js";

const EXPECTED_HEADERS = Object.values(PRODUCT_IMPORT_HEADERS);

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

        const headers = await GoogleSheetsClient.readHeader(sheetId, tab);
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
            let rowIndex = await GoogleSheetsClient.findRowByCode(sheetId, tab, primarySearchCode);

            if (rowIndex === null && job.oldCode) {
                rowIndex = await GoogleSheetsClient.findRowByCode(
                    sheetId,
                    tab,
                    product.code ?? "",
                );
            }

            if (rowIndex === null) {
                await GoogleSheetsClient.appendRow(sheetId, tab, values);
            } else {
                await GoogleSheetsClient.updateRow(sheetId, tab, rowIndex, values);
            }
            return;
        }

        // action === "delete"
        const rowIndex = await GoogleSheetsClient.findRowByCode(sheetId, tab, job.code);
        if (rowIndex !== null) {
            await GoogleSheetsClient.deleteRow(sheetId, tab, rowIndex);
        }
    }
}
