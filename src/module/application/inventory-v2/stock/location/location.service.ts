import prisma from "../../../../../config/prisma.js";
import { GENDER, Prisma, WarehouseType } from "../../../../../generated/prisma/client.js";
import { GetPagination } from "../../../../../lib/utils/pagination.js";
import { QueryLocationDTO } from "./location.schema.js";

const SORT_COLUMN_MAP: { [key: string]: Prisma.Sql | undefined } = {
    updated_at: Prisma.sql`p.updated_at`,
    name: Prisma.sql`p.name`,
    code: Prisma.sql`p.code`,
    size: Prisma.sql`ps.size`,
    type: Prisma.sql`pt.name`,
    total_stock: Prisma.sql`total_stock`,
};

type LocationRow = {
    code: string;
    name: string;
    type: string;
    size: number | string | Prisma.Decimal;
    gender: GENDER;
    uom: string;
    total_stock: number | string | Prisma.Decimal;
    location_stocks: Record<string, number | string | Prisma.Decimal> | null;
};

export class LocationService {
    static async listStockLocation(query: QueryLocationDTO) {
        const {
            page = 1,
            take = 50,
            search,
            sortBy = "total_stock",
            sortOrder = "desc",
            type_id,
            gender,
        } = query;

        const { skip, take: limit } = GetPagination(Number(page), Number(take));

        const conditions: Prisma.Sql[] = [];
        if (type_id) conditions.push(Prisma.sql`p.type_id = ${type_id}`);
        if (gender) conditions.push(Prisma.sql`p.gender = CAST(${gender} AS "GENDER")`);
        if (search) {
            const pattern = `%${search}%`;
            conditions.push(Prisma.sql`(p.name ILIKE ${pattern} OR p.code ILIKE ${pattern})`);
        }

        const whereClause =
            conditions.length > 0
                ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
                : Prisma.empty;

        const direction = sortOrder.toLowerCase() === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
        const column = SORT_COLUMN_MAP[sortBy] ?? Prisma.sql`p.updated_at`;
        const orderByClause = Prisma.sql`ORDER BY ${column} ${direction}`;

        const now = new Date();
        const currentMonth = now.getMonth() + 1;
        const currentYear = now.getFullYear();

        const [countResult, productsResult] = await Promise.all([
            prisma.$queryRaw<{ total: bigint }[]>`
                SELECT COUNT(*)::bigint AS total FROM products p ${whereClause}
            `,
            prisma.$queryRaw<LocationRow[]>`
                SELECT
                    p.code,
                    p.name,
                    COALESCE(pt.name, 'Unknown') AS type,
                    COALESCE(ps.size, 0) AS size,
                    p.gender::text AS gender,
                    COALESCE(u.name, 'Unknown') AS uom,
                    (
                        COALESCE(SUM(inv.qty), 0) + COALESCE(SUM(out_inv.qty), 0)
                    ) as total_stock,
                    (
                        SELECT JSONB_OBJECT_AGG(name, qty) FROM (
                            SELECT w.name, pi.quantity as qty
                            FROM product_inventories pi
                            JOIN warehouses w ON pi.warehouse_id = w.id
                            WHERE pi.product_id = p.id
                              AND pi.month = ${currentMonth} AND pi.year = ${currentYear}
                            UNION ALL
                            SELECT o.name, oi.quantity as qty
                            FROM outlet_inventories oi
                            JOIN outlets o ON oi.outlet_id = o.id
                            WHERE oi.product_id = p.id
                              AND oi.month = ${currentMonth}
                              AND oi.year  = ${currentYear}
                        ) sub WHERE qty > 0
                    ) as location_stocks
                FROM products p
                LEFT JOIN product_types pt ON p.type_id = pt.id
                LEFT JOIN unit_of_materials u ON p.unit_id = u.id
                LEFT JOIN product_size ps ON p.size_id = ps.id
                LEFT JOIN (
                    SELECT product_id, SUM(quantity) as qty
                    FROM product_inventories
                    WHERE month = ${currentMonth} AND year = ${currentYear}
                    GROUP BY product_id
                ) inv ON inv.product_id = p.id
                LEFT JOIN (
                    SELECT product_id, SUM(quantity) as qty
                    FROM outlet_inventories
                    WHERE month = ${currentMonth} AND year = ${currentYear}
                    GROUP BY product_id
                ) out_inv ON out_inv.product_id = p.id
                ${whereClause}
                GROUP BY p.id, pt.name, u.name, ps.size
                ${orderByClause}
                LIMIT ${limit} OFFSET ${skip}
            `,
        ]);

        return {
            len: Number(countResult[0]?.total ?? 0),
            data: productsResult.map((p) => ({
                code: p.code,
                name: p.name,
                type: p.type,
                size: Number(p.size),
                gender: p.gender,
                uom: p.uom,
                total_stock: Number(p.total_stock),
                location_stocks: p.location_stocks ?? {},
            })),
        };
    }

    static async listAllLocations() {
        const [warehouses, outlets] = await Promise.all([
            prisma.warehouse.findMany({
                where: { type: WarehouseType.FINISH_GOODS, deleted_at: null },
                select: { id: true, name: true, type: true },
                orderBy: { name: "asc" },
            }),
            prisma.outlet.findMany({
                where: { deleted_at: null },
                select: { id: true, name: true },
                orderBy: { name: "asc" },
            }),
        ]);

        return [
            ...warehouses.map((w) => ({ id: w.id, name: w.name, type: "WAREHOUSE" })),
            ...outlets.map((o) => ({ id: o.id, name: o.name, type: "OUTLET" })),
        ];
    }
}
