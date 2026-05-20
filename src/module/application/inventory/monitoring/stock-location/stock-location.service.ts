import { Prisma } from "../../../../../generated/prisma/client.js";
import prisma from "../../../../../config/prisma.js";
import { ApiError } from "../../../../../lib/errors/api.error.js";
import { GetPagination } from "../../../../../lib/utils/pagination.js";
import { EXPORT_ROW_LIMIT } from "../../../shared/inventory.constants.js";
import {
    QueryStockLocationDTO,
    ResponseStockLocationItemDTO,
    ResponseAvailableLocationDTO,
} from "./stock-location.schema.js";

const DEFAULT_WAREHOUSE_CODE = "GFG-SBY";
const DEFAULT_PAGE = 1;
const DEFAULT_TAKE = 50;
const UNKNOWN_LABEL = "Unknown";

const SORT_COLUMN: Record<NonNullable<QueryStockLocationDTO["sortBy"]>, string> = {
    name:       "p.name",
    code:       "p.code",
    quantity:   "quantity",
    updated_at: "p.updated_at",
};

type StockLocationRawRow = {
    product_code: string;
    product_name: string;
    type:         string;
    size:         number;
    gender:       string;
    uom:          string;
    quantity:     Prisma.Decimal;
    min_stock:    Prisma.Decimal | null;
};

type ResolvedLocation = {
    type:          "WAREHOUSE" | "OUTLET";
    id:            number;
    location_name: string;
};

type Period = { month: number; year: number };

export class StockLocationService {
    static async list(query: QueryStockLocationDTO): Promise<{
        data:          ResponseStockLocationItemDTO[];
        len:           number;
        location_name: string;
    }> {
        const location = await StockLocationService.resolveLocation(query);
        const period   = StockLocationService.resolvePeriod(query);
        const { skip, take } = GetPagination(
            Number(query.page ?? DEFAULT_PAGE),
            Number(query.take ?? DEFAULT_TAKE),
        );

        const productWhere   = StockLocationService.buildProductWhere(query);
        const inventoryJoin  = StockLocationService.buildInventoryJoin(location, period);
        const minStockColumn = location.type === "OUTLET"
            ? Prisma.sql`COALESCE(inv.min_stock, 0)::numeric`
            : Prisma.sql`NULL::numeric`;
        const orderBy        = StockLocationService.buildOrderBy(query);

        const [countRes, rows] = await Promise.all([
            prisma.$queryRaw<{ total: bigint }[]>`
                SELECT COUNT(*)::bigint AS total
                FROM products p
                ${productWhere}
            `,
            prisma.$queryRaw<StockLocationRawRow[]>`
                SELECT
                    p.code                                AS product_code,
                    p.name                                AS product_name,
                    COALESCE(pt.name, ${UNKNOWN_LABEL})   AS type,
                    COALESCE(ps.size, 0)::int             AS size,
                    p.gender::text                        AS gender,
                    COALESCE(u.name, ${UNKNOWN_LABEL})    AS uom,
                    COALESCE(inv.quantity, 0)::numeric    AS quantity,
                    ${minStockColumn}                     AS min_stock
                FROM products p
                LEFT JOIN product_types     pt ON p.type_id = pt.id
                LEFT JOIN unit_of_materials u  ON p.unit_id = u.id
                LEFT JOIN product_size      ps ON p.size_id = ps.id
                ${inventoryJoin}
                ${productWhere}
                ${orderBy}
                LIMIT ${take} OFFSET ${skip}
            `,
        ]);

        return {
            len:           Number(countRes[0]?.total ?? 0),
            location_name: location.location_name,
            data:          rows.map((r) => StockLocationService.toDTO(r, location.location_name)),
        };
    }

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

    static async export(query: QueryStockLocationDTO): Promise<{
        data:          ResponseStockLocationItemDTO[];
        location_name: string;
    }> {
        return StockLocationService.list({ ...query, take: EXPORT_ROW_LIMIT, page: 1 });
    }

