import { Context } from "hono";
import { ApiResponse } from "../../../../../lib/api.response.js";
import { ApiError } from "../../../../../lib/errors/api.error.js";
import { GetUploadedFile, MAX_ROWS } from "../../../../../lib/get.file.js";
import { ParseCSV } from "../../../../../lib/csv.js";
import { ParseXLSX } from "../../../../../lib/excel.js";
import { RMImportService } from "./import.service.js";
import { RequestExecuteRMImportDTO } from "./import.schema.js";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export class RMImportController {
    static async preview(c: Context) {
        const { buffer, mimetype, filename } = await GetUploadedFile(c);
        const isXlsx = mimetype === XLSX_MIME || filename.endsWith(".xlsx");

        const rows = isXlsx ? await ParseXLSX(buffer) : ParseCSV(buffer);
        if (rows.length > MAX_ROWS) {
            throw new ApiError(413, `File melebihi batas maksimum ${MAX_ROWS} baris`);
        }

        const result = await RMImportService.preview(rows);
        return ApiResponse.sendSuccess(c, result, 201);
    }

    static async execute(c: Context) {
        const { import_id } = c.get("body") as RequestExecuteRMImportDTO;
        const result = await RMImportService.execute(import_id);
        return ApiResponse.sendSuccess(c, result, 202);
    }

    static async getStatus(c: Context) {
        const import_id = c.req.param("import_id");
        if (!import_id) throw new ApiError(400, "Import ID wajib dilampirkan");
        const result = await RMImportService.getStatus(import_id);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async getPreview(c: Context) {
        const import_id = c.req.param("import_id");
        if (!import_id) throw new ApiError(400, "Import ID wajib dilampirkan");
        const result = await RMImportService.getPreview(import_id);
        return ApiResponse.sendSuccess(c, result, 200);
    }
}
