import { Context } from "hono";
import { StockDiscrepancyService } from "./stock-discrepancy.service.js";
import {
    QueryStockDiscrepancySchema,
    ResponseStockDiscrepancyDTO,
} from "./stock-discrepancy.schema.js";
import { ApiResponse } from "../../../../../lib/api.response.js";
import { buildCsv, CsvColumn } from "../_shared/csv.helpers.js";

const EXPORT_COLUMNS: CsvColumn<ResponseStockDiscrepancyDTO & { _no: number; _route: string }>[] = [
    { header: "No",                value: (r) => r._no },
    { header: "No. Dokumen",       value: (r) => r.transfer_number },
    { header: "Tanggal",           value: (r) => r.transfer_date.toLocaleDateString("id-ID") },
    { header: "Rute (Asal -> Tujuan)", value: (r) => r._route },
    { header: "SKU / Code",        value: (r) => r.product_code },
    { header: "Nama Produk",       value: (r) => r.product_name },
    { header: "Qty (Requested)",   value: (r) => r.quantity_requested },
    { header: "Qty Missing",       value: (r) => r.quantity_missing },
    { header: "Qty Rejected",      value: (r) => r.quantity_rejected },
    { header: "Catatan",           value: (r) => r.notes ?? "-" },
];

export class StockDiscrepancyController {
    static async list(c: Context) {
        const query  = QueryStockDiscrepancySchema.parse(c.req.query());
        const result = await StockDiscrepancyService.list(query);
        return ApiResponse.sendSuccess(c, result, 200, query);
    }

    /** Export ke CSV (RFC 4180 + UTF-8 BOM + CRLF). */
    static async export(c: Context) {
        const query = QueryStockDiscrepancySchema.parse(c.req.query());
        const data  = await StockDiscrepancyService.export(query);

        if (data.length === 0) {
            return ApiResponse.sendSuccess(
                c,
                { message: "Tidak ada data untuk di-export" },
                200,
            );
        }

        const enriched = data.map((row, index) => ({
            ...row,
            _no:    index + 1,
            _route: `${row.from_location ?? "-"} -> ${row.to_location ?? "-"}`,
        }));

        const csv      = buildCsv(enriched, EXPORT_COLUMNS);
        const filename = `stock-discrepancy-audit-${new Date().toISOString().slice(0, 10)}.csv`;

        return new Response(csv, {
            status:  200,
            headers: {
                "Content-Type":        "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="${filename}"`,
            },
        });
    }
}
