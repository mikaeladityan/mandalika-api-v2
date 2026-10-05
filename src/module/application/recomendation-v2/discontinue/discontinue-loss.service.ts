import { recommendationStockSql, recommendationOpenPoSql, resolveRecommendationInvPeriod } from "../recommendation-stock.js";
import prisma from "../../../../config/prisma.js";
import { Prisma, type RecommendationLockRow } from "../../../../generated/prisma/client.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { DiscontinueService } from "./discontinue.service.js";
import { DiscontinueNeed } from "./discontinue.schema.js";
import { DiscontinueLoss, DiscontinueLossKey, DiscontinueLossSchema } from "./discontinue-loss.schema.js";

import { RecommendationPeriodLockService, RecommendationLockView } from "../period-lock/services.js";

type LossMaterial = {
    material_id: number;
    barcode: string | null;
    material_name: string;
    uom: string;
    stock: Prisma.Decimal;
    open_po?: Prisma.Decimal;
    unit_price: Prisma.Decimal | null;
};

export function calculateDiscontinueLoss(materials: LossMaterial[], needs: DiscontinueNeed[]): DiscontinueLoss {
    const byMaterial = new Map(needs.map((need) => [need.material_id, need]));
    const rows = materials.map((material) => {
        const need = byMaterial.get(material.material_id);
        const stock = Prisma.Decimal.max(0, material.stock);
        const openPo = Prisma.Decimal.max(0, material.open_po ?? 0);
        const buy = need?.anchor_valid && need.total_needed > 0
            ? Prisma.Decimal.max(0, new Prisma.Decimal(need.total_needed).minus(stock).minus(openPo))
            : new Prisma.Decimal(0);
        // Remaining stock is what is left after fulfilling the full discontinue need.
        // `buy` is only the shortage and must not be subtracted from stock again.
        const required = need?.anchor_valid && need.total_needed > 0
            ? new Prisma.Decimal(need.total_needed)
            : new Prisma.Decimal(0);
        const remaining = Prisma.Decimal.max(0, stock.minus(required));
        const price = material.unit_price?.gte(0) ? material.unit_price : null;
        return {
            material_id: material.material_id, barcode: material.barcode,
            material_name: material.material_name, uom: material.uom,
            total_needed: required.toNumber(), open_po: openPo.toNumber(),
            stock: stock.toNumber(), need_buy: buy.toDecimalPlaces(8).toNumber(),
            remaining: remaining.toDecimalPlaces(8).toNumber(),
            remaining_value: price ? remaining.mul(price).toDecimalPlaces(2).toNumber() : null,
            purchase_value: price ? buy.mul(price).toDecimalPlaces(2).toNumber() : null,
        };
    });
    return {
        rows,
        locked: false, historical_prices_missing: false,
        remaining_value: rows.reduce((sum, row) => sum.plus(row.remaining_value ?? 0), new Prisma.Decimal(0)).toNumber(),
        purchase_value: rows.reduce((sum, row) => sum.plus(row.purchase_value ?? 0), new Prisma.Decimal(0)).toNumber(),
        missing_prices: rows.filter((row) => row.remaining_value === null).length,
        anchor_valid: needs.length > 0 && needs.every((need) => need.anchor_valid && need.anchor_material_id !== null),
    };
}

export type DiscontinueLossSnapshotSource = {
    material_id: number;
    barcode?: string | null;
    material_name: string;
    uom?: string;
    is_special_paper?: boolean;
    current_stock: number;
    open_po: number;
    discontinue_anchor?: DiscontinueNeed | null;
    discontinue_loss?: DiscontinueLoss;
};

/** Capture values from the exact recommendation row, including its resolved stock period. */
export function calculateDiscontinueSnapshotLoss(
    row: DiscontinueLossSnapshotSource, price: Prisma.Decimal | null,
): DiscontinueLoss {
    return calculateDiscontinueLoss([{
        material_id: row.material_id, barcode: row.barcode ?? null,
        material_name: row.material_name, uom: row.is_special_paper ? "KG" : row.uom || "UNIT",
        stock: new Prisma.Decimal(row.current_stock), open_po: new Prisma.Decimal(row.open_po),
        unit_price: price,
    }], row.discontinue_anchor ? [row.discontinue_anchor] : []);
}

