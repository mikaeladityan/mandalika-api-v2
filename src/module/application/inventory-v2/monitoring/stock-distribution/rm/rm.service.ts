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

export class StockDistributionRMService {
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
        const { month: m, year: y } = resolvePeriod(month, year);

        const where: Prisma.RawMaterialWhereInput = {
            deleted_at: null,
            ...(category_id ? { raw_mat_categories_id: category_id } : {}),
            ...(material_type ? { type: material_type as Prisma.RawMaterialWhereInput["type"] } : {}),
            ...(search ? {
                OR: [{ name: { contains: search, mode: "insensitive" as const } }],
            } : {}),
        };

        const dbOrderBy: Record<string, Prisma.RawMaterialOrderByWithRelationInput> = {
            name:          { name: sortOrder },
            updated_at:    { updated_at: sortOrder },
            material_type: { type: sortOrder },
            category:      { raw_mat_category: { name: sortOrder } },
            unit:          { unit_raw_material: { name: sortOrder } },
            total_stock:   { updated_at: sortOrder },
        };

        const [len, rms] = await Promise.all([
            prisma.rawMaterial.count({ where }),
            prisma.rawMaterial.findMany({
                where,
                include: { unit_raw_material: true, raw_mat_category: true },
                orderBy: dbOrderBy[sortBy] ?? { updated_at: "desc" },
                skip,
                take: limit,
            }),
        ]);

        if (rms.length === 0) return { data: [], len };

        const rmIds = rms.map((r) => r.id);

        const whRows = await prisma.rawMaterialInventory.findMany({
            where: {
                raw_material_id: { in: rmIds },
                month: m, year: y,
                warehouse: { type: "RAW_MATERIAL", deleted_at: null },
            },
            select: {
                raw_material_id: true,
                quantity: true,
                warehouse: { select: { name: true } },
            },
        });

        const byRM = new Map<number, { total: number; locs: Record<string, number> }>();
        for (const id of rmIds) byRM.set(id, { total: 0, locs: {} });

        for (const row of whRows) {
            const entry = byRM.get(row.raw_material_id);
            if (!entry) continue;
            const q = Number(row.quantity);
            const name = row.warehouse.name;
            entry.locs[name] = (entry.locs[name] ?? 0) + q;
            entry.total += q;
        }

        let data: ResponseStockDistributionRMDTO[] = rms.map((r) => {
            const agg = byRM.get(r.id)!;
            return {
                name:            r.name,
                category:        r.raw_mat_category?.name ?? "Unknown",
                unit:            r.unit_raw_material?.name ?? "Unknown",
                material_type:   r.type as "FO" | "PCKG" | null,
                min_stock:       r.min_stock !== null ? Number(r.min_stock) : null,
                total_stock:     agg.total,
                location_stocks: agg.locs,
            };
        });

        if (sortBy === "total_stock") {
            const dir = sortOrder === "asc" ? 1 : -1;
            data = [...data].sort((a, b) => dir * (a.total_stock - b.total_stock));
        }

        return { data, len };
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
