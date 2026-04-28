import { Context } from "hono";
import { StockCardService } from "./stock-card.service.js";
import { QueryStockCardSchema } from "./stock-card.schema.js";
import { ApiResponse } from "../../../../../lib/api.response.js";

export class StockCardController {
    static async list(c: Context) {
        const query  = QueryStockCardSchema.parse(c.req.query());
        const result = await StockCardService.list(query);
        return ApiResponse.sendSuccess(c, result, 200, query);
    }

    /** Export ke CSV — stream teks dengan header Content-Disposition */
    static async export(c: Context) {
        const query = QueryStockCardSchema.parse(c.req.query());
        const data  = await StockCardService.export(query);

        if (data.length === 0) {
            return ApiResponse.sendSuccess(c, { message: "Tidak ada data untuk di-export" }, 200);
        }

        // ── Build CSV ───────────────────────────────────────────────────
        const headers = [
            "ID", "Entity Type", "Entity ID", "Product Code", "Product Name",
            "Location Type", "Location ID", "Location Name",
            "Movement Type", "Quantity", "Qty Before", "Qty After",
            "Reference ID", "Reference Type", "Reference Code", "Destination/Source", "Created By", "Created At",
        ];

        const escape = (v: any): string => {
            if (v === null || v === undefined) return "";
            const s = String(v);
            return s.includes(",") || s.includes('"') || s.includes("\n")
                ? `"${s.replace(/"/g, '""')}"`
                : s;
        };

        const rows = data.map((row) =>
            [
                row.id,
                row.entity_type,
                row.entity_id,
                row.product_code,
                row.product_name,
                row.location_type,
                row.location_id,
                row.location_name,
                row.movement_type,
                row.quantity,
                row.qty_before,
                row.qty_after,
                row.reference_id,
                row.reference_type,
                row.reference_code,
                row.destination_name,
                row.created_by,
                row.created_at.toISOString(),
            ]
                .map(escape)
                .join(","),
        );

        const csv      = [headers.join(","), ...rows].join("\n");
        const filename = `stock-card-${new Date().toISOString().slice(0, 10)}.csv`;

        return new Response(csv, {
            status:  200,
            headers: {
                "Content-Type":        "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="${filename}"`,
            },
        });
    }
}
