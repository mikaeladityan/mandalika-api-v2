import prisma from "../../../../../../config/prisma.js";
import { Prisma } from "../../../../../../generated/prisma/client.js";
import { GetPagination } from "../../../../../../lib/utils/pagination.js";
import { EXPORT_ROW_LIMIT } from "../../../../shared/inventory.constants.js";
import { resolvePeriod } from "../_shared/matrix.helpers.js";
import {
    QueryStockDistributionFGDTO,
    ResponseStockDistributionFGDTO,
    ResponseStockDistributionLocationDTO,
} from "./fg.schema.js";

const UNKNOWN_LABEL = "Unknown";

type Period = { month: number; year: number };
type ProductRow = Prisma.ProductGetPayload<{
    include: { product_type: true; unit: true; size: true };
}>;
type ProductAgg = { total: number; missing: number; locs: Record<string, number> };

export class StockDistributionFGService {
    private static productInclude() {
        return { product_type: true, unit: true, size: true } as const;
    }

    private static buildWhere(
        search?: string,
        type_id?: number,
        gender?: QueryStockDistributionFGDTO["gender"],
    ): Prisma.ProductWhereInput {
        return {
            deleted_at: null,
            ...(type_id ? { type_id } : {}),
            ...(gender ? { gender } : {}),
            ...(search
                ? {
                      OR: [
                          { name: { contains: search, mode: "insensitive" as const } },
                          { code: { contains: search, mode: "insensitive" as const } },
                      ],
                  }
                : {}),
        };
    }

    private static dbOrderBy(
        sortBy: NonNullable<QueryStockDistributionFGDTO["sortBy"]>,
        sortOrder: NonNullable<QueryStockDistributionFGDTO["sortOrder"]>,
    ): Prisma.ProductOrderByWithRelationInput {
        const map: Record<string, Prisma.ProductOrderByWithRelationInput> = {
            name: { name: sortOrder },
            code: { code: sortOrder },
            updated_at: { updated_at: sortOrder },
            type: { product_type: { name: sortOrder } },
            size: { size: { size: sortOrder } },
        };
        return map[sortBy] ?? { updated_at: "desc" };
    }

    static async list(query: QueryStockDistributionFGDTO): Promise<{
        data: ResponseStockDistributionFGDTO[];
        len: number;
    }> {
        const {
            page = 1,
            take = 50,
            search,
            type_id,
            gender,
            month,
            year,
            sortBy = "updated_at",
            sortOrder = "desc",
        } = query;

        const { skip, take: limit } = GetPagination(Number(page), Number(take));
        const period = resolvePeriod(month, year);
        const where = this.buildWhere(search, type_id, gender);

        if (sortBy === "total_stock") {
            return this.listSortedByTotal(where, period, skip, limit, sortOrder);
        }

        const [len, products] = await Promise.all([
            prisma.product.count({ where }),
            prisma.product.findMany({
                where,
                include: this.productInclude(),
                orderBy: this.dbOrderBy(sortBy, sortOrder),
                skip,
                take: limit,
            }),
        ]);

        if (products.length === 0) return { data: [], len };

        const data = await this.assembleMatrix(products, period);
        return { data, len };
    }

    /**
     * Sort path for `total_stock`. Pulls all matching product IDs first,
     * aggregates totals across them, then slices the page window so the
     * ordering is correct across pages (not just per-page).
     */
    private static async listSortedByTotal(
        where: Prisma.ProductWhereInput,
        period: Period,
        skip: number,
        limit: number,
        sortOrder: NonNullable<QueryStockDistributionFGDTO["sortOrder"]>,
    ): Promise<{ data: ResponseStockDistributionFGDTO[]; len: number }> {
        const allIds = (
            await prisma.product.findMany({
                where,
                select: { id: true },
            })
        ).map((p) => p.id);

        if (allIds.length === 0) return { data: [], len: 0 };

        const [whAgg, outAgg] = await Promise.all([
            prisma.productInventory.groupBy({
                by: ["product_id"],
                where: {
                    product_id: { in: allIds },
                    month: period.month,
                    year: period.year,
                    warehouse: { type: "FINISH_GOODS", deleted_at: null },
                },
                _sum: { quantity: true },
            }),
            prisma.outletInventory.groupBy({
                by: ["product_id"],
                where: {
                    product_id: { in: allIds },
                    month: period.month,
                    year: period.year,
                    outlet: { deleted_at: null },
                },
                _sum: { quantity: true },
            }),
        ]);

        const totals = new Map<number, number>(allIds.map((id) => [id, 0]));
        const accumulate = (
            rows: Array<{ product_id: number | null; _sum: { quantity: Prisma.Decimal | null } }>,
        ) => {
            for (const r of rows) {
                if (r.product_id === null) continue;
                totals.set(
                    r.product_id,
                    (totals.get(r.product_id) ?? 0) + Number(r._sum.quantity ?? 0),
                );
            }
        };
        accumulate(whAgg);
        accumulate(outAgg);

        const dir = sortOrder === "asc" ? 1 : -1;
        const pageIds = [...totals.entries()]
            .sort(([, a], [, b]) => dir * (a - b))
            .slice(skip, skip + limit)
            .map(([id]) => id);

        if (pageIds.length === 0) return { data: [], len: allIds.length };

        const products = await prisma.product.findMany({
            where: { id: { in: pageIds } },
            include: this.productInclude(),
        });

        // Re-sort products to match pageIds order (Prisma `in` does not preserve order).
        const productById = new Map(products.map((p) => [p.id, p]));
        const ordered = pageIds
            .map((id) => productById.get(id))
            .filter((p): p is ProductRow => Boolean(p));

        const data = await this.assembleMatrix(ordered, period);
        return { data, len: allIds.length };
    }

