import { Context } from "hono";
import { StockLocationService } from "./stock-location.service.js";
import { QueryStockLocationSchema } from "./stock-location.schema.js";
import { ApiResponse } from "../../../../../lib/api.response.js";

export class StockLocationController {
    static async list(c: Context) {
        const query  = QueryStockLocationSchema.parse(c.req.query());
        const result = await StockLocationService.list(query);
        return ApiResponse.sendSuccess(c, result, 200, query);
    }

    static async listAvailableLocations(c: Context) {
        const result = await StockLocationService.listAvailableLocations();
        return ApiResponse.sendSuccess(c, result, 200);
    }

    /** Export ke CSV */
    static async export(c: Context) {
        const query = QueryStockLocationSchema.parse(c.req.query());
        const { data, location_name } = await StockLocationService.export(query);

        if (data.length === 0) {
            return ApiResponse.sendSuccess(c, { message: "Tidak ada data untuk di-export" }, 200);
        }

        // ── Build CSV ───────────────────────────────────────────────────
        const headers = [
            "Nama Lokasi", "SKU / Code", "Nama Produk", "Tipe", "Size", "Gender", "UOM", "Quantity", "Min. Stok"
        ];

        const escape = (v: any): string => {
            if (v === null || v === undefined) return "";
            const s = String(v);
            return s.includes(",") || s.includes('"') || s.includes("\n")
                ? `"${s.replace(/"/g, '""')}"`
                : s;
        };

        const rows = data.map((item) =>
            [
                item.location_name,
                item.product_code,
                item.product_name,
                item.type,
                item.size,
                item.gender,
                item.uom,
                item.quantity,
                item.min_stock ?? "-",
            ]
                .map(escape)
                .join(","),
        );

        const csv = [headers.join(","), ...rows].join("\n");
        const filename = `stock-location-${location_name.replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.csv`;

        return new Response(csv, {
            status: 200,
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="${filename}"`,
            },
        });
    }
}
