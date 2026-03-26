// import.controller.ts
import { Context } from "hono";
import { GetUploadedFile } from "../../../../lib/get.file.js";
import { ParseCSV } from "../../../../lib/csv.js";
import { ParseXLSX } from "../../../../lib/excel.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { ApiResponse } from "../../../../lib/api.response.js";
import { SalesImportService } from "./import.service.js";

export class SalesImportController {
    static async preview(c: Context) {
        const { buffer, mimetype, filename } = await GetUploadedFile(c);
        const isXlsx =
            mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
            filename.endsWith(".xlsx");

        const rows = isXlsx ? await ParseXLSX(buffer) : ParseCSV(buffer);

        const result = await SalesImportService.preview(rows);
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async execute(c: Context) {
        const body = c.get("body");

        const now = new Date();
        const month = body.month ? Number(body.month) : now.getUTCMonth() + 1;
        const year = body.year ? Number(body.year) : now.getUTCFullYear();

        const result = await SalesImportService.execute(body.import_id, month, year, body.type);
        return ApiResponse.sendSuccess(c, result, 201);
    }

    static async getPreview(c: Context) {
        const import_id = c.req.param("import_id");
        if (!import_id) throw new ApiError(400, "import_id wajib diisi");

        const result = await SalesImportService.getPreview(import_id);
        return ApiResponse.sendSuccess(c, result, 200);
    }
}
