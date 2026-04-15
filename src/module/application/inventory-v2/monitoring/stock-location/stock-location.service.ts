import { Prisma } from "../../../../../generated/prisma/client.js";
import prisma from "../../../../../config/prisma.js";
import { ApiError } from "../../../../../lib/errors/api.error.js";
import { GetPagination } from "../../../../../lib/utils/pagination.js";
import {
    QueryStockLocationDTO,
    ResponseStockLocationItemDTO,
    ResponseAvailableLocationDTO,
} from "./stock-location.schema.js";

export class StockLocationService {
    /**
     * Stok produk di satu lokasi spesifik.
     * @param query.location_type  "WAREHOUSE" atau "OUTLET"
     * @param query.location_id    ID gudang atau toko
     */
    static async list(query: QueryStockLocationDTO): Promise<{
        data:          ResponseStockLocationItemDTO[];
        len:           number;
        location_name: string;
    }> {
        const {
            location_type,
            location_id,
            search,
            type_id,
            gender,
            page      = 1,
            take      = 50,
            sortBy    = "name",
            sortOrder = "asc",
        } = query;

        const { skip, take: limit } = GetPagination(Number(page), Number(take));

        // ── Resolve location name & validate ──────────────────────────────
        let location_name = "";
        if (location_type === "WAREHOUSE") {
            const warehouse = await prisma.warehouse.findFirst({
                where:  { id: location_id, type: "FINISH_GOODS", deleted_at: null },
                select: { name: true },
            });
            if (!warehouse) throw new ApiError(404, "Gudang tidak ditemukan atau bukan tipe FINISH_GOODS");
            location_name = warehouse.name;
        } else {
            const outlet = await prisma.outlet.findFirst({
                where:  { id: location_id, deleted_at: null },
                select: { name: true },
            });
            if (!outlet) throw new ApiError(404, "Outlet tidak ditemukan");
            location_name = outlet.name;
        }

        // ── Shared product filters ─────────────────────────────────────────
        const productConditions: Prisma.Sql[] = [
            Prisma.sql`p.deleted_at IS NULL`,
        ];
        if (type_id) productConditions.push(Prisma.sql`p.type_id = ${type_id}`);
        if (gender)  productConditions.push(Prisma.sql`p.gender = CAST(${gender} AS "GENDER")`);
        if (search) {
            const pat = `%${search}%`;
            productConditions.push(Prisma.sql`(p.name ILIKE ${pat} OR p.code ILIKE ${pat})`);
        }

        const productWhere = Prisma.sql`AND ${Prisma.join(productConditions, " AND ")}`;

        // ── Valid sort columns ─────────────────────────────────────────────
        const validSort: Record<string, string> = {
            name:       "p.name",
            code:       "p.code",
            quantity:   "quantity",
            updated_at: "p.updated_at",
        };
        const sortCol = validSort[sortBy] ?? "p.name";
        const sortDir = sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";

        // ── WAREHOUSE branch ───────────────────────────────────────────────
        if (location_type === "WAREHOUSE") {
            const now   = new Date();
            const month = now.getMonth() + 1;
            const year  = now.getFullYear();

            const [countRes, rows] = await Promise.all([
                prisma.$queryRaw<{ total: bigint }[]>`
                    SELECT COUNT(*)::bigint AS total
                    FROM product_inventories pi
                    JOIN products p               ON pi.product_id  = p.id
                    WHERE pi.warehouse_id = ${location_id}
                      AND pi.month        = ${month}
                      AND pi.year         = ${year}
                      ${productWhere}
                `,
                prisma.$queryRaw<any[]>`
                    SELECT
                        p.code                       AS product_code,
                        p.name                       AS product_name,
                        COALESCE(pt.name, 'Unknown') AS type,
                        COALESCE(ps.size, 0)::int    AS size,
                        p.gender::text               AS gender,
                        COALESCE(u.name, 'Unknown')  AS uom,
                        pi.quantity::numeric          AS quantity,
                        NULL::numeric                AS min_stock
                    FROM product_inventories pi
                    JOIN products p               ON pi.product_id = p.id
                    LEFT JOIN product_types  pt   ON p.type_id     = pt.id
                    LEFT JOIN unit_of_materials u ON p.unit_id     = u.id
                    LEFT JOIN product_size   ps   ON p.size_id     = ps.id
                    WHERE pi.warehouse_id = ${location_id}
                      AND pi.month        = ${month}
                      AND pi.year         = ${year}
                      ${productWhere}
                    ORDER BY ${Prisma.raw(`${sortCol} ${sortDir}`)}
                    LIMIT ${limit} OFFSET ${skip}
                `,
            ]);

            return {
                len:  Number(countRes[0]?.total ?? 0),
                location_name,
                data: rows.map((r) => StockLocationService.mapRow(r, location_name)),
            };
        }

        // ── OUTLET branch ──────────────────────────────────────────────────
        const [countRes, rows] = await Promise.all([
            prisma.$queryRaw<{ total: bigint }[]>`
                SELECT COUNT(*)::bigint AS total
                FROM outlet_inventories oi
                JOIN products p               ON oi.product_id = p.id
                WHERE oi.outlet_id = ${location_id}
                  ${productWhere}
            `,
            prisma.$queryRaw<any[]>`
                SELECT
                    p.code                       AS product_code,
                    p.name                       AS product_name,
                    COALESCE(pt.name, 'Unknown') AS type,
                    COALESCE(ps.size, 0)::int    AS size,
                    p.gender::text               AS gender,
                    COALESCE(u.name, 'Unknown')  AS uom,
                    oi.quantity::numeric          AS quantity,
                    oi.min_stock::numeric         AS min_stock
                FROM outlet_inventories oi
                JOIN products p               ON oi.product_id = p.id
                LEFT JOIN product_types  pt   ON p.type_id     = pt.id
                LEFT JOIN unit_of_materials u ON p.unit_id     = u.id
                LEFT JOIN product_size   ps   ON p.size_id     = ps.id
                WHERE oi.outlet_id = ${location_id}
                  ${productWhere}
                ORDER BY ${Prisma.raw(`${sortCol} ${sortDir}`)}
                LIMIT ${limit} OFFSET ${skip}
            `,
        ]);

        return {
            len:  Number(countRes[0]?.total ?? 0),
            location_name,
            data: rows.map((r) => StockLocationService.mapRow(r, location_name)),
        };
    }

    /**
     * Dropdown semua lokasi tersedia: Gudang FG + Toko aktif.
     */
    static async listAvailableLocations(): Promise<ResponseAvailableLocationDTO[]> {
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

    private static mapRow(r: any, location_name: string): ResponseStockLocationItemDTO {
        return {
            product_code:  r.product_code,
            product_name:  r.product_name,
            type:          r.type,
            size:          Number(r.size),
            gender:        r.gender,
            uom:           r.uom,
            quantity:      Number(r.quantity),
            min_stock:     r.min_stock != null ? Number(r.min_stock) : null,
            location_name,
        };
    }
}