    /** Per-product aggregation for the given page. Shared by both list paths. */
    private static async assembleMatrix(
        products: ProductRow[],
        period: Period,
    ): Promise<ResponseStockDistributionFGDTO[]> {
        const productIds = products.map((p) => p.id);

        const [whRows, outRows, missAgg] = await Promise.all([
            prisma.productInventory.findMany({
                where: {
                    product_id: { in: productIds },
                    month: period.month,
                    year: period.year,
                    warehouse: { type: "FINISH_GOODS", deleted_at: null },
                },
                select: { product_id: true, quantity: true, warehouse: { select: { name: true } } },
            }),
            prisma.outletInventory.findMany({
                where: {
                    product_id: { in: productIds },
                    month: period.month,
                    year: period.year,
                    outlet: { deleted_at: null },
                },
                select: { product_id: true, quantity: true, outlet: { select: { name: true } } },
            }),
            prisma.stockTransferItem.groupBy({
                by: ["product_id"],
                where: {
                    product_id: { in: productIds },
                    quantity_missing: { gt: 0 },
                    transfer: { status: { not: "CANCELLED" } },
                },
                _sum: { quantity_missing: true },
            }),
        ]);

        const byProduct = new Map<number, ProductAgg>();
        for (const id of productIds) byProduct.set(id, { total: 0, missing: 0, locs: {} });

        for (const r of whRows) {
            const entry = byProduct.get(r.product_id);
            if (!entry) continue;
            const qty = Number(r.quantity);
            entry.locs[r.warehouse.name] = (entry.locs[r.warehouse.name] ?? 0) + qty;
            entry.total += qty;
        }
        for (const r of outRows) {
            const entry = byProduct.get(r.product_id);
            if (!entry) continue;
            const qty = Number(r.quantity);
            entry.locs[r.outlet.name] = (entry.locs[r.outlet.name] ?? 0) + qty;
            entry.total += qty;
        }
        for (const ma of missAgg) {
            if (ma.product_id === null) continue;
            const entry = byProduct.get(ma.product_id);
            if (entry) entry.missing = Number(ma._sum.quantity_missing ?? 0);
        }

        return products.map((p) => {
            const agg = byProduct.get(p.id)!;
            return {
                code: p.code,
                name: p.name,
                type: p.product_type?.name ?? UNKNOWN_LABEL,
                size: Number(p.size?.size ?? 0),
                gender: String(p.gender),
                uom: p.unit?.name ?? UNKNOWN_LABEL,
                total_stock: agg.total,
                total_missing: agg.missing,
                location_stocks: agg.locs,
            };
        });
    }

    static async listLocations(): Promise<ResponseStockDistributionLocationDTO[]> {
        const [warehouses, outlets] = await Promise.all([
            prisma.warehouse.findMany({
                where: { type: "FINISH_GOODS", deleted_at: null },
                select: { id: true, name: true },
                orderBy: { name: "asc" },
            }),
            prisma.outlet.findMany({
                where: { deleted_at: null },
                select: { id: true, name: true },
                orderBy: { name: "asc" },
            }),
        ]);

        return [
            ...warehouses.map((w) => ({ id: w.id, name: w.name, type: "WAREHOUSE" as const })),
            ...outlets.map((o) => ({ id: o.id, name: o.name, type: "OUTLET" as const })),
        ];
    }

    static async export(
        query: QueryStockDistributionFGDTO,
    ): Promise<ResponseStockDistributionFGDTO[]> {
        const { data } = await this.list({ ...query, take: EXPORT_ROW_LIMIT, page: 1 });
        return data;
    }
}
