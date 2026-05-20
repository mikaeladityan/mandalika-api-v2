import { Prisma } from "../../../../../../generated/prisma/client.js";
import prisma from "../../../../../../config/prisma.js";
import { ApiError } from "../../../../../../lib/errors/api.error.js";
import { GetPagination } from "../../../../../../lib/utils/pagination.js";
import { EXPORT_ROW_LIMIT } from "../../../../shared/inventory.constants.js";
import { resolvePeriod } from "../_shared/period.helpers.js";
import {
    QueryStockLocationRMDTO,
    ResponseStockLocationRMItemDTO,
    ResponseStockLocationRMAvailableDTO,
} from "./rm.schema.js";

const DEFAULT_PAGE = 1;
const DEFAULT_TAKE = 50;
const UNKNOWN_LABEL = "Unknown";

const SORT_COLUMN: Record<NonNullable<QueryStockLocationRMDTO["sortBy"]>, string> = {
    name:       "r.name",
    quantity:   "quantity",
    updated_at: "r.updated_at",
};

type StockLocationRMRawRow = {
    name:          string;
    category:      string;
    unit:          string;
    material_type: "FO" | "PCKG" | null;
    quantity:      Prisma.Decimal;
    min_stock:     Prisma.Decimal | null;
};

type ResolvedLocation = {
    id:            number;
    location_name: string;
};

export class StockLocationRMService {
    static async list(query: QueryStockLocationRMDTO): Promise<{
        data:          ResponseStockLocationRMItemDTO[];
        len:           number;
        location_name: string;
    }> {
        const location = await this.resolveLocation(query);
        const period   = resolvePeriod(query.month, query.year);
        const { skip, take } = GetPagination(
            Number(query.page ?? DEFAULT_PAGE),
            Number(query.take ?? DEFAULT_TAKE),
        );

        const rmWhere  = this.buildRawMaterialWhere(query);
        const orderBy  = this.buildOrderBy(query);

        const [countRes, rows] = await Promise.all([
            prisma.$queryRaw<{ total: bigint }[]>`
                SELECT COUNT(*)::bigint AS total
                FROM raw_materials r
                ${rmWhere}
            `,
            prisma.$queryRaw<StockLocationRMRawRow[]>`
                SELECT
                    r.name                                AS name,
                    COALESCE(rc.name, ${UNKNOWN_LABEL})   AS category,
                    COALESCE(ur.name, ${UNKNOWN_LABEL})   AS unit,
                    r.type::text                          AS material_type,
                    COALESCE(inv.quantity, 0)::numeric    AS quantity,
                    COALESCE(inv.min_stock, r.min_stock)::numeric AS min_stock
                FROM raw_materials r
                LEFT JOIN raw_mat_categories  rc ON r.raw_mat_categories_id = rc.id
                LEFT JOIN unit_raw_materials  ur ON r.unit_id = ur.id
                LEFT JOIN raw_material_inventories inv ON r.id = inv.raw_material_id
                  AND inv.warehouse_id = ${location.id}
                  AND inv.month        = ${period.month}
                  AND inv.year         = ${period.year}
                ${rmWhere}
                ${orderBy}
                LIMIT ${take} OFFSET ${skip}
            `,
        ]);

        return {
            len:           Number(countRes[0]?.total ?? 0),
            location_name: location.location_name,
            data:          rows.map((r) => this.toDTO(r, location.location_name)),
        };
    }

    static async listAvailableLocations(): Promise<ResponseStockLocationRMAvailableDTO[]> {
        const warehouses = await prisma.warehouse.findMany({
            where:   { type: "RAW_MATERIAL", deleted_at: null },
            select:  { id: true, name: true },
            orderBy: { name: "asc" },
        });
        return warehouses.map((w) => ({ id: w.id, name: w.name, type: "WAREHOUSE" as const }));
    }

    static async export(query: QueryStockLocationRMDTO): Promise<{
        data:          ResponseStockLocationRMItemDTO[];
        location_name: string;
    }> {
        const result = await this.list({ ...query, take: EXPORT_ROW_LIMIT, page: 1 });
        if (result.len > EXPORT_ROW_LIMIT) {
            throw new ApiError(
                400,
                `Hasil melebihi batas export (${EXPORT_ROW_LIMIT} baris). Persempit filter terlebih dahulu.`,
            );
        }
        return result;
    }

    private static async resolveLocation(query: QueryStockLocationRMDTO): Promise<ResolvedLocation> {
        if (query.location_id) {
            const wh = await prisma.warehouse.findFirst({
                where:  { id: query.location_id, type: "RAW_MATERIAL", deleted_at: null },
                select: { name: true },
            });
            if (!wh) throw new ApiError(404, "Gudang tidak ditemukan atau bukan tipe RAW_MATERIAL");
            return { id: query.location_id, location_name: wh.name };
        }

        const defaultWh = await prisma.warehouse.findFirst({
            where:   { type: "RAW_MATERIAL", deleted_at: null },
            select:  { id: true, name: true },
            orderBy: { id: "asc" },
        });
        if (!defaultWh) throw new ApiError(404, "Tidak ada gudang RAW_MATERIAL yang tersedia");
        return { id: defaultWh.id, location_name: defaultWh.name };
    }

    private static buildRawMaterialWhere(query: QueryStockLocationRMDTO): Prisma.Sql {
        const conditions: Prisma.Sql[] = [Prisma.sql`r.deleted_at IS NULL`];
        if (query.category_id) conditions.push(Prisma.sql`r.raw_mat_categories_id = ${query.category_id}`);
        if (query.material_type) {
            conditions.push(Prisma.sql`r.type = CAST(${query.material_type} AS "MaterialType")`);
        }
        if (query.search) {
            const pat = `%${query.search}%`;
            conditions.push(Prisma.sql`r.name ILIKE ${pat}`);
        }
        return Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;
    }

    private static buildOrderBy(query: QueryStockLocationRMDTO): Prisma.Sql {
        const col = SORT_COLUMN[query.sortBy ?? "name"] ?? SORT_COLUMN.name;
        const dir = (query.sortOrder ?? "asc").toUpperCase() === "ASC" ? "ASC" : "DESC";
        return Prisma.sql`ORDER BY ${Prisma.raw(col)} ${Prisma.raw(dir)}`;
    }

    private static toDTO(r: StockLocationRMRawRow, location_name: string): ResponseStockLocationRMItemDTO {
        return {
            name:          r.name,
            category:      r.category,
            unit:          r.unit,
            material_type: r.material_type,
            quantity:      Number(r.quantity),
            min_stock:     r.min_stock != null ? Number(r.min_stock) : null,
            location_name,
        };
    }
}
