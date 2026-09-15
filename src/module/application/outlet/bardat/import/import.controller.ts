import { Context } from "hono";
import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";
import { GetUploadedFile } from "../../../../../lib/get.file.js";
import { ApiResponse } from "../../../../../lib/api.response.js";
import { ApiError } from "../../../../../lib/errors/api.error.js";
import { BardatCell, BardatMatrix, RequestBardatExecuteDTO } from "./import.schema.js";
import { BardatService } from "./import.service.js";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function parseXlsx(buffer: Buffer<ArrayBufferLike>): Promise<BardatMatrix> {
    const workbook = new ExcelJS.Workbook();
    // reason: ExcelJS's Node typings omit Buffer even though load() accepts it at runtime.
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new ApiError(400, "Sheet BARDAT tidak ditemukan");
    const matrix: BardatMatrix = [];
    sheet.eachRow((row, rowNumber) => {
        const values: BardatCell[] = [];
        for (let col = 1; col <= sheet.columnCount; col += 1) {
            const cell = row.getCell(col);
            const value = cell.value;
            const resolvedValue = value && typeof value === "object" && "result" in value
                ? value.result
                : value;
            values.push(resolvedValue instanceof Date || typeof resolvedValue === "string" || typeof resolvedValue === "number" ? resolvedValue : null);
        }
        if (rowNumber > 0) matrix.push(values);
    });
    return matrix;
}

function parseCsv(buffer: Buffer): BardatMatrix {
    const raw = parse(buffer, { skip_empty_lines: false, relax_column_count: true, bom: true }) as string[][];
    return raw.map((row) => row.map((cell): BardatCell => cell === "" ? null : cell));
}

function importIdFromContext(c: Context): string {
    const importId = c.req.param("import_id");
    if (!importId || !UUID_RE.test(importId)) throw new ApiError(400, "Import ID tidak valid");
    return importId;
}

export class BardatController {
    static async preview(c: Context) {
        const { buffer, mimetype, filename } = await GetUploadedFile(c);
        const matrix = mimetype === XLSX_MIME || filename.toLowerCase().endsWith(".xlsx")
            ? await parseXlsx(buffer)
            : parseCsv(buffer);
        return ApiResponse.sendSuccess(c, await BardatService.preview(matrix), 201);
    }

    static async getPreview(c: Context) {
        return ApiResponse.sendSuccess(c, await BardatService.getPreview(importIdFromContext(c)), 200);
    }

    static async execute(c: Context) {
        const body = c.get("body") as RequestBardatExecuteDTO;
        return ApiResponse.sendSuccess(c, await BardatService.execute(body.import_id), 200);
    }
}
