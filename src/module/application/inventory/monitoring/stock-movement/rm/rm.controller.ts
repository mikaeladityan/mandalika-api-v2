import { Context } from "hono";
import { StockMovementRMService } from "./rm.service.js";
import {
    QueryStockMovementRMSchema,
    ResponseStockMovementRMDTO,
} from "./rm.schema.js";
import { ApiResponse } from "../../../../../../lib/api.response.js";
import { buildCsv, CsvColumn } from "../../_shared/csv.helpers.js";

const EXPORT_COLUMNS: CsvColumn<ResponseStockMovementRMDTO>[] = [
    { header: "ID",                 value: (r) => r.id },
    { header: "Entity ID",          value: (r) => r.entity_id },
    { header: "Barcode",            value: (r) => r.barcode },
    { header: "Nama Bahan Baku",    value: (r) => r.rm_name },
    { header: "Kategori",           value: (r) => r.category },
    { header: "Satuan",             value: (r) => r.unit },
    { header: "Tipe Material",      value: (r) => r.material_type },
    { header: "Location ID",        value: (r) => r.location_id },
    { header: "Location Name",      value: (r) => r.location_name },
    { header: "Movement Type",      value: (r) => r.movement_type },
    { header: "Quantity",           value: (r) => r.quantity },
    { header: "Qty Before",         value: (r) => r.qty_before },
    { header: "Qty After",          value: (r) => r.qty_after },
    { header: "Reference ID",       value: (r) => r.reference_id },
    { header: "Reference Type",     value: (r) => r.reference_type },
    { header: "Reference Code",     value: (r) => r.reference_code },
    { header: "Destination/Source", value: (r) => r.destination_name },
    { header: "Created By",         value: (r) => r.created_by },
    { header: "Created At",         value: (r) => r.created_at.toISOString() },
];

export class StockMovementRMController {
    static async list(c: Context) {
        const query  = QueryStockMovementRMSchema.parse(c.req.query());
        const result = await StockMovementRMService.list(query);
        return ApiResponse.sendSuccess(c, result, 200, query);
    }

    static async export(c: Context) {
        const query = QueryStockMovementRMSchema.parse(c.req.query());
        const data  = await StockMovementRMService.export(query);

        if (data.length === 0) {
            return ApiResponse.sendSuccess(c, { message: "Tidak ada data untuk di-export" }, 200);
        }

        const csv      = buildCsv(data, EXPORT_COLUMNS);
        const filename = `stock-movement-rm-${new Date().toISOString().slice(0, 10)}.csv`;

        return new Response(csv, {
            status:  200,
            headers: {
                "Content-Type":        "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="${filename}"`,
            },
        });
    }
}
