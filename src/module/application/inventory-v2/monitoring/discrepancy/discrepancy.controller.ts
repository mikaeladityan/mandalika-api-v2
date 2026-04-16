import { Context } from "hono";
import { DiscrepancyService } from "./discrepancy.service.js";
import { QueryDiscrepancySchema } from "./discrepancy.schema.js";
import { ApiResponse } from "../../../../../lib/api.response.js";

export class DiscrepancyController {
    static async list(c: Context) {
        const query = QueryDiscrepancySchema.parse(c.req.query());
        const result = await DiscrepancyService.list(query);
        return ApiResponse.sendSuccess(c, result, 200, query);
    }

    /** Export ke CSV */
    static async export(c: Context) {
        const query = QueryDiscrepancySchema.parse(c.req.query());
        const data = await DiscrepancyService.export(query);

        if (data.length === 0) {
            return ApiResponse.sendSuccess(c, { message: "Tidak ada data untuk di-export" }, 200);
        }

        // ── Build CSV ───────────────────────────────────────────────────
        const headers = [
            "No", "No. Dokumen", "Tanggal", "Rute (Asal -> Tujuan)",
            "SKU / Code", "Nama Produk", "Qty (Requested)",
            "Qty Missing", "Qty Rejected", "Catatan",
        ];

        const escape = (v: any): string => {
            if (v === null || v === undefined) return "";
            const s = String(v);
            return s.includes(",") || s.includes('"') || s.includes("\n")
                ? `"${s.replace(/"/g, '""')}"`
                : s;
        };

        const rows = data.map((item, index) => {
            const t = item.transfer;
            const p = item.product;
            const route = `${t.from_warehouse?.name ?? "-"} -> ${t.to_outlet?.name ?? t.to_warehouse?.name ?? "-"}`;

            return [
                index + 1,
                t.transfer_number,
                t.created_at ? new Date(t.created_at).toLocaleDateString("id-ID") : "-",
                route,
                p.code,
                p.name,
                item.quantity_requested,
                item.quantity_missing ?? 0,
                item.quantity_rejected ?? 0,
                item.notes ?? "-",
            ]
                .map(escape)
                .join(",");
        });

        const csv = [headers.join(","), ...rows].join("\n");
        const filename = `discrepancy-audit-${new Date().toISOString().slice(0, 10)}.csv`;

        return new Response(csv, {
            status: 200,
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="${filename}"`,
            },
        });
    }
}
