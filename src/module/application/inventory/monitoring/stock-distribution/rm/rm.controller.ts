import { Context } from "hono";
import { StockDistributionRMService } from "./rm.service.js";
import { QueryStockDistributionRMSchema } from "./rm.schema.js";
import { ApiResponse } from "../../../../../../lib/api.response.js";
import { buildDynamicCsv } from "../../_shared/csv.helpers.js";

export class StockDistributionRMController {
    static async list(c: Context) {
        const query = QueryStockDistributionRMSchema.parse(c.req.query());
        const result = await StockDistributionRMService.list(query);
        return ApiResponse.sendSuccess(c, result, 200, query);
    }

    static async listLocations(c: Context) {
        const result = await StockDistributionRMService.listLocations();
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async export(c: Context) {
        const query = QueryStockDistributionRMSchema.parse(c.req.query());
        const data = await StockDistributionRMService.export(query);

        if (data.length === 0) {
            return ApiResponse.sendSuccess(c, { message: "Tidak ada data untuk di-export" }, 200);
        }

        const locations = await StockDistributionRMService.listLocations();
        const locationNames = locations.map((l) => l.name);

        const csv = buildDynamicCsv(
            data,
            [
                { header: "Nama Bahan Baku", value: (r) => r.name },
                { header: "Kategori",        value: (r) => r.category },
                { header: "Satuan",          value: (r) => r.unit },
                { header: "Tipe Material",   value: (r) => r.material_type ?? "" },
                { header: "Min Stock",       value: (r) => r.min_stock ?? "" },
                { header: "Total Stok",      value: (r) => r.total_stock },
            ],
            locationNames,
            (r, name) => r.location_stocks[name] ?? 0,
        );

        const filename = `stock-distribution-rm-${new Date().toISOString().slice(0, 10)}.csv`;
        return new Response(csv, {
            status: 200,
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="${filename}"`,
            },
        });
    }
}
