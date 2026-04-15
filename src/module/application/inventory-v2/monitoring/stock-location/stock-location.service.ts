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
            search,
            type_id,
            gender,
            page      = 1,
            take      = 50,
            sortBy    = "name",
            sortOrder = "asc",
        } = query;

        let activeLocationType = query.location_type;
        let activeLocationId   = query.location_id;

        // ── Default to GFG-SBY if no location provided ──────────────────
        if (!activeLocationType || !activeLocationId) {
            const defaultWh = await prisma.warehouse.findFirst({
                where:  { code: "GFG-SBY", deleted_at: null },
                select: { id: true }
            });
            if (defaultWh) {
                activeLocationType = "WAREHOUSE";
                activeLocationId   = defaultWh.id;
            } else {
                // If GFG-SBY not found, fallback to first available FG warehouse
                const fallbackWh = await prisma.warehouse.findFirst({
                    where:  { type: "FINISH_GOODS", deleted_at: null },
                    select: { id: true }
                });
                if (!fallbackWh) throw new ApiError(404, "Tidak ada lokasi (Gudang/Outlet) yang tersedia");
                activeLocationType = "WAREHOUSE";
                activeLocationId   = fallbackWh.id;
            }
        }

        const { skip, take: limit } = GetPagination(Number(page), Number(take));

        // ── Resolve location name & validate ──────────────────────────────
        let location_name = "";
        if (activeLocationType === "WAREHOUSE") {
            const warehouse = await prisma.warehouse.findFirst({
                where:  { id: activeLocationId, type: "FINISH_GOODS", deleted_at: null },
                select: { name: true },
            });
            if (!warehouse) throw new ApiError(404, "Gudang tidak ditemukan atau bukan tipe FINISH_GOODS");
            location_name = warehouse.name;
        } else {
            const outlet = await prisma.outlet.findFirst({
                where:  { id: activeLocationId, deleted_at: null },
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

        const productWhere = Prisma.sql`WHERE ${Prisma.join(productConditions, " AND ")}`;

        // ── Valid sort columns ─────────────────────────────────────────────
        const validSort: Record<string, string> = {
            name:       "p.name",
            code:       "p.code",
            quantity:   "quantity",
            updated_at: "p.updated_at",
        };
        const sortCol = validSort[sortBy] ?? "p.name";
        const sortDir = sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";

        // Separate handling to show ALL products even if no inventory record
        // By LEFT JOINing products to inventories
        const commonJoins = Prisma.sql`
            LEFT JOIN product_types  pt   ON p.type_id     = pt.id
            LEFT JOIN unit_of_materials u ON p.unit_id     = u.id
            LEFT JOIN product_size   ps   ON p.size_id     = ps.id
        `;

        // ── WAREHOUSE branch ───────────────────────────────────────────────
        if (activeLocationType === "WAREHOUSE") {
            const now   = new Date();
            const month = query.month ?? (now.getMonth() + 1);
            const year  = query.year ?? now.getFullYear();

            const [countRes, rows] = await Promise.all([
                prisma.$queryRaw<{ total: bigint }[]>`
                    SELECT COUNT(*)::bigint AS total
                    FROM products p
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
                        COALESCE(pi.quantity, 0)::numeric AS quantity,
                        NULL::numeric                AS min_stock
                    FROM products p
                    ${commonJoins}
                    LEFT JOIN product_inventories pi ON p.id = pi.product_id
                      AND pi.warehouse_id = ${activeLocationId}
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
                FROM products p
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
                    COALESCE(oi.quantity, 0)::numeric AS quantity,
                    COALESCE(oi.min_stock, 0)::numeric AS min_stock
                FROM products p
                ${commonJoins}
                LEFT JOIN outlet_inventories oi ON p.id = oi.product_id
                  AND oi.outlet_id = ${activeLocationId}
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
