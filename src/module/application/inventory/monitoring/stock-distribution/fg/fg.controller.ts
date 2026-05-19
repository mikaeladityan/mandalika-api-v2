import { Context } from "hono";
import { StockDistributionFGService } from "./fg.service.js";
import { QueryStockDistributionFGSchema } from "./fg.schema.js";
import { ApiResponse } from "../../../../../../lib/api.response.js";
import { buildDynamicCsv } from "../_shared/csv.helpers.js";

export class StockDistributionFGController {
    static async list(c: Context) {
        const query = QueryStockDistributionFGSchema.parse(c.req.query());
        const result = await StockDistributionFGService.list(query);
        return ApiResponse.sendSuccess(c, result, 200, query);
    }

    static async listLocations(c: Context) {
        const result = await StockDistributionFGService.listLocations();
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async export(c: Context) {
        const query = QueryStockDistributionFGSchema.parse(c.req.query());
        const data = await StockDistributionFGService.export(query);

        if (data.length === 0) {
            return ApiResponse.sendSuccess(c, { message: "Tidak ada data untuk di-export" }, 200);
        }

        const locations = await StockDistributionFGService.listLocations();
        const locationNames = locations.map((l) => l.name);

        const csv = buildDynamicCsv(
            data,
            [
                { header: "SKU / Code",   value: (r) => r.code },
                { header: "Nama Produk",  value: (r) => r.name },
                { header: "Tipe",         value: (r) => r.type },
                { header: "Size",         value: (r) => r.size },
                { header: "Gender",       value: (r) => r.gender },
                { header: "UOM",          value: (r) => r.uom },
                { header: "Total Stok",   value: (r) => r.total_stock },
                { header: "Total Hilang", value: (r) => r.total_missing },
            ],
            locationNames,
            (r, name) => r.location_stocks[name] ?? 0,
        );

        const filename = `stock-distribution-fg-${new Date().toISOString().slice(0, 10)}.csv`;
        return new Response(csv, {
            status: 200,
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="${filename}"`,
            },
        });
    }
}
