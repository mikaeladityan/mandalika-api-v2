import { Prisma } from "../../../../../generated/prisma/client.js";
import prisma from "../../../../../config/prisma.js";
import { QueryRmUsageDTO } from "./rm-usage.schema.js";
import { GetPagination } from "../../../../../lib/utils/pagination.js";
import { MovementEntityType, MovementRefType, MovementType } from "../../../../../generated/prisma/enums.js";

export class RmUsageService {
    static async getUsage(query: QueryRmUsageDTO) {
        const {
            page = 1,
            take = 10,
            fromDate,
            toDate,
            warehouse_id,
            search,
        } = query;

        const { skip, take: limit } = GetPagination(page, take);

        const where: Prisma.StockMovementWhereInput = {
            entity_type: MovementEntityType.RAW_MATERIAL,
            reference_type: MovementRefType.PRODUCTION,
            movement_type: { in: [MovementType.OUT, MovementType.TRANSFER_OUT] },
            ...(warehouse_id && { location_id: warehouse_id }),
            ...(fromDate || toDate ? {
                created_at: {
                    ...(fromDate && { gte: (() => {
                        const d = new Date(fromDate);
                        d.setHours(0, 0, 0, 0);
                        return d;
                    })() }),
                    ...(toDate && { lte: (() => {
                        const d = new Date(toDate);
                        d.setHours(23, 59, 59, 999);
                        return d;
                    })() }),
                }
            } : {}),
            ...(search && {
                OR: [
                    { notes: { contains: search, mode: "insensitive" } },
                ]
            })
        };

        const [movements, total] = await Promise.all([
            prisma.stockMovement.findMany({
                where,
                skip,
                take: limit,
                orderBy: { created_at: "desc" },
            }),
            prisma.stockMovement.count({ where }),
        ]);

        // Map and resolve references
        const rawMatIds = Array.from(new Set(movements.map(m => m.entity_id)));
        const warehouseIds = Array.from(new Set(movements.map(m => m.location_id)));
        const orderIds = Array.from(new Set(movements.filter(m => m.reference_type === MovementRefType.PRODUCTION).map(m => m.reference_id as number)));

        const [rawMaterials, warehouses, orders] = await Promise.all([
            prisma.rawMaterial.findMany({
                where: { id: { in: rawMatIds } },
                include: { unit_raw_material: true }
            }),
            prisma.warehouse.findMany({
                where: { id: { in: warehouseIds } }
            }),
            prisma.productionOrder.findMany({
                where: { id: { in: orderIds } }
            })
        ]);

        const rawMatMap = new Map(rawMaterials.map(rm => [rm.id, rm]));
        const warehouseMap = new Map(warehouses.map(w => [w.id, w]));
        const orderMap = new Map(orders.map(o => [o.id, o]));

        const data = movements.map(m => {
            const rm = rawMatMap.get(m.entity_id);
            const wh = warehouseMap.get(m.location_id);
            const order = orderMap.get(m.reference_id as number);

            return {
                id: m.id,
                created_at: m.created_at,
                mfg_number: order?.mfg_number || null,
                rm_name: rm?.name || "Unknown",
                rm_sku: rm?.barcode || rm?.id.toString() || "Unknown",
                unit: rm?.unit_raw_material.name || "-",
                warehouse_name: wh?.name || "Unknown",
                qty_out: Number(m.quantity),
                qty_after: Number(m.qty_after),
                notes: m.notes,
            };
        });

        return { data, total };
    }
}
