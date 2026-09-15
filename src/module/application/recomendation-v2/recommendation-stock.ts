import { Prisma } from "../../../generated/prisma/client.js";

/** Prefer physical RM stock; only an empty RM balance can use the identical FG. */
export function recommendationStockSql(
    materialId: Prisma.Sql,
    barcode: Prisma.Sql,
    rmYear: number,
    rmMonth: number,
    fgYear: number,
    fgMonth: number,
    unmatchedTesterStock?: Prisma.Sql,
): Prisma.Sql {
    return Prisma.sql`(
        SELECT CASE
            WHEN matched.id IS NULL AND ${unmatchedTesterStock !== undefined}
                THEN ${unmatchedTesterStock ?? Prisma.sql`0`}
            ELSE GREATEST(0,
                COALESCE(NULLIF(${rawMaterialPhysicalStockSql(materialId, rmYear, rmMonth)}, 0), (
                    SELECT SUM(latest.quantity)
                    FROM (
                        SELECT quantity, ROW_NUMBER() OVER (
                            PARTITION BY warehouse_id ORDER BY year DESC, month DESC, date DESC, updated_at DESC, id DESC
                        ) AS period_rank
                        FROM product_inventories
                        WHERE product_id = matched.id
                          AND (year * 12 + month) <= (${fgYear} * 12 + ${fgMonth})
                    ) latest WHERE latest.period_rank = 1
                ), 0)
                - COALESCE((
                    SELECT SUM(poi.quantity_planned)
                    FROM production_order_items poi
                    JOIN production_orders po ON po.id = poi.production_order_id
                    WHERE poi.raw_material_id = ${materialId} AND po.status = 'RELEASED'
                ), 0)
            )
        END
        FROM (SELECT 1) seed
        LEFT JOIN LATERAL (
            SELECT p.id
            FROM products p
            WHERE BTRIM(UPPER(p.code)) = BTRIM(UPPER(${barcode}))
              AND NULLIF(BTRIM(${barcode}), '') IS NOT NULL
              AND p.deleted_at IS NULL
            ORDER BY p.status ASC, p.updated_at DESC, p.id DESC
            LIMIT 1
        ) matched ON TRUE
    )`;
}

/** Shared physical balance used to decide fallback before production reservations. */
function rawMaterialPhysicalStockSql(materialId: Prisma.Sql, year: number, month: number): Prisma.Sql {
    return Prisma.sql`(
        SELECT SUM(latest.quantity) FROM (
            SELECT quantity, ROW_NUMBER() OVER (
                PARTITION BY warehouse_id ORDER BY year DESC, month DESC, date DESC, updated_at DESC, id DESC
            ) AS period_rank
            FROM raw_material_inventories
            WHERE raw_material_id = ${materialId} AND year * 12 + month <= ${year * 12 + month}
        ) latest WHERE latest.period_rank = 1
    )`;
}

/** Same-code FG stock is deducted below as RM fallback, so restore its gross demand first.
 * Other FG recipes retain operational demand (final_forecast), already net of their own FG stock.
 * Legacy net_forecast stores gross demand, despite its name.
 */
export function recommendationForecastSql(
    materialId: Prisma.Sql, barcode: Prisma.Sql, rmYear: number, rmMonth: number,
): Prisma.Sql {
    return Prisma.sql`CASE
        WHEN BTRIM(UPPER(p.code)) = BTRIM(UPPER(${barcode})) AND NULLIF(BTRIM(${barcode}), '') IS NOT NULL
            AND COALESCE(${rawMaterialPhysicalStockSql(materialId, rmYear, rmMonth)}, 0) = 0
        THEN COALESCE(f.net_forecast, f.final_forecast)
        ELSE f.final_forecast
    END`;
}
