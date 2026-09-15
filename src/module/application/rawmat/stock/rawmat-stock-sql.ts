import { Prisma } from "../../../../generated/prisma/client.js";

/** Read-only stock projection. FG remains in its original warehouse. */
export function rawMaterialStockCtes(
    month: number,
    year: number,
    productionWarehouseId: number,
    warehouseId?: number,
): Prisma.Sql {
    return Prisma.sql`
        WITH rm_periods AS (
            SELECT raw_material_id, warehouse_id, quantity,
                ROW_NUMBER() OVER (
                    PARTITION BY raw_material_id, warehouse_id ORDER BY date DESC, id DESC
                ) AS period_rank
            FROM raw_material_inventories
            WHERE year = ${year} AND month = ${month}
        ), rm_inventory AS (
            SELECT raw_material_id, warehouse_id, COALESCE(SUM(quantity), 0) AS quantity
            FROM rm_periods WHERE period_rank = 1
            GROUP BY raw_material_id, warehouse_id
        ), rm_totals AS (
            SELECT raw_material_id, SUM(quantity) AS quantity
            FROM rm_inventory GROUP BY raw_material_id
        ), fg_periods AS (
            SELECT product_id, warehouse_id, quantity,
                ROW_NUMBER() OVER (
                    PARTITION BY product_id, warehouse_id ORDER BY date DESC, id DESC
                ) AS period_rank
            FROM product_inventories
            WHERE year = ${year} AND month = ${month}
        ), fg_inventory AS (
            SELECT product_id, warehouse_id, COALESCE(SUM(quantity), 0) AS quantity
            FROM fg_periods WHERE period_rank = 1
            GROUP BY product_id, warehouse_id
        ), stock_sources AS (
            SELECT rm.id AS raw_material_id, p.id AS product_id,
                CASE WHEN COALESCE(rt.quantity, 0) = 0 AND p.id IS NOT NULL
                    THEN 'FG' ELSE 'RM' END AS stock_source
            FROM raw_materials rm
            LEFT JOIN rm_totals rt ON rt.raw_material_id = rm.id
            LEFT JOIN products p ON BTRIM(UPPER(p.code)) = BTRIM(UPPER(rm.barcode))
                AND NULLIF(BTRIM(rm.barcode), '') IS NOT NULL AND p.deleted_at IS NULL
            WHERE rm.deleted_at IS NULL
        ), effective_inventory AS (
            SELECT ri.raw_material_id, ri.warehouse_id, ri.quantity
            FROM rm_inventory ri
            JOIN stock_sources ss ON ss.raw_material_id = ri.raw_material_id AND ss.stock_source = 'RM'
            ${warehouseId ? Prisma.sql`WHERE ri.warehouse_id = ${warehouseId}` : Prisma.empty}
            UNION ALL
            SELECT ss.raw_material_id, fi.warehouse_id, fi.quantity
            FROM stock_sources ss
            JOIN fg_inventory fi ON fi.product_id = ss.product_id
            WHERE ss.stock_source = 'FG'
        ), booked_inventory AS (
            SELECT poi.raw_material_id, COALESCE(poi.warehouse_id, ${productionWarehouseId}) AS warehouse_id,
                SUM(poi.quantity_planned) AS quantity
            FROM production_order_items poi
            JOIN production_orders po ON po.id = poi.production_order_id
            JOIN stock_sources ss ON ss.raw_material_id = poi.raw_material_id
            WHERE po.status IN ('PLANNING', 'RELEASED')
            ${warehouseId ? Prisma.sql`AND (ss.stock_source = 'FG' OR COALESCE(poi.warehouse_id, ${productionWarehouseId}) = ${warehouseId})` : Prisma.empty}
            GROUP BY poi.raw_material_id, 2
        ), location_balances AS (
            SELECT COALESCE(ei.raw_material_id, bi.raw_material_id) AS raw_material_id,
                COALESCE(ei.warehouse_id, bi.warehouse_id) AS warehouse_id,
                COALESCE(ei.quantity, 0) AS on_hand, COALESCE(bi.quantity, 0) AS booked
            FROM effective_inventory ei
            FULL JOIN booked_inventory bi
                ON bi.raw_material_id = ei.raw_material_id AND bi.warehouse_id = ei.warehouse_id
        ), stock_totals AS (
            SELECT raw_material_id, SUM(on_hand) AS amount, SUM(booked) AS booked,
                SUM(on_hand - booked) AS avail
            FROM location_balances GROUP BY raw_material_id
        ), named_balances AS (
            SELECT lb.raw_material_id, COALESCE(w.name, 'Gudang #' || lb.warehouse_id::text) AS warehouse_name,
                SUM(lb.on_hand) AS on_hand, SUM(lb.booked) AS booked
            FROM location_balances lb
            LEFT JOIN warehouses w ON w.id = lb.warehouse_id
            GROUP BY lb.raw_material_id, COALESCE(w.name, 'Gudang #' || lb.warehouse_id::text)
        ), stock_details AS (
            SELECT raw_material_id,
                JSONB_OBJECT_AGG(warehouse_name, on_hand) AS stocks,
                JSONB_OBJECT_AGG(warehouse_name, JSONB_BUILD_OBJECT(
                    'on_hand', on_hand, 'booked', booked, 'avail', on_hand - booked
                )) AS details
            FROM named_balances GROUP BY raw_material_id
        ), source_warehouses AS (
            SELECT ei.raw_material_id, JSONB_AGG(JSONB_BUILD_OBJECT(
                'warehouse_id', ei.warehouse_id,
                'warehouse_name', COALESCE(w.name, 'Gudang #' || ei.warehouse_id::text),
                'quantity', ei.quantity
            ) ORDER BY w.name, ei.warehouse_id) AS warehouses
            FROM effective_inventory ei
            LEFT JOIN warehouses w ON w.id = ei.warehouse_id
            WHERE ei.quantity <> 0
            GROUP BY ei.raw_material_id
        )
    `;
}
