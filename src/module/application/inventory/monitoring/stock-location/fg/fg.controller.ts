import { Context } from "hono";
import { StockLocationFGService } from "./fg.service.js";
import { QueryStockLocationFGSchema } from "./fg.schema.js";
import { ApiResponse } from "../../../../../../lib/api.response.js";
import { buildCsv } from "../../_shared/csv.helpers.js";

export class StockLocationFGController {
    static async list(c: Context) {
        const query  = QueryStockLocationFGSchema.parse(c.req.query());
        const result = await StockLocationFGService.list(query);
        return ApiResponse.sendSuccess(c, result, 200, query);
    }

    static async listAvailableLocations(c: Context) {
        const result = await StockLocationFGService.listAvailableLocations();
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async export(c: Context) {
        const query = QueryStockLocationFGSchema.parse(c.req.query());
        const { data, location_name } = await StockLocationFGService.export(query);

        if (data.length === 0) {
            return ApiResponse.sendSuccess(c, { message: "Tidak ada data untuk di-export" }, 200);
        }

        const csv = buildCsv(data, [
            { header: "Nama Lokasi", value: (r) => r.location_name },
            { header: "SKU / Code",  value: (r) => r.product_code },
            { header: "Nama Produk", value: (r) => r.product_name },
            { header: "Tipe",        value: (r) => r.type },
            { header: "Size",        value: (r) => r.size },
            { header: "Gender",      value: (r) => r.gender },
            { header: "UOM",         value: (r) => r.uom },
            { header: "Quantity",    value: (r) => r.quantity },
            { header: "Min. Stok",   value: (r) => r.min_stock ?? "-" },
        ]);

        const filename = `stock-location-fg-${location_name.replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.csv`;
        return new Response(csv, {
            status: 200,
            headers: {
                "Content-Type":        "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="${filename}"`,
            },
        });
    }
}
