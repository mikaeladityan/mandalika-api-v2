import { Context } from "hono";
import { StockLocationRMService } from "./rm.service.js";
import { QueryStockLocationRMSchema } from "./rm.schema.js";
import { ApiResponse } from "../../../../../../lib/api.response.js";
import { buildCsv } from "../../_shared/csv.helpers.js";

export class StockLocationRMController {
    static async list(c: Context) {
        const query  = QueryStockLocationRMSchema.parse(c.req.query());
        const result = await StockLocationRMService.list(query);
        return ApiResponse.sendSuccess(c, result, 200, query);
    }

    static async listAvailableLocations(c: Context) {
        const result = await StockLocationRMService.listAvailableLocations();
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async export(c: Context) {
        const query = QueryStockLocationRMSchema.parse(c.req.query());
        const { data, location_name } = await StockLocationRMService.export(query);

        if (data.length === 0) {
            return ApiResponse.sendSuccess(c, { message: "Tidak ada data untuk di-export" }, 200);
        }

        const csv = buildCsv(data, [
            { header: "Nama Lokasi",     value: (r) => r.location_name },
            { header: "Nama Bahan Baku", value: (r) => r.name },
            { header: "Kategori",        value: (r) => r.category },
            { header: "Satuan",          value: (r) => r.unit },
            { header: "Tipe Material",   value: (r) => r.material_type ?? "" },
            { header: "Quantity",        value: (r) => r.quantity },
            { header: "Min. Stok",       value: (r) => r.min_stock ?? "-" },
        ]);

        const filename = `stock-location-rm-${location_name.replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.csv`;
        return new Response(csv, {
            status: 200,
            headers: {
                "Content-Type":        "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="${filename}"`,
            },
        });
    }
}
