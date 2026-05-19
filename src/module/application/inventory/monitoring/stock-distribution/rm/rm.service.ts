import prisma from "../../../../../../config/prisma.js";
import { Prisma } from "../../../../../../generated/prisma/client.js";
import { GetPagination } from "../../../../../../lib/utils/pagination.js";
import { EXPORT_ROW_LIMIT } from "../../../../shared/inventory.constants.js";
import { resolvePeriod } from "../_shared/matrix.helpers.js";
import {
    QueryStockDistributionRMDTO,
    ResponseStockDistributionRMDTO,
    ResponseStockDistributionRMLocationDTO,
} from "./rm.schema.js";

const UNKNOWN_LABEL = "Unknown";

type Period = { month: number; year: number };
type RawMaterialRow = Prisma.RawMaterialGetPayload<{
    include: { unit_raw_material: true; raw_mat_category: true };
}>;
type RmAgg = { total: number; locs: Record<string, number> };

export class StockDistributionRMService {
    private static rmInclude() {
        return { unit_raw_material: true, raw_mat_category: true } as const;
    }

    private static buildWhere(
        search?: string,
        category_id?: number,
        material_type?: QueryStockDistributionRMDTO["material_type"],
    ): Prisma.RawMaterialWhereInput {
        return {
            deleted_at: null,
            ...(category_id ? { raw_mat_categories_id: category_id } : {}),
            ...(material_type ? { type: material_type } : {}),
            ...(search ? {
                OR: [{ name: { contains: search, mode: "insensitive" as const } }],
            } : {}),
        };
    }

    private static dbOrderBy(
        sortBy: NonNullable<QueryStockDistributionRMDTO["sortBy"]>,
        sortOrder: NonNullable<QueryStockDistributionRMDTO["sortOrder"]>,
    ): Prisma.RawMaterialOrderByWithRelationInput {
        const map: Record<string, Prisma.RawMaterialOrderByWithRelationInput> = {
            name:          { name: sortOrder },
            updated_at:    { updated_at: sortOrder },
            material_type: { type: sortOrder },
            category:      { raw_mat_category: { name: sortOrder } },
            unit:          { unit_raw_material: { name: sortOrder } },
        };
        return map[sortBy] ?? { updated_at: "desc" };
    }

    static async list(query: QueryStockDistributionRMDTO): Promise<{
        data: ResponseStockDistributionRMDTO[];
        len:  number;
    }> {
        const {
            page = 1, take = 50,
            search, category_id, material_type,
            month, year,
            sortBy = "updated_at", sortOrder = "desc",
        } = query;

        const { skip, take: limit } = GetPagination(Number(page), Number(take));
        const period = resolvePeriod(month, year);
        const where  = this.buildWhere(search, category_id, material_type);

        if (sortBy === "total_stock") {
            return this.listSortedByTotal(where, period, skip, limit, sortOrder);
        }

        const [len, rms] = await Promise.all([
            prisma.rawMaterial.count({ where }),
            prisma.rawMaterial.findMany({
                where,
                include: this.rmInclude(),
                orderBy: this.dbOrderBy(sortBy, sortOrder),
                skip,
                take: limit,
            }),
        ]);

        if (rms.length === 0) return { data: [], len };

        const data = await this.assembleMatrix(rms, period);
        return { data, len };
    }

    /**
     * Sort path for `total_stock`. Pulls all matching RM IDs first,
     * aggregates totals across them via groupBy, then slices the page
     * window so cross-page ordering is correct.
     */
    private static async listSortedByTotal(
        where: Prisma.RawMaterialWhereInput,
        period: Period,
        skip: number,
        limit: number,
        sortOrder: NonNullable<QueryStockDistributionRMDTO["sortOrder"]>,
    ): Promise<{ data: ResponseStockDistributionRMDTO[]; len: number }> {
        const allIds = (await prisma.rawMaterial.findMany({
            where, select: { id: true },
        })).map((r) => r.id);

        if (allIds.length === 0) return { data: [], len: 0 };

        const agg = await prisma.rawMaterialInventory.groupBy({
            by: ["raw_material_id"],
            where: {
                raw_material_id: { in: allIds },
                month: period.month, year: period.year,
                warehouse: { type: "RAW_MATERIAL", deleted_at: null },
            },
            _sum: { quantity: true },
        });

        const totals = new Map<number, number>(allIds.map((id) => [id, 0]));
        for (const row of agg) {
            totals.set(row.raw_material_id, Number(row._sum.quantity ?? 0));
        }

        const dir = sortOrder === "asc" ? 1 : -1;
        const pageIds = [...totals.entries()]
            .sort(([, a], [, b]) => dir * (a - b))
            .slice(skip, skip + limit)
            .map(([id]) => id);

        if (pageIds.length === 0) return { data: [], len: allIds.length };

        const rms = await prisma.rawMaterial.findMany({
            where: { id: { in: pageIds } },
            include: this.rmInclude(),
        });

        const rmById = new Map(rms.map((r) => [r.id, r]));
        const ordered = pageIds
            .map((id) => rmById.get(id))
            .filter((r): r is RawMaterialRow => Boolean(r));

        const data = await this.assembleMatrix(ordered, period);
        return { data, len: allIds.length };
    }

    /** Per-RM aggregation for the given page. Shared by both list paths. */
    private static async assembleMatrix(
        rms: RawMaterialRow[],
        period: Period,
    ): Promise<ResponseStockDistributionRMDTO[]> {
        const rmIds = rms.map((r) => r.id);

        const whRows = await prisma.rawMaterialInventory.findMany({
            where: {
                raw_material_id: { in: rmIds },
                month: period.month, year: period.year,
                warehouse: { type: "RAW_MATERIAL", deleted_at: null },
            },
            select: {
                raw_material_id: true,
                quantity: true,
                warehouse: { select: { name: true } },
            },
        });

        const byRM = new Map<number, RmAgg>();
        for (const id of rmIds) byRM.set(id, { total: 0, locs: {} });

        for (const row of whRows) {
            const entry = byRM.get(row.raw_material_id);
            if (!entry) continue;
            const qty = Number(row.quantity);
            entry.locs[row.warehouse.name] = (entry.locs[row.warehouse.name] ?? 0) + qty;
            entry.total += qty;
        }

        return rms.map((r) => {
            const agg = byRM.get(r.id)!;
            return {
                name:            r.name,
                category:        r.raw_mat_category?.name ?? UNKNOWN_LABEL,
                unit:            r.unit_raw_material?.name ?? UNKNOWN_LABEL,
                material_type:   r.type,
                min_stock:       r.min_stock !== null ? Number(r.min_stock) : null,
                total_stock:     agg.total,
                location_stocks: agg.locs,
            };
        });
    }

    static async listLocations(): Promise<ResponseStockDistributionRMLocationDTO[]> {
        const warehouses = await prisma.warehouse.findMany({
            where:   { type: "RAW_MATERIAL", deleted_at: null },
            select:  { id: true, name: true },
            orderBy: { name: "asc" },
        });
        return warehouses.map((w) => ({ id: w.id, name: w.name, type: "WAREHOUSE" as const }));
    }

    static async export(query: QueryStockDistributionRMDTO): Promise<ResponseStockDistributionRMDTO[]> {
        const { data } = await this.list({ ...query, take: EXPORT_ROW_LIMIT, page: 1 });
        return data;
    }
}
