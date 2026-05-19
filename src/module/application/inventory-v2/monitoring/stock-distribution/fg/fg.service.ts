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

export class StockDistributionFGService {
    static async list(query: QueryStockDistributionFGDTO): Promise<{
        data: ResponseStockDistributionFGDTO[];
        len:  number;
    }> {
        const {
            page = 1, take = 50,
            search, type_id, gender,
            month, year,
            sortBy = "updated_at", sortOrder = "desc",
        } = query;

        const { skip, take: limit } = GetPagination(Number(page), Number(take));
        const { month: m, year: y } = resolvePeriod(month, year);

        const where: Prisma.ProductWhereInput = {
            deleted_at: null,
            ...(type_id ? { type_id } : {}),
            ...(gender ? { gender } : {}),
            ...(search ? {
                OR: [
                    { name: { contains: search, mode: "insensitive" } },
                    { code: { contains: search, mode: "insensitive" } },
                ],
            } : {}),
        };

        // DB-orderable columns. `total_stock` is computed → sorted post-aggregation in JS.
        const dbOrderBy: Record<string, Prisma.ProductOrderByWithRelationInput> = {
            name:        { name: sortOrder },
            code:        { code: sortOrder },
            updated_at:  { updated_at: sortOrder },
            type:        { product_type: { name: sortOrder } },
            size:        { size: { size: sortOrder } },
            total_stock: { updated_at: sortOrder },
        };

        const [len, products] = await Promise.all([
            prisma.product.count({ where }),
            prisma.product.findMany({
                where,
                include: { product_type: true, unit: true, size: true },
                orderBy: dbOrderBy[sortBy] ?? { updated_at: "desc" },
                skip,
                take: limit,
            }),
        ]);

        if (products.length === 0) return { data: [], len };

        const productIds = products.map((p) => p.id);

        const [whRows, outRows, missAgg] = await Promise.all([
            prisma.productInventory.findMany({
                where: {
                    product_id: { in: productIds },
                    month: m, year: y,
                    warehouse: { type: "FINISH_GOODS", deleted_at: null },
                },
                select: { product_id: true, quantity: true, warehouse: { select: { name: true } } },
            }),
            prisma.outletInventory.findMany({
                where: {
                    product_id: { in: productIds },
                    month: m, year: y,
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

        const byProduct = new Map<number, { total: number; missing: number; locs: Record<string, number> }>();
        for (const id of productIds) byProduct.set(id, { total: 0, missing: 0, locs: {} });

        for (const r of whRows) {
            const entry = byProduct.get(r.product_id);
            if (!entry) continue;
            const q = Number(r.quantity);
            const name = r.warehouse.name;
            entry.locs[name] = (entry.locs[name] ?? 0) + q;
            entry.total += q;
        }
        for (const r of outRows) {
            const entry = byProduct.get(r.product_id);
            if (!entry) continue;
            const q = Number(r.quantity);
            const name = r.outlet.name;
            entry.locs[name] = (entry.locs[name] ?? 0) + q;
            entry.total += q;
        }
        for (const ma of missAgg) {
            const entry = byProduct.get(ma.product_id);
            if (entry) entry.missing = Number(ma._sum.quantity_missing ?? 0);
        }

        let data: ResponseStockDistributionFGDTO[] = products.map((p) => {
            const agg = byProduct.get(p.id)!;
            return {
                code:            p.code,
                name:            p.name,
                type:            p.product_type?.name ?? "Unknown",
                size:            Number(p.size?.size ?? 0),
                gender:          String(p.gender),
                uom:             p.unit?.name ?? "Unknown",
                total_stock:     agg.total,
                total_missing:   agg.missing,
                location_stocks: agg.locs,
            };
        });

        if (sortBy === "total_stock") {
            const dir = sortOrder === "asc" ? 1 : -1;
            data = [...data].sort((a, b) => dir * (a.total_stock - b.total_stock));
        }

        return { data, len };
    }

    static async listLocations(): Promise<ResponseStockDistributionLocationDTO[]> {
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

    static async export(query: QueryStockDistributionFGDTO): Promise<ResponseStockDistributionFGDTO[]> {
        const { data } = await this.list({ ...query, take: EXPORT_ROW_LIMIT, page: 1 });
        return data;
    }
}
