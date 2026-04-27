import { Prisma } from "../../../../../generated/prisma/client.js";
import prisma from "../../../../../config/prisma.js";
import { GetPagination } from "../../../../../lib/utils/pagination.js";
import { EXPORT_ROW_LIMIT } from "../../../shared/inventory.constants.js";
import {
    QueryStockTotalDTO,
    ResponseStockTotalDTO,
    ResponseStockTotalLocationDTO,
} from "./stock-total.schema.js";

export class StockTotalService {
    /**
     * Global stock view: gabungan ProductInventory (semua gudang FG) + OutletInventory (semua toko).
     * Setiap baris produk memiliki kolom dinamis per lokasi di `location_stocks`.
     */
    static async list(query: QueryStockTotalDTO): Promise<{
        data: ResponseStockTotalDTO[];
        len: number;
    }> {
        const {
            page      = 1,
            take      = 50,
            search,
            type_id,
            gender,
            sortBy    = "updated_at",
            sortOrder = "desc",
        } = query;

        const { skip, take: limit } = GetPagination(Number(page), Number(take));

        const now          = new Date();
        const currentMonth = now.getMonth() + 1;
        const currentYear  = now.getFullYear();

        // ── Filters ────────────────────────────────────────────────────────
        const conditions: Prisma.Sql[] = [
            Prisma.sql`p.deleted_at IS NULL`,
        ];

        if (type_id) {
            conditions.push(Prisma.sql`p.type_id = ${type_id}`);
        }
        if (gender) {
            conditions.push(Prisma.sql`p.gender = CAST(${gender} AS "GENDER")`);
        }
        if (search) {
            const pattern = `%${search}%`;
            conditions.push(Prisma.sql`(p.name ILIKE ${pattern} OR p.code ILIKE ${pattern})`);
        }

        const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;

        // ── Sorting ────────────────────────────────────────────────────────
        const validSortColumns: Record<string, string> = {
            updated_at:  "p.updated_at",
            name:        "p.name",
            code:        "p.code",
            size:        "ps.size",
            type:        "pt.name",
            total_stock: "total_stock",
        };
        const sortCol = validSortColumns[sortBy] ?? "p.updated_at";
        const sortDir = sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";

        const [countResult, rows] = await Promise.all([
            prisma.$queryRaw<{ total: bigint }[]>`
                SELECT COUNT(*)::bigint AS total
                FROM products p
                ${whereClause}
            `,
            prisma.$queryRaw<any[]>`
                SELECT
                    p.code,
                    p.name,
                    COALESCE(pt.name, 'Unknown')   AS type,
                    COALESCE(ps.size, 0)::int       AS size,
                    p.gender::text                  AS gender,
                    COALESCE(u.name, 'Unknown')     AS uom,
                    (
                        COALESCE(wh_agg.total_qty, 0) +
                        COALESCE(out_agg.total_qty, 0)
                    )::numeric                      AS total_stock,
                    COALESCE(miss_agg.total_qty, 0)::numeric AS total_missing,
                    (
                        SELECT JSONB_OBJECT_AGG(loc_name, loc_qty)
                        FROM (
                            -- Per gudang FG
                            SELECT w.name AS loc_name, SUM(pi.quantity)::numeric AS loc_qty
                            FROM product_inventories pi
                            JOIN warehouses w ON pi.warehouse_id = w.id
                            WHERE pi.product_id = p.id
                              AND pi.month = ${currentMonth}
                              AND pi.year  = ${currentYear}
                              AND w.type   = 'FINISH_GOODS'
                              AND w.deleted_at IS NULL
                            GROUP BY w.name
                            UNION ALL
                            -- Per toko aktif
                            SELECT o.name AS loc_name, oi.quantity::numeric AS loc_qty
                            FROM outlet_inventories oi
                            JOIN outlets o ON oi.outlet_id = o.id
                            WHERE oi.product_id = p.id
                              AND o.deleted_at IS NULL
                        ) locs
                        WHERE loc_qty > 0
                    ) AS location_stocks
                FROM products p
                LEFT JOIN product_types       pt    ON p.type_id  = pt.id
                LEFT JOIN unit_of_materials   u     ON p.unit_id  = u.id
                LEFT JOIN product_size        ps    ON p.size_id  = ps.id
                -- aggregate warehouse qty for total
                LEFT JOIN (
                    SELECT product_id, SUM(quantity)::numeric AS total_qty
                    FROM product_inventories
                    WHERE month = ${currentMonth} AND year = ${currentYear}
                    GROUP BY product_id
                ) wh_agg ON wh_agg.product_id = p.id
                -- aggregate outlet qty for total
                LEFT JOIN (
                    SELECT product_id, SUM(quantity)::numeric AS total_qty
                    FROM outlet_inventories
                    GROUP BY product_id
                ) out_agg ON out_agg.product_id = p.id
                -- aggregate missing qty from transfers (DO / TG) — excludes cancelled
                LEFT JOIN (
                    SELECT sti.product_id, SUM(sti.quantity_missing)::numeric AS total_qty
                    FROM stock_transfer_items sti
                    JOIN stock_transfers st ON st.id = sti.transfer_id
                    WHERE sti.quantity_missing > 0
                      AND st.status != 'CANCELLED'
                    GROUP BY sti.product_id
                ) miss_agg ON miss_agg.product_id = p.id
                ${whereClause}
                GROUP BY p.id, pt.name, u.name, ps.size,
                         wh_agg.total_qty, out_agg.total_qty, miss_agg.total_qty
                ORDER BY ${Prisma.raw(`${sortCol} ${sortDir}`)}
                LIMIT ${limit} OFFSET ${skip}
            `,
        ]);

        return {
            len:  Number(countResult[0]?.total ?? 0),
            data: rows.map((r) => ({
                code:            r.code,
                name:            r.name,
                type:            r.type,
                size:            Number(r.size),
                gender:          r.gender,
                uom:             r.uom,
                total_stock:     Number(r.total_stock    ?? 0),
                total_missing:   Number(r.total_missing  ?? 0),
                location_stocks: (r.location_stocks as Record<string, number>) ?? {},
            })),
        };
    }

    /**
     * Dropdown semua lokasi aktif: Gudang FG + Toko.
     */
    static async listLocations(): Promise<ResponseStockTotalLocationDTO[]> {
        const [warehouses, outlets] = await Promise.all([
            prisma.warehouse.findMany({
                where:   { type: "FINISH_GOODS", deleted_at: null },
                select:  { id: true, name: true },
                orderBy: { name: "asc" },
            }),
            prisma.outlet.findMany({
                where:   { deleted_at: null },
                select:  { id: true, name: true },
                orderBy: { name: "asc" },
            }),
        ]);

        return [
            ...warehouses.map((w) => ({ id: w.id, name: w.name, type: "WAREHOUSE" as const })),
            ...outlets.map((o)    => ({ id: o.id, name: o.name, type: "OUTLET"    as const })),
        ];
    }

    /**
     * Export all products within active search criteria (up to EXPORT_ROW_LIMIT).
     */
    static async export(query: QueryStockTotalDTO): Promise<ResponseStockTotalDTO[]> {
        const { data } = await this.list({ ...query, take: EXPORT_ROW_LIMIT, page: 1 });
        return data;
    }
}
