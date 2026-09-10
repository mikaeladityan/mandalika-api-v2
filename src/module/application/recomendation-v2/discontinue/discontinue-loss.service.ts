import prisma from "../../../../config/prisma.js";
import { Prisma } from "../../../../generated/prisma/client.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { DiscontinueService } from "./discontinue.service.js";
import { DiscontinueNeed } from "./discontinue.schema.js";
import { DiscontinueLoss, DiscontinueLossKey } from "./discontinue-loss.schema.js";

type LossMaterial = {
    material_id: number;
    barcode: string | null;
    material_name: string;
    uom: string;
    stock: Prisma.Decimal;
    unit_price: Prisma.Decimal | null;
};

export function calculateDiscontinueLoss(materials: LossMaterial[], needs: DiscontinueNeed[]): DiscontinueLoss {
    const byMaterial = new Map(needs.map((need) => [need.material_id, need]));
    const rows = materials.map((material) => {
        const need = byMaterial.get(material.material_id);
        const stock = Prisma.Decimal.max(0, material.stock);
        const buy = need?.anchor_valid && need.total_needed > 0
            ? Prisma.Decimal.max(0, new Prisma.Decimal(need.total_needed).minus(stock))
            : new Prisma.Decimal(0);
        const remaining = Prisma.Decimal.max(0, stock.minus(buy));
        const price = material.unit_price?.gte(0) ? material.unit_price : null;
        return {
            material_id: material.material_id, barcode: material.barcode,
            material_name: material.material_name, uom: material.uom,
            stock: stock.toNumber(), need_buy: buy.toDecimalPlaces(8).toNumber(),
            remaining: remaining.toDecimalPlaces(8).toNumber(),
            remaining_value: price ? remaining.mul(price).toDecimalPlaces(2).toNumber() : null,
            purchase_value: price ? buy.mul(price).toDecimalPlaces(2).toNumber() : null,
        };
    });
    return {
        rows,
        remaining_value: rows.reduce((sum, row) => sum.plus(row.remaining_value ?? 0), new Prisma.Decimal(0)).toNumber(),
        purchase_value: rows.reduce((sum, row) => sum.plus(row.purchase_value ?? 0), new Prisma.Decimal(0)).toNumber(),
        missing_prices: rows.filter((row) => row.remaining_value === null).length,
        anchor_valid: needs.length > 0 && needs.every((need) => need.anchor_valid && need.anchor_material_id !== null),
    };
}

export class DiscontinueLossService {
    static async check(key: DiscontinueLossKey): Promise<DiscontinueLoss> {
        const needs = (await DiscontinueService.needs([key.product_id], key.month, key.year))
            .filter((need) => need.material_id === key.material_id);
        if (!needs.length) throw new ApiError(404, "RM tidak memiliki recipe aktif pada FG Discontinue ini.");
        // Same latest-per-warehouse stock and RELEASED production deductions as recommendations.
        const materials = await prisma.$queryRaw<LossMaterial[]>(Prisma.sql`
            SELECT rm.id AS material_id, rm.barcode, rm.name AS material_name,
                CASE WHEN rm.barcode IN ('KA-0.6MM', 'KA-0.4MM') THEN 'KG' ELSE COALESCE(u.name, 'UNIT') END AS uom,
                GREATEST(0, COALESCE((
                    SELECT SUM(inv.quantity) FROM (
                        SELECT DISTINCT ON (warehouse_id) warehouse_id, year, month
                        FROM raw_material_inventories
                        WHERE raw_material_id = rm.id AND year * 12 + month <= ${key.year * 12 + key.month}
                        ORDER BY warehouse_id, year DESC, month DESC
                    ) latest
                    JOIN raw_material_inventories inv ON inv.raw_material_id = rm.id
                        AND inv.warehouse_id = latest.warehouse_id AND inv.year = latest.year AND inv.month = latest.month
                ), 0) - COALESCE((
                    SELECT SUM(poi.quantity_planned) FROM production_order_items poi
                    JOIN production_orders po ON po.id = poi.production_order_id
                    WHERE poi.raw_material_id = rm.id AND po.status = 'RELEASED'
                ), 0))::numeric AS stock,
                (SELECT sm.unit_price FROM supplier_materials sm
                 WHERE sm.raw_material_id = rm.id AND sm.is_preferred = true AND sm.status = 'ACTIVE'
                 ORDER BY sm.updated_at DESC, sm.id DESC LIMIT 1) AS unit_price
            FROM raw_materials rm LEFT JOIN unit_raw_materials u ON u.id = rm.unit_id
            WHERE rm.id = ${key.material_id}
            ORDER BY rm.name, rm.id
        `);
        return calculateDiscontinueLoss(materials, needs);
    }
}
