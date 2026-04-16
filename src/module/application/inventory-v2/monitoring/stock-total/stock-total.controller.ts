import { Context } from "hono";
import { StockTotalService } from "./stock-total.service.js";
import { QueryStockTotalSchema } from "./stock-total.schema.js";
import { ApiResponse } from "../../../../../lib/api.response.js";

export class StockTotalController {
    /** Export ke CSV */
    static async export(c: Context) {
        const query = QueryStockTotalSchema.parse(c.req.query());
        const data = await StockTotalService.export(query);

        if (data.length === 0) {
            return ApiResponse.sendSuccess(c, { message: "Tidak ada data untuk di-export" }, 200);
        }

        // Get active locations to build dynamic columns
        const locations = await StockTotalService.listLocations();

        // ── Build CSV ───────────────────────────────────────────────────
        const baseHeaders = ["SKU / Code", "Nama Produk", "Tipe", "Size", "Gender", "UOM", "Total Stok", "Total Hilang"];
        const dynamicHeaders = locations.map(l => l.name);
        const headers = [...baseHeaders, ...dynamicHeaders];

        const escape = (v: any): string => {
            if (v === null || v === undefined) return "";
            const s = String(v);
            return s.includes(",") || s.includes('"') || s.includes("\n")
                ? `"${s.replace(/"/g, '""')}"`
                : s;
        };

        const rows = data.map((row) => {
            const rowBaseData = [
                row.code,
                row.name,
                row.type,
                row.size,
                row.gender,
                row.uom,
                row.total_stock,
                row.total_missing,
            ];

            const rowDynamicData = locations.map(l => row.location_stocks[l.name] ?? 0);
            return [...rowBaseData, ...rowDynamicData].map(escape).join(",");
        });

        const csv = [headers.join(","), ...rows].join("\n");
        const filename = `stock-total-${new Date().toISOString().slice(0, 10)}.csv`;

        return new Response(csv, {
            status: 200,
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="${filename}"`,
            },
        });
    }

    static async list(c: Context) {
        const query  = QueryStockTotalSchema.parse(c.req.query());
        const result = await StockTotalService.list(query);
        return ApiResponse.sendSuccess(c, result, 200, query);
    }

    static async listLocations(c: Context) {
        const result = await StockTotalService.listLocations();
        return ApiResponse.sendSuccess(c, result, 200);
    }
}
