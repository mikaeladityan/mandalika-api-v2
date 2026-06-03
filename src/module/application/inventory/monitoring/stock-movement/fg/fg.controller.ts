import { Context } from "hono";
import { StockMovementFGService } from "./fg.service.js";
import {
    QueryStockMovementFGSchema,
    ResponseStockMovementFGDTO,
} from "./fg.schema.js";
import { ApiResponse } from "../../../../../../lib/api.response.js";
import { buildCsv, CsvColumn } from "../../_shared/csv.helpers.js";

const EXPORT_COLUMNS: CsvColumn<ResponseStockMovementFGDTO>[] = [
    { header: "ID",                 value: (r) => r.id },
    { header: "Entity ID",          value: (r) => r.entity_id },
    { header: "Product Code",       value: (r) => r.product_code },
    { header: "Product Name",       value: (r) => r.product_name },
    { header: "Category",           value: (r) => r.category },
    { header: "Size",               value: (r) => r.size },
    { header: "Gender",             value: (r) => r.gender },
    { header: "Location Type",      value: (r) => r.location_type },
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

export class StockMovementFGController {
    static async list(c: Context) {
        const query  = QueryStockMovementFGSchema.parse(c.req.query());
        const result = await StockMovementFGService.list(query);
        return ApiResponse.sendSuccess(c, result, 200, query);
    }

    static async export(c: Context) {
        const query = QueryStockMovementFGSchema.parse(c.req.query());
        const data  = await StockMovementFGService.export(query);

        if (data.length === 0) {
            return ApiResponse.sendSuccess(c, { message: "Tidak ada data untuk di-export" }, 200);
        }

        const csv      = buildCsv(data, EXPORT_COLUMNS);
        const filename = `stock-movement-fg-${new Date().toISOString().slice(0, 10)}.csv`;

        return new Response(csv, {
            status:  200,
            headers: {
                "Content-Type":        "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="${filename}"`,
            },
        });
    }
}