export class DiscontinueLossService {
    static async check(key: DiscontinueLossKey): Promise<DiscontinueLoss> {
        const locked = await RecommendationPeriodLockService.findLockedRows(key.month, key.year, RecommendationLockView.DISCONTINUE_FG);
        if (locked) {
            const snapshots = (locked.rows as RecommendationLockRow[]).filter((row) => row.fg_id === key.product_id
                && (key.material_id === undefined || row.raw_mat_id === key.material_id));
            if (!snapshots.length) throw new ApiError(404, "FG atau RM tidak tersedia dalam snapshot periode terkunci.");
            const losses = snapshots.map((snapshot) => {
                const payload = snapshot.payload as unknown as DiscontinueLossSnapshotSource;
                // Older locks have quantities but no historical price: never substitute today's price.
                return payload.discontinue_loss
                    ? DiscontinueLossSchema.parse(payload.discontinue_loss)
                    : calculateDiscontinueSnapshotLoss(payload, null);
            });
            const rows = losses.flatMap((loss) => loss.rows);
            return {
                rows, locked: true,
                historical_prices_missing: snapshots.some((snapshot) => !(snapshot.payload as unknown as DiscontinueLossSnapshotSource).discontinue_loss),
                remaining_value: rows.reduce((sum, row) => sum.plus(row.remaining_value ?? 0), new Prisma.Decimal(0)).toNumber(),
                purchase_value: rows.reduce((sum, row) => sum.plus(row.purchase_value ?? 0), new Prisma.Decimal(0)).toNumber(),
                missing_prices: rows.filter((row) => row.remaining_value === null).length,
                anchor_valid: losses.every((loss) => loss.anchor_valid),
            };
        }
        const allNeeds = await DiscontinueService.needs([key.product_id], key.month, key.year);
        const needs = key.material_id === undefined
            ? allNeeds
            : allNeeds.filter((need) => need.material_id === key.material_id);
        if (!needs.length) {
            throw new ApiError(404, key.material_id === undefined
                ? "FG Discontinue tidak memiliki recipe RM aktif."
                : "RM tidak memiliki recipe aktif pada FG Discontinue ini.");
        }
        const [latestRm, latestFg] = await Promise.all([
            prisma.rawMaterialInventory.findFirst({ orderBy: [{ year: "desc" }, { month: "desc" }], select: { month: true, year: true } }),
            prisma.productInventory.findFirst({ orderBy: [{ year: "desc" }, { month: "desc" }], select: { month: true, year: true } }),
        ]);
        const current = { month: key.month, year: key.year };
        const rmPeriod = resolveRecommendationInvPeriod(current, latestRm);
        const fgPeriod = resolveRecommendationInvPeriod(current, latestFg);
        // Same latest-per-warehouse stock and RELEASED production deductions as recommendations.
        const materials = await prisma.$queryRaw<LossMaterial[]>(Prisma.sql`
            SELECT rm.id AS material_id, rm.barcode, rm.name AS material_name,
                CASE WHEN rm.barcode IN ('KA-0.6MM', 'KA-0.4MM') THEN 'KG' ELSE COALESCE(u.name, 'UNIT') END AS uom,
                ${recommendationStockSql(
                    Prisma.sql`rm.id`, Prisma.sql`rm.barcode`, rmPeriod.year, rmPeriod.month, fgPeriod.year, fgPeriod.month,
                )}::numeric AS stock,
                ${recommendationOpenPoSql(Prisma.sql`rm.id`)}::numeric AS open_po,
                (SELECT sm.unit_price FROM supplier_materials sm
                 WHERE sm.raw_material_id = rm.id AND sm.is_preferred = true AND sm.status = 'ACTIVE'
                 ORDER BY sm.supplier_id ASC LIMIT 1) AS unit_price
            FROM raw_materials rm LEFT JOIN unit_raw_materials u ON u.id = rm.unit_id
            WHERE rm.id IN (${Prisma.join(needs.map((need) => need.material_id))})
            ORDER BY rm.name, rm.id
        `);
        return calculateDiscontinueLoss(materials, needs);
    }
}