    private static async resolveLocation(query: QueryStockLocationDTO): Promise<ResolvedLocation> {
        if (query.location_type && query.location_id) {
            if (query.location_type === "WAREHOUSE") {
                const wh = await prisma.warehouse.findFirst({
                    where:  { id: query.location_id, type: "FINISH_GOODS", deleted_at: null },
                    select: { name: true },
                });
                if (!wh) throw new ApiError(404, "Gudang tidak ditemukan atau bukan tipe FINISH_GOODS");
                return { type: "WAREHOUSE", id: query.location_id, location_name: wh.name };
            }
            const outlet = await prisma.outlet.findFirst({
                where:  { id: query.location_id, deleted_at: null },
                select: { name: true },
            });
            if (!outlet) throw new ApiError(404, "Outlet tidak ditemukan");
            return { type: "OUTLET", id: query.location_id, location_name: outlet.name };
        }

        // Default ke GFG-SBY (FG); fallback ke gudang FG pertama bila GFG-SBY tidak ada/non-FG.
        const defaultWh =
            (await prisma.warehouse.findFirst({
                where:  { code: DEFAULT_WAREHOUSE_CODE, type: "FINISH_GOODS", deleted_at: null },
                select: { id: true, name: true },
            })) ??
            (await prisma.warehouse.findFirst({
                where:   { type: "FINISH_GOODS", deleted_at: null },
                select:  { id: true, name: true },
                orderBy: { id: "asc" },
            }));

        if (!defaultWh) throw new ApiError(404, "Tidak ada lokasi (Gudang/Outlet) yang tersedia");
        return { type: "WAREHOUSE", id: defaultWh.id, location_name: defaultWh.name };
    }

    private static resolvePeriod(query: QueryStockLocationDTO): Period {
        const now = new Date();
        return {
            month: query.month ?? now.getMonth() + 1,
            year:  query.year  ?? now.getFullYear(),
        };
    }

    private static buildProductWhere(query: QueryStockLocationDTO): Prisma.Sql {
        const conditions: Prisma.Sql[] = [Prisma.sql`p.deleted_at IS NULL`];
        if (query.type_id) conditions.push(Prisma.sql`p.type_id = ${query.type_id}`);
        if (query.gender)  conditions.push(Prisma.sql`p.gender = CAST(${query.gender} AS "GENDER")`);
        if (query.search) {
            const pat = `%${query.search}%`;
            conditions.push(Prisma.sql`(p.name ILIKE ${pat} OR p.code ILIKE ${pat})`);
        }
        return Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;
    }

    private static buildInventoryJoin(location: ResolvedLocation, period: Period): Prisma.Sql {
        if (location.type === "WAREHOUSE") {
            return Prisma.sql`
                LEFT JOIN product_inventories inv ON p.id = inv.product_id
                  AND inv.warehouse_id = ${location.id}
                  AND inv.month        = ${period.month}
                  AND inv.year         = ${period.year}
            `;
        }
        return Prisma.sql`
            LEFT JOIN outlet_inventories inv ON p.id = inv.product_id
              AND inv.outlet_id = ${location.id}
              AND inv.month     = ${period.month}
              AND inv.year      = ${period.year}
        `;
    }

    private static buildOrderBy(query: QueryStockLocationDTO): Prisma.Sql {
        const col = SORT_COLUMN[query.sortBy ?? "name"] ?? SORT_COLUMN.name;
        const dir = (query.sortOrder ?? "asc").toUpperCase() === "ASC" ? "ASC" : "DESC";
        return Prisma.sql`ORDER BY ${Prisma.raw(col)} ${Prisma.raw(dir)}`;
    }

    private static toDTO(r: StockLocationRawRow, location_name: string): ResponseStockLocationItemDTO {
        return {
            product_code: r.product_code,
            product_name: r.product_name,
            type:         r.type,
            size:         Number(r.size),
            gender:       r.gender,
            uom:          r.uom,
            quantity:     Number(r.quantity),
            min_stock:    r.min_stock != null ? Number(r.min_stock) : null,
            location_name,
        };
    }
}
