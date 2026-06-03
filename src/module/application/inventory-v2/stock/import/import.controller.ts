import { Context } from "hono";
import { GetUploadedFile, MAX_ROWS } from "../../../../../lib/get.file.js";
import { ParseCSV } from "../../../../../lib/csv.js";
import { ParseXLSX } from "../../../../../lib/excel.js";
import { StockImportService } from "./import.service.js";
import { ApiResponse } from "../../../../../lib/api.response.js";
import { ApiError } from "../../../../../lib/errors/api.error.js";
import { RequestStockImportDTO } from "./import.schema.js";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseImportId(raw: string | undefined): string {
    if (!raw) throw new ApiError(400, "Import ID wajib dilampirkan");
    if (!UUID_RE.test(raw)) throw new ApiError(400, "Import ID tidak valid");
    return raw;
}

export class StockImportController {
    static async preview(c: Context) {
        const { buffer, mimetype, filename } = await GetUploadedFile(c);
        const isXlsx = mimetype === XLSX_MIME || filename.endsWith(".xlsx");

        const rows = isXlsx ? await ParseXLSX(buffer) : ParseCSV(buffer);
        if (rows.length > MAX_ROWS) {
            throw new ApiError(413, `File melebihi batas maksimum ${MAX_ROWS} baris`);
        }

        const result = await StockImportService.preview(rows);
        return ApiResponse.sendSuccess(c, result, 201);
    }

    static async execute(c: Context) {
        const body = c.get("body") as RequestStockImportDTO;
        const now = new Date();
        const month = body.month ?? now.getUTCMonth() + 1;
        const year = body.year ?? now.getUTCFullYear();

        const result = await StockImportService.execute(
            body.import_id,
            body.warehouse_id,
            month,
            year,
        );
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async getPreview(c: Context) {
        const import_id = parseImportId(c.req.param("import_id"));
        const result = await StockImportService.getPreview(import_id);
        return ApiResponse.sendSuccess(c, result, 200);
    }
}
