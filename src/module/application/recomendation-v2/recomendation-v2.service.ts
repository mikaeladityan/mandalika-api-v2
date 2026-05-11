import { Prisma } from "../../../generated/prisma/client.js";
import prisma from "../../../config/prisma.js";
import {
    QueryRecomendationV2DTO,
    RequestApproveWorkOrderDTO,
    RequestSaveWorkOrderDTO,
    RequestBulkSaveHorizonDTO,
    RequestUpdateMoqDTO,
    RequestSaveNeedOverrideDTO,
    RequestBulkHideDTO,
} from "./recomendation-v2.schema.js";
import { GetPagination } from "../../../lib/utils/pagination.js";
import { ISSUANCE_THRESHOLD_PERIOD } from "../shared/constants.js";
import * as ExcelJS from "exceljs";

export class RecomendationV2Service {
    static async list(query: QueryRecomendationV2DTO) {
        const {
            search,
            page,
            take,
            month,
            year,
            type,
            sales_months = 4,
            forecast_months = 3,
            po_months = 3,
        } = query;
        const { skip, take: limit } = GetPagination(page, take);

        const now = new Date();
        const currentMonth = month ?? now.getMonth() + 1;
        const currentYear = year ?? now.getFullYear();

        const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
        const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;

        const salesPeriods: { month: number; year: number; key: string }[] = [];
        for (let i = sales_months; i >= 1; i--) {
            let m = currentMonth - i;
            let y = currentYear;
            while (m <= 0) {
                m += 12;
                y -= 1;
            }
            salesPeriods.push({ month: m, year: y, key: `${m}-${y}` });
        }

        const forecastPeriods: { month: number; year: number; key: string; percentage?: number }[] = [];
        for (let i = 0; i < forecast_months; i++) {
            let m = currentMonth + i;
            let y = currentYear;
            while (m > 12) {
                m -= 12;
                y += 1;
            }
            forecastPeriods.push({ month: m, year: y, key: `${m}-${y}` });
        }

        const percentages = await prisma.forecastPercentage.findMany({
            where: {
                OR: forecastPeriods.map(p => ({ month: p.month, year: p.year }))
            }
        });

        forecastPeriods.forEach(p => {
            const found = percentages.find(pct => pct.month === p.month && pct.year === p.year);
            if (found) p.percentage = Number(found.value);
        });

        let backMonths = -1;

        const typeFilter = RecomendationV2Service.getTypeFilter(type);

        const fcStartM = forecastPeriods[0]?.month || currentMonth;
        const fcStartY = forecastPeriods[0]?.year || currentYear;
        const fcEndM = forecastPeriods[forecastPeriods.length - 1]?.month || currentMonth;
        const fcEndY = forecastPeriods[forecastPeriods.length - 1]?.year || currentYear;

        const slStartM = salesPeriods[0]?.month || currentMonth;
        const slStartY = salesPeriods[0]?.year || currentYear;
        const slEndM = salesPeriods[salesPeriods.length - 1]?.month || currentMonth;
        const slEndY = salesPeriods[salesPeriods.length - 1]?.year || currentYear;

        const searchFilter = RecomendationV2Service.buildSearchFilter(search);

        const [latestInv, latestFgInv, earliestPoResult] = await Promise.all([
            prisma.rawMaterialInventory.findFirst({
                orderBy: [{ year: "desc" }, { month: "desc" }],
                select: { month: true, year: true },
            }),
            prisma.productInventory.findFirst({
                orderBy: [{ year: "desc" }, { month: "desc" }],
                select: { month: true, year: true },
            }),
            prisma.$queryRaw<any[]>`
                SELECT MIN(po.po_date) as earliest
                FROM "purchase_orders" po
                JOIN "purchase_order_items" poi ON poi.po_id = po.id
                JOIN "raw_materials" rm ON rm.id = poi.raw_material_id
                LEFT JOIN "supplier_materials" sm ON sm.raw_material_id = rm.id AND sm.is_preferred = true
                LEFT JOIN "suppliers" s ON s.id = sm.supplier_id
                LEFT JOIN "raw_mat_categories" rmc ON rmc.id = rm.raw_mat_categories_id
                LEFT JOIN "unit_raw_materials" urm ON urm.id = rm.unit_id
                WHERE po.status IN ('SUBMITTED', 'APPROVED', 'ORDERED')
                  AND ${typeFilter}
                  ${searchFilter}
            `,
        ]);

        const { month: invMonth, year: invYear } = RecomendationV2Service.resolveInvPeriod(
            { month: currentMonth, year: currentYear }, latestInv
        );
        const { month: fgInvMonth, year: fgInvYear } = RecomendationV2Service.resolveInvPeriod(
            { month: currentMonth, year: currentYear }, latestFgInv
        );

        if (earliestPoResult[0]?.earliest) {
            const d = new Date(earliestPoResult[0].earliest);
            const mDiff = (currentYear * 12 + currentMonth) - (d.getFullYear() * 12 + d.getMonth() + 1);
            if (mDiff > 1) {
                backMonths = Math.max(-12, -mDiff);
            }
        }

        const poPeriods: { month: number; year: number; key: string }[] = [];
        for (let i = backMonths; i <= po_months; i++) {
            let m = currentMonth + i;
            let y = currentYear;
            while (m <= 0) { m += 12; y -= 1; }
            while (m > 12) { m -= 12; y += 1; }
            poPeriods.push({ month: m, year: y, key: `${m}-${y}` });
        }

        const fcStart = fcStartY * 12 + fcStartM;
        const fcEnd = fcEndY * 12 + fcEndM;

        // Fixed 4-month range for Safety Stock (M+0..M+3), independent of horizon
        const FIXED_SS_MONTHS = 4;
        let ssEndM = currentMonth + FIXED_SS_MONTHS - 1;
        let ssEndY = currentYear;
        while (ssEndM > 12) { ssEndM -= 12; ssEndY += 1; }
        const ssStart = currentYear * 12 + currentMonth;
        const ssEnd = ssEndY * 12 + ssEndM;

        const rows = await prisma.$queryRaw<any[]>`
            WITH
                -- Optimization: Filter materials first to limit the workload for aggregate CTEs
                filtered_materials AS (
                    SELECT
                        rm.id,
                        rm.barcode,
                        rm.name,
                        urm.name as u_name,
                        sm.min_buy,
                        sm.lead_time,
                        rm.raw_mat_categories_id
                    FROM "raw_materials" rm
                    LEFT JOIN "unit_raw_materials" urm ON urm.id = rm.unit_id
                    LEFT JOIN "raw_mat_categories" rmc ON rmc.id = rm.raw_mat_categories_id
                    LEFT JOIN "supplier_materials" sm ON sm.raw_material_id = rm.id AND sm.is_preferred = true
                    LEFT JOIN "suppliers" s ON s.id = sm.supplier_id
                    WHERE ${typeFilter}
                      AND rm.deleted_at IS NULL
                      AND (rm.barcode IS NULL OR rm.barcode NOT LIKE 'DP120V1-%')
                      AND rm.name NOT ILIKE '%(DISPLAY)%'
                      AND EXISTS (
                          SELECT 1 FROM "recipes" r2
                          WHERE r2.raw_mat_id = rm.id AND r2.is_active = true
                      )
                      ${searchFilter}
                ),
                prod_stats AS (
                    SELECT
                        f.product_id,
                        SUM(f.final_forecast) as total_forecast_horizon,
                        CASE
                            WHEN (pt.slug ILIKE '%display%' OR pt.slug ILIKE '%kertas%' OR pt.slug ILIKE '%botol%' OR pt.slug ILIKE '%paper-bag%' OR pt.slug ILIKE '%kartu-garansi%' OR pt.slug ILIKE '%canvas-bag%')
                                 AND COALESCE(p.safety_percentage, 0) = 0
                            THEN 0.25
                            ELSE COALESCE(p.safety_percentage, 0)
                        END as safety_percentage
                    FROM "forecasts" f
                    JOIN "products" p ON p.id = f.product_id AND p.status = 'ACTIVE' AND p.deleted_at IS NULL
                    LEFT JOIN "product_types" pt ON pt.id = p.type_id
                    WHERE (f.year * 12 + f.month) >= ${ssStart}
                      AND (f.year * 12 + f.month) <= ${ssEnd}
                      AND EXISTS (
                          SELECT 1 FROM "recipes" rec 
                          WHERE rec.product_id = f.product_id 
                          AND rec.is_active = true
                          AND EXISTS (SELECT 1 FROM filtered_materials fm WHERE fm.id = rec.raw_mat_id)
                      )
                    GROUP BY f.product_id, p.safety_percentage, pt.slug
                ),
                prod_dynamic_ss AS (
                    SELECT 
                        product_id,
                        ROUND(total_forecast_horizon / ${FIXED_SS_MONTHS}::numeric * safety_percentage) as dynamic_ss_qty
                    FROM prod_stats
                ),
                rm_forecast_agg AS (
                    SELECT
                        fm.id AS raw_mat_id,
                        COALESCE(SUM(FLOOR(f.final_forecast * rec.quantity *
                            CASE WHEN rec.use_size_calc THEN COALESCE(ps.size, 1) ELSE 1 END)
                        ), 0) AS total_forecast_needed,
                        COALESCE(SUM(
                            CASE WHEN f.month = ${currentMonth} AND f.year = ${currentYear}
                            THEN FLOOR(f.final_forecast * rec.quantity * CASE WHEN rec.use_size_calc THEN COALESCE(ps.size, 1) ELSE 1 END)
                            ELSE 0 END
                        ), 0) AS m1_forecast_needed
                    FROM filtered_materials fm
                    JOIN "recipes" rec ON rec.raw_mat_id = fm.id AND rec.is_active = true
                    JOIN "forecasts" f ON f.product_id = rec.product_id
                    JOIN "products" p ON p.id = f.product_id AND p.status = 'ACTIVE' AND p.deleted_at IS NULL
                    LEFT JOIN "product_size" ps ON ps.id = p.size_id
                    WHERE (f.year * 12 + f.month) >= ${fcStart}
                      AND (f.year * 12 + f.month) <= ${fcEnd}
                    GROUP BY fm.id
                ),
                rm_stock_ss_agg AS (
                    SELECT
                        fm.id AS raw_mat_id,
                        COALESCE(SUM(
                            FLOOR(dss.dynamic_ss_qty * rec.quantity *
                            CASE WHEN rec.use_size_calc THEN COALESCE(ps.size, 1) ELSE 1 END)
                        ), 0) AS dynamic_ss_x_resep,
                        COALESCE(SUM(
                            FLOOR(COALESCE(pi_agg.total_qty, 0) * rec.quantity *
                            CASE WHEN rec.use_size_calc THEN COALESCE(ps.size, 1) ELSE 1 END)
                        ), 0) AS stock_fg_x_resep
                    FROM filtered_materials fm
                    JOIN "recipes" rec ON rec.raw_mat_id = fm.id AND rec.is_active = true
                    JOIN "products" p ON p.id = rec.product_id AND p.status = 'ACTIVE' AND p.deleted_at IS NULL
                    LEFT JOIN "product_size" ps ON ps.id = p.size_id
                    LEFT JOIN prod_dynamic_ss dss ON dss.product_id = p.id
                    LEFT JOIN (
                          SELECT latest_periods.product_id, SUM(pi.quantity) as total_qty
                          FROM (
                              SELECT DISTINCT ON (product_id, warehouse_id) product_id, warehouse_id, year, month
                              FROM "product_inventories"
                              WHERE (year * 12 + month) <= (${fgInvYear} * 12 + ${fgInvMonth})
                              ORDER BY product_id, warehouse_id, year DESC, month DESC
                          ) latest_periods
                          JOIN "product_inventories" pi
                            ON pi.product_id = latest_periods.product_id
                            AND pi.warehouse_id = latest_periods.warehouse_id
                            AND pi.year = latest_periods.year
                            AND pi.month = latest_periods.month
                          GROUP BY latest_periods.product_id
                    ) pi_agg ON pi_agg.product_id = p.id
                    GROUP BY fm.id
                ),
                rm_current_sales_agg AS (
                    SELECT
                        fm.id as raw_mat_id,
                        SUM(FLOOR(pi.quantity * rec.quantity * CASE WHEN rec.use_size_calc THEN COALESCE(ps.size, 1) ELSE 1 END)) as current_month_sales
                    FROM "product_issuances" pi
                    JOIN "recipes" rec ON rec.product_id = pi.product_id AND rec.is_active = true
                    JOIN filtered_materials fm ON fm.id = rec.raw_mat_id
                    JOIN "products" p ON p.id = pi.product_id AND p.status = 'ACTIVE' AND p.deleted_at IS NULL
                    LEFT JOIN "product_size" ps ON ps.id = p.size_id
                    WHERE pi.month = ${prevMonth} AND pi.year = ${prevYear}
                      AND (
                          ( (pi.year * 12 + pi.month) > ${ISSUANCE_THRESHOLD_PERIOD} AND pi.type != 'ALL') OR
                          ( (pi.year * 12 + pi.month) <= ${ISSUANCE_THRESHOLD_PERIOD} AND pi.type = 'ALL')
                      )
                    GROUP BY fm.id
                )

            SELECT 
                *,
                rank() OVER (
                    ORDER BY
                        CASE WHEN barcode LIKE 'KA-%' THEN 0 ELSE 1 END ASC,
                        CASE WHEN barcode = 'FO-ALK' THEN 1 ELSE 0 END ASC,
                        current_month_sales DESC,
                        material_name ASC
                ) as ranking,
                CASE 
                    WHEN work_order_horizon IS NULL THEN 0
                    ELSE GREATEST(0,
                        (total_forecast_horizon_dynamic + safety_stock_x_resep)
                        - (current_stock + open_po)
                    )
                END AS recommendation_quantity
            FROM (
                SELECT
                    fm.id AS material_id,
                    fm.barcode AS barcode,
                    fm.name AS material_name,
                    fm.u_name AS uom,
                    fm.min_buy AS moq,
                    fm.lead_time AS lead_time,
                    mro.horizon AS work_order_horizon,
                    CASE
                        WHEN fm.barcode LIKE 'KTP-%' OR fm.barcode LIKE 'KTB-%' OR fm.barcode LIKE 'KTL-%' OR fm.barcode LIKE 'KEM-%'
                        THEN COALESCE(sa.stock_fg_x_resep, 0)
                        ELSE 
                            -- Available Stock (On-Hand minus Booked by RELEASED production orders)
                            GREATEST(0,
                                COALESCE((
                                    SELECT SUM(rmi.quantity)
                                    FROM (
                                        SELECT DISTINCT ON (warehouse_id) warehouse_id, year, month
                                        FROM "raw_material_inventories"
                                        WHERE raw_material_id = fm.id
                                          AND (year * 12 + month) <= (${invYear} * 12 + ${invMonth})
                                        ORDER BY warehouse_id, year DESC, month DESC
                                    ) latest_periods
                                    JOIN "raw_material_inventories" rmi
                                        ON rmi.raw_material_id = fm.id
                                        AND rmi.warehouse_id = latest_periods.warehouse_id
                                        AND rmi.year = latest_periods.year
                                        AND rmi.month = latest_periods.month
                                ), 0)
                                -
                                COALESCE((
                                    SELECT SUM(poi.quantity_planned)
                                    FROM "production_order_items" poi
                                    JOIN "production_orders" po ON poi.production_order_id = po.id
                                    WHERE poi.raw_material_id = fm.id
                                      AND po.status = 'RELEASED'
                                ), 0)
                            )
                    END AS current_stock,
                    COALESCE((
                        SELECT SUM(po.quantity)
                        FROM "raw_material_open_pos" po
                        WHERE po.raw_material_id = fm.id AND po.status = 'OPEN'
                    ), 0) AS open_po,

                    -- Open PO per month breakdown (SUBMITTED/APPROVED/ORDERED)
                    (
                        SELECT COALESCE(json_agg(
                             json_build_object(
                                  'month', p_data.m,
                                   'year', p_data.y,
                                   'quantity', p_data.qty
                             )
                        ), '[]'::json)
                        FROM (
                            SELECT
                                EXTRACT(MONTH FROM po.po_date)::int as m,
                                EXTRACT(YEAR FROM po.po_date)::int as y,
                                SUM(poi.qty_ordered - poi.qty_received) as qty
                            FROM "purchase_order_items" poi
                            JOIN "purchase_orders" po ON poi.po_id = po.id
                            WHERE poi.raw_material_id = fm.id
                              AND po.status IN ('SUBMITTED', 'APPROVED', 'ORDERED')
                            GROUP BY 1, 2
                        ) p_data
                    ) AS po_data,

                    COALESCE(fa.m1_forecast_needed, 0) AS forecast_needed,
                    COALESCE(sa.dynamic_ss_x_resep, 0) AS safety_stock_x_resep,
                    COALESCE(sa.stock_fg_x_resep, 0) AS stock_fg_x_resep,
                    
                    COALESCE(h_fc.total_needed, 0) AS total_forecast_horizon_dynamic,
                    COALESCE(fa.total_forecast_needed, 0) AS total_forecast_horizon_max,
                    COALESCE(cms.current_month_sales, 0) as current_month_sales,
                    (
                        SELECT COALESCE(json_agg(
                             json_build_object(
                                 'month', ag.month,
                                 'year', ag.year,
                                 'sales', ag.qty
                             )
                        ), '[]'::json)
                        FROM (
                            SELECT ag_sub.month, ag_sub.year, SUM(FLOOR(ag_sub.total_month_qty * rec.quantity * 
                                CASE WHEN rec.use_size_calc THEN COALESCE(ps.size, 1) ELSE 1 END)
                            ) as qty
                            FROM (
                                SELECT 
                                    product_id, year, month,
                                    COALESCE(
                                        NULLIF(SUM(CASE WHEN (year * 12 + month) > ${ISSUANCE_THRESHOLD_PERIOD} AND type != 'ALL' THEN quantity ELSE 0 END), 0),
                                        SUM(CASE WHEN (year * 12 + month) <= ${ISSUANCE_THRESHOLD_PERIOD} AND type = 'ALL' THEN quantity ELSE 0 END)
                                    ) as total_month_qty
                                FROM "product_issuances"
                                WHERE (year * 12 + month) >= ${slStartY * 12 + slStartM}
                                  AND (year * 12 + month) <= ${slEndY * 12 + slEndM}
                                GROUP BY product_id, year, month
                            ) ag_sub
                            JOIN "recipes" rec ON rec.product_id = ag_sub.product_id AND rec.is_active = true
                            JOIN "products" p ON p.id = ag_sub.product_id AND p.status = 'ACTIVE' AND p.deleted_at IS NULL
                            LEFT JOIN "product_size" ps ON ps.id = p.size_id
                            WHERE rec.raw_mat_id = fm.id
                            GROUP BY ag_sub.month, ag_sub.year
                        ) ag
                    ) AS sales_data,
                    (
                        SELECT COALESCE(json_agg(
                             json_build_object(
                                 'month', mr.month,
                                 'year', mr.year,
                                 'needs', mr.total_needed,
                                 'override_needs', o.quantity
                             )
                        ), '[]'::json)
                        FROM (
                            SELECT f.month, f.year, SUM(FLOOR(f.final_forecast * rec.quantity * 
                                CASE WHEN rec.use_size_calc THEN COALESCE(ps.size, 1) ELSE 1 END)
                            ) as total_needed
                            FROM "forecasts" f
                            JOIN "recipes" rec ON rec.product_id = f.product_id AND rec.is_active = true
                            JOIN "products" p ON p.id = f.product_id AND p.status = 'ACTIVE' AND p.deleted_at IS NULL
                            LEFT JOIN "product_size" ps ON ps.id = p.size_id
                            WHERE rec.raw_mat_id = fm.id
                              AND (f.year * 12 + f.month) >= ${fcStartY * 12 + fcStartM}
                              AND (f.year * 12 + f.month) <= ${fcEndY * 12 + fcEndM}
                            GROUP BY f.month, f.year
                        ) mr
                        LEFT JOIN "raw_material_need_overrides" o
                             ON o.raw_material_id = fm.id
                             AND o.month = mr.month
                             AND o.year = mr.year
                    ) AS needs_data,
                    (
                        SELECT json_build_object(
                            'id', mro_sub.id,
                            'status', mro_sub.status,
                            'pic_id', mro_sub.pic_id,
                            'quantity', mro_sub.quantity,
                            'horizon', mro_sub.horizon,
                            'hidden_at', mro_sub.hidden_at
                        )
                        FROM "material_purchase_drafts" mro_sub
                        WHERE mro_sub.raw_mat_id = fm.id
                          AND mro_sub.month = ${currentMonth}
                          AND mro_sub.year = ${currentYear}
                        LIMIT 1
                    ) AS work_order_data,
                    mro.hidden_at AS work_order_hidden_at

                FROM filtered_materials fm
                LEFT JOIN "material_purchase_drafts" mro 
                    ON mro.raw_mat_id = fm.id 
                    AND mro.month = ${currentMonth} 
                    AND mro.year = ${currentYear}
                LEFT JOIN LATERAL (
                    SELECT COALESCE(SUM(COALESCE(o.quantity, mr.calc_needed)), 0) AS total_needed
                    FROM (
                        SELECT f.month, f.year, SUM(FLOOR(f.final_forecast * rec.quantity * 
                            CASE WHEN rec.use_size_calc THEN COALESCE(ps.size, 1) ELSE 1 END)
                        ) as calc_needed
                        FROM "recipes" rec
                        JOIN "forecasts" f ON f.product_id = rec.product_id
                        JOIN "products" p ON p.id = f.product_id AND p.status = 'ACTIVE' AND p.deleted_at IS NULL
                        LEFT JOIN "product_size" ps ON ps.id = p.size_id
                        WHERE rec.raw_mat_id = fm.id
                          AND mro.horizon IS NOT NULL
                          AND (f.year * 12 + f.month) >= ${currentYear * 12 + currentMonth}
                          AND (f.year * 12 + f.month) <= (${currentYear} * 12 + ${currentMonth} + COALESCE(mro.horizon, 0) - 1)
                        GROUP BY f.month, f.year
                    ) mr
                    LEFT JOIN "raw_material_need_overrides" o 
                         ON o.raw_material_id = fm.id 
                         AND o.month = mr.month 
                         AND o.year = mr.year
                ) h_fc ON TRUE
                LEFT JOIN rm_forecast_agg fa ON fa.raw_mat_id = fm.id
                LEFT JOIN rm_stock_ss_agg sa ON sa.raw_mat_id = fm.id
                LEFT JOIN rm_current_sales_agg cms ON cms.raw_mat_id = fm.id
            ) AS base
            ORDER BY
                CASE WHEN barcode LIKE 'KA-%' THEN 0 ELSE 1 END ASC,
                CASE WHEN barcode = 'FO-ALK' THEN 1 ELSE 0 END ASC,
                ${
                    query.sortBy
                        ? query.sortBy === "material_name"
                            ? Prisma.sql`material_name ${query.order === "desc" ? Prisma.sql`DESC` : Prisma.sql`ASC`}`
                            : query.sortBy === "barcode"
                              ? Prisma.sql`barcode ${query.order === "desc" ? Prisma.sql`DESC` : Prisma.sql`ASC`}`
                              : query.sortBy === "current_stock"
                                ? Prisma.sql`current_stock ${query.order === "desc" ? Prisma.sql`DESC` : Prisma.sql`ASC`}`
                                : query.sortBy === "forecast_needed"
                                  ? Prisma.sql`forecast_needed ${query.order === "desc" ? Prisma.sql`DESC` : Prisma.sql`ASC`}`
                                  : query.sortBy === "recommendation_quantity"
                                    ? Prisma.sql`recommendation_quantity ${query.order === "desc" ? Prisma.sql`DESC` : Prisma.sql`ASC`}`
                                    : (type === 'ffo' 
                                        ? Prisma.sql`current_month_sales DESC, material_name ASC` 
                                        : Prisma.sql`material_name ASC`)
                        : (type === 'ffo' 
                            ? Prisma.sql`current_month_sales DESC, material_name ASC` 
                            : Prisma.sql`material_name ASC`)
                }
            LIMIT ${limit} OFFSET ${skip}
        `;

        const totalQuery = await prisma.$queryRaw<{ count: number }[]>`
            SELECT COUNT(rm.id)::int as count
            FROM "raw_materials" rm
            LEFT JOIN "raw_mat_categories" rmc ON rmc.id = rm.raw_mat_categories_id
            LEFT JOIN "unit_raw_materials" urm ON urm.id = rm.unit_id
            LEFT JOIN "supplier_materials" sm ON sm.raw_material_id = rm.id AND sm.is_preferred = true
            LEFT JOIN "suppliers" s ON s.id = sm.supplier_id
            WHERE ${typeFilter}
              AND rm.deleted_at IS NULL
              AND (rm.barcode IS NULL OR rm.barcode NOT LIKE 'DP120V1-%')
              AND rm.name NOT ILIKE '%(DISPLAY)%'
              AND EXISTS (
                  SELECT 1 FROM "recipes" r2
                  WHERE r2.raw_mat_id = rm.id AND r2.is_active = true
              )
              ${searchFilter}
        `;

        const data = rows.map((r) => {
            const salesRaw =
                typeof r.sales_data === "string" ? JSON.parse(r.sales_data) : r.sales_data || [];
            const needsRaw =
                typeof r.needs_data === "string" ? JSON.parse(r.needs_data) : r.needs_data || [];
            const poRaw = typeof r.po_data === "string" ? JSON.parse(r.po_data) : r.po_data || [];

            const sales = salesPeriods.map((p) => {
                const found = salesRaw.find((s: any) => s.month === p.month && s.year === p.year);
                return { ...p, quantity: Number(found?.sales || 0) };
            });

            const needs = forecastPeriods.map((p) => {
                const found = needsRaw.find((n: any) => n.month === p.month && n.year === p.year);
                return { 
                    ...p, 
                    quantity: Number(found?.needs || 0),
                    override_needs: found?.override_needs != null ? Number(found.override_needs) : null
                };
            });

            const open_pos = poPeriods.map((p) => {
                const found = poRaw.find((s: any) => s.month === p.month && s.year === p.year);
                return { ...p, quantity: Number(found?.quantity || 0) };
            });

            const workOrder =
                typeof r.work_order_data === "string"
                    ? JSON.parse(r.work_order_data)
                    : r.work_order_data;

            const horizon = workOrder?.horizon || 0;
            let isSpecial = false;
            let sheetToKgFactor = 1;

            if (r.barcode === 'KA-0.6MM') {
                isSpecial = true;
                sheetToKgFactor = 5000 / 14000;
            } else if (r.barcode === 'KA-0.4MM') {
                isSpecial = true;
                sheetToKgFactor = (144 * 5000) / 2946120;
            }

            // Base values from DB
            const currentStock = Number(r.current_stock);
            const openPo = Number(r.open_po);
            const forecastNeededRaw = Number(r.forecast_needed);
            const safetyStockRaw = Number(r.safety_stock_x_resep);
            const totalNeededHorizonRaw = Number(r.total_forecast_horizon_dynamic);

            // Converted values if special paper
            const forecastNeeded = isSpecial ? forecastNeededRaw * sheetToKgFactor : forecastNeededRaw;
            const safetyStock = isSpecial ? safetyStockRaw * sheetToKgFactor : safetyStockRaw;
            const totalNeededHorizon = isSpecial ? totalNeededHorizonRaw * sheetToKgFactor : totalNeededHorizonRaw;

            // Calculate Fixed 2-Month Horizon
            const totalNeededFix2MonthsRaw = (needs || [])
                .slice(0, 2)
                .reduce((sum, n) => sum + (n.override_needs ?? n.quantity ?? 0), 0);
            const totalNeededFix2Months = isSpecial ? totalNeededFix2MonthsRaw * sheetToKgFactor : totalNeededFix2MonthsRaw;

            // Recalculate recommendation specifically for special paper to avoid mixed units subtraction
            let recommendationQuantity = Number(r.recommendation_quantity);
            if (isSpecial && horizon > 0) {
                // (Total Need KG + Safety KG) - (Stock KG + PO KG)
                recommendationQuantity = Math.max(0, (totalNeededHorizon + safetyStock) - (currentStock + openPo));
            }

            return {
                ranking: Number(r.ranking),
                material_id: r.material_id,
                barcode: r.barcode,
                material_name: r.material_name,
                moq: Number(r.moq),
                lead_time: r.lead_time,
                uom: r.uom || "UNIT",
                current_stock: currentStock,
                open_po: openPo,
                stock_fg_x_resep: Number(r.stock_fg_x_resep),
                safety_stock_x_resep: safetyStock,
                forecast_needed: forecastNeeded,
                total_needed_horizon: totalNeededHorizon,
                total_needed_fix_2_months: totalNeededFix2Months,
                recommendation_quantity: recommendationQuantity,
                is_special_paper: isSpecial,
                weight_kg: isSpecial ? recommendationQuantity : undefined,

                // Work Order / Consolidation data
                work_order_id: workOrder?.id || null,
                work_order_status: workOrder?.status || null,
                work_order_pic_id: workOrder?.pic_id || null,
                work_order_quantity: workOrder?.quantity ? Number(workOrder.quantity) : null,
                work_order_horizon: horizon || null,
                work_order_hidden_at: workOrder?.hidden_at ? new Date(workOrder.hidden_at) : null,

                sales,
                needs: needs.map(n => ({
                    ...n,
                    quantity: isSpecial ? n.quantity * sheetToKgFactor : n.quantity,
                    override_needs: (isSpecial && n.override_needs != null) ? n.override_needs * sheetToKgFactor : n.override_needs
                })),
                open_pos,
            };
        });

        return {
            data,
            len: Number(totalQuery[0]?.count || 0),
            periods: {
                sales_periods: salesPeriods,
                forecast_periods: forecastPeriods,
                po_periods: poPeriods,
            },
        };
    }

    static async saveWorkOrder(body: RequestSaveWorkOrderDTO) {
        const {
            raw_mat_id,
            month,
            year,
            quantity,
            horizon,
            total_needed,
            current_stock,
            stock_fg_x_resep,
            safety_stock_x_resep,
        } = body;

        return await prisma.$transaction(async (tx) => {
            const existing = await tx.materialPurchaseDraft.findUnique({
                where: { raw_mat_id_month_year: { raw_mat_id, month, year } },
                select: { status: true, open_po_id: true },
            });

            const result = await tx.materialPurchaseDraft.upsert({
                where: { raw_mat_id_month_year: { raw_mat_id, month, year } },
                update: {
                    quantity,
                    horizon,
                    total_needed,
                    current_stock,
                    stock_fg_x_resep,
                    safety_stock_x_resep,
                    updated_at: new Date(),
                },
                create: {
                    raw_mat_id,
                    month,
                    year,
                    quantity,
                    horizon,
                    total_needed,
                    current_stock,
                    stock_fg_x_resep,
                    safety_stock_x_resep,
                    status: "DRAFT",
                },
            });

            // Sync OpenPO quantity when editing an already-approved draft
            if (existing?.status === "ACC" && existing.open_po_id) {
                await tx.rawMaterialOpenPo.update({
                    where: { id: existing.open_po_id },
                    data: { quantity },
                });
            }

            return result;
        });
    }

    static async saveNeedOverride(body: RequestSaveNeedOverrideDTO) {
        const { raw_material_id, month, year, quantity } = body;

        const material = await prisma.rawMaterial.findUnique({
            where: { id: raw_material_id },
            select: { barcode: true },
        });

        const barcode = material?.barcode ?? "";
        const isKa = barcode.startsWith("KA-");
        const isKtp = barcode.startsWith("KTP-") || barcode.startsWith("KTL-") || barcode.startsWith("KTB-");

        await prisma.rawMaterialNeedOverride.upsert({
            where: { raw_material_id_month_year: { raw_material_id, month, year } },
            update: { quantity },
            create: { raw_material_id, month, year, quantity },
        });

        let cascadeCount = 0;

        if (isKa) {
            // Forward cascade: KA override → set same value for all linked KTP/KTL/KTB
            const relatedIds = await RecomendationV2Service.findKaCascadedMaterials(raw_material_id);
            cascadeCount = relatedIds.length;
            if (relatedIds.length > 0) {
                await Promise.all(
                    relatedIds.map((id) =>
                        prisma.rawMaterialNeedOverride.upsert({
                            where: { raw_material_id_month_year: { raw_material_id: id, month, year } },
                            update: { quantity },
                            create: { raw_material_id: id, month, year, quantity },
                        }),
                    ),
                );
            }
        } else if (isKtp) {
            // Reverse cascade: KTP/KTL/KTB override → recalculate linked KA-%
            const kaIds = await RecomendationV2Service.findKaParentMaterials(raw_material_id);
            cascadeCount = kaIds.length;
            for (const kaId of kaIds) {
                const { need } = await RecomendationV2Service.recalculateKaNeedForPeriod(kaId, month, year);
                await prisma.rawMaterialNeedOverride.upsert({
                    where: { raw_material_id_month_year: { raw_material_id: kaId, month, year } },
                    update: { quantity: need },
                    create: { raw_material_id: kaId, month, year, quantity: need },
                });
            }
        }

        return { message: "Override berhasil disimpan", cascaded: cascadeCount };
    }

    static async deleteNeedOverride(body: { raw_material_id: number; month: number; year: number }) {
        const { raw_material_id, month, year } = body;

        const material = await prisma.rawMaterial.findUnique({
            where: { id: raw_material_id },
            select: { barcode: true },
        });

        const barcode = material?.barcode ?? "";
        const isKa = barcode.startsWith("KA-");
        const isKtp = barcode.startsWith("KTP-") || barcode.startsWith("KTL-") || barcode.startsWith("KTB-");
        let cascadeCount = 0;

        if (isKa) {
            // Forward cascade reset: also delete overrides for all linked KTP/KTL/KTB
            const relatedIds = await RecomendationV2Service.findKaCascadedMaterials(raw_material_id);
            cascadeCount = relatedIds.length;
            await prisma.rawMaterialNeedOverride.deleteMany({
                where: {
                    raw_material_id: { in: [...relatedIds, raw_material_id] },
                    month,
                    year,
                },
            });
        } else if (isKtp) {
            // Delete the KTP override first
            await prisma.rawMaterialNeedOverride.deleteMany({
                where: { raw_material_id, month, year },
            });
            // Reverse cascade reset: recalculate linked KA-% without this override
            const kaIds = await RecomendationV2Service.findKaParentMaterials(raw_material_id);
            cascadeCount = kaIds.length;
            for (const kaId of kaIds) {
                const { need, hasKtpOverride } = await RecomendationV2Service.recalculateKaNeedForPeriod(kaId, month, year);
                if (hasKtpOverride) {
                    // Other KTP overrides remain — update KA with new recalculated value
                    await prisma.rawMaterialNeedOverride.upsert({
                        where: { raw_material_id_month_year: { raw_material_id: kaId, month, year } },
                        update: { quantity: need },
                        create: { raw_material_id: kaId, month, year, quantity: need },
                    });
                } else {
                    // No more KTP overrides — revert KA to system calculation
                    await prisma.rawMaterialNeedOverride.deleteMany({
                        where: { raw_material_id: kaId, month, year },
                    });
                }
            }
        } else {
            await prisma.rawMaterialNeedOverride.deleteMany({
                where: { raw_material_id, month, year },
            });
        }

        return { message: "Need override reset to system calculation", cascaded: cascadeCount };
    }

    private static async findKaCascadedMaterials(raw_material_id: number): Promise<number[]> {
        const related = await prisma.$queryRaw<{ id: number }[]>`
            SELECT DISTINCT rm.id
            FROM raw_materials rm
            JOIN recipes rec1 ON rec1.raw_mat_id = rm.id AND rec1.is_active = true
            WHERE (rm.barcode LIKE 'KTP-%' OR rm.barcode LIKE 'KTL-%' OR rm.barcode LIKE 'KTB-%')
              AND EXISTS (
                SELECT 1 FROM recipes rec2
                WHERE rec2.product_id = rec1.product_id
                  AND rec2.is_active = true
                  AND rec2.raw_mat_id = ${raw_material_id}
              )
        `;
        return related.map((r) => Number(r.id));
    }

    private static async findKaParentMaterials(ktp_material_id: number): Promise<number[]> {
        const result = await prisma.$queryRaw<{ id: number }[]>`
            SELECT DISTINCT rm.id
            FROM raw_materials rm
            JOIN recipes rec1 ON rec1.raw_mat_id = rm.id AND rec1.is_active = true
            WHERE rm.barcode LIKE 'KA-%'
              AND EXISTS (
                SELECT 1 FROM recipes rec2
                WHERE rec2.product_id = rec1.product_id
                  AND rec2.is_active = true
                  AND rec2.raw_mat_id = ${ktp_material_id}
              )
        `;
        return result.map((r) => Number(r.id));
    }

    /**
     * Recalculates KA-% need (in sheets) for a period based on current KTP/KTL/KTB overrides.
     * For each product using this KA-% material:
     *   - If that product's KTP/KTL/KTB has an override: derive effective product demand = override / ktp_recipe_qty
     *   - Else: use final_forecast
     * Returns the total sheets and whether any KTP override was found.
     */
    private static async recalculateKaNeedForPeriod(
        ka_material_id: number,
        month: number,
        year: number,
    ): Promise<{ need: number; hasKtpOverride: boolean }> {
        const kaRecipes = await prisma.$queryRaw<{ product_id: number; ka_recipe_qty: number }[]>`
            SELECT rec.product_id::int, rec.quantity::numeric AS ka_recipe_qty
            FROM recipes rec
            JOIN products p ON p.id = rec.product_id AND p.status = 'ACTIVE' AND p.deleted_at IS NULL
            WHERE rec.raw_mat_id = ${ka_material_id}
              AND rec.is_active = true
        `;

        if (kaRecipes.length === 0) return { need: 0, hasKtpOverride: false };

        const productIds = kaRecipes.map((r) => Number(r.product_id));

        // Find KTP/KTL/KTB overrides for these products this period
        const ktpOverrides = await prisma.$queryRaw<{
            product_id: number;
            override_qty: number;
            ktp_recipe_qty: number;
        }[]>`
            SELECT DISTINCT ON (rec.product_id)
                rec.product_id::int,
                o.quantity::numeric AS override_qty,
                rec.quantity::numeric AS ktp_recipe_qty
            FROM recipes rec
            JOIN raw_materials rm ON rm.id = rec.raw_mat_id
            JOIN raw_material_need_overrides o
                ON o.raw_material_id = rec.raw_mat_id
                AND o.month = ${month} AND o.year = ${year}
            WHERE rec.product_id = ANY(ARRAY[${Prisma.join(productIds)}]::int[])
              AND rec.is_active = true
              AND (rm.barcode LIKE 'KTP-%' OR rm.barcode LIKE 'KTL-%' OR rm.barcode LIKE 'KTB-%')
            ORDER BY rec.product_id, rec.raw_mat_id
        `;

        const overrideMap = new Map<number, { override_qty: number; ktp_recipe_qty: number }>();
        for (const o of ktpOverrides) {
            overrideMap.set(Number(o.product_id), {
                override_qty: Number(o.override_qty),
                ktp_recipe_qty: Number(o.ktp_recipe_qty),
            });
        }

        const productsNeedingForecast = productIds.filter((pid) => !overrideMap.has(pid));
        const forecastMap = new Map<number, number>();

        if (productsNeedingForecast.length > 0) {
            const forecasts = await prisma.forecast.findMany({
                where: { product_id: { in: productsNeedingForecast }, month, year },
                select: { product_id: true, final_forecast: true },
            });
            for (const f of forecasts) {
                forecastMap.set(f.product_id, Number(f.final_forecast));
            }
        }

        let kaNeed = 0;
        for (const r of kaRecipes) {
            const pid = Number(r.product_id);
            const ov = overrideMap.get(pid);
            const effective_demand =
                ov && ov.ktp_recipe_qty > 0
                    ? ov.override_qty / ov.ktp_recipe_qty
                    : (forecastMap.get(pid) ?? 0);
            kaNeed += effective_demand * Number(r.ka_recipe_qty);
        }

        return { need: Math.round(kaNeed), hasKtpOverride: overrideMap.size > 0 };
    }

    static async approveWorkOrder(body: RequestApproveWorkOrderDTO, userId: string) {
        return await prisma.$transaction(async (tx) => {
            const rec = await tx.materialPurchaseDraft.findUniqueOrThrow({
                where: { id: body.id },
            });

            if (rec.status !== "DRAFT") {
                throw new Error("Only DRAFT work orders can be approved.");
            }

            const userExists = await tx.user.findUnique({
                where: { id: userId },
                select: { id: true },
            });

            return await tx.materialPurchaseDraft.update({
                where: { id: body.id },
                data: {
                    status: "ACC",
                    pic_id: userExists ? userId : null,
                },
            });
        });
    }

    static async destroyWorkOrder(id: number) {
        const rec = await prisma.materialPurchaseDraft.findUnique({
            where: { id },
        });

        if (!rec) throw new Error("Work order not found.");

        if (rec.status === "DRAFT" || rec.status === "ACC") {
            return await prisma.materialPurchaseDraft.delete({ where: { id } });
        }

        throw new Error(`Work order dengan status "${rec.status}" tidak dapat dihapus.`);
    }

    static async bulkSaveHorizon(body: RequestBulkSaveHorizonDTO) {
        const { month, year, horizon, type } = body;

        const typeFilter = RecomendationV2Service.getTypeFilter(type);

        const [latestInv, latestFgInv] = await Promise.all([
            prisma.rawMaterialInventory.findFirst({
                orderBy: [{ year: "desc" }, { month: "desc" }],
                select: { month: true, year: true },
            }),
            prisma.productInventory.findFirst({
                orderBy: [{ year: "desc" }, { month: "desc" }],
                select: { month: true, year: true },
            }),
        ]);

        const { month: invMonth, year: invYear } = RecomendationV2Service.resolveInvPeriod(
            { month, year }, latestInv
        );
        const { month: fgInvMonth, year: fgInvYear } = RecomendationV2Service.resolveInvPeriod(
            { month, year }, latestFgInv
        );

        const fcStartM = month;
        const fcStartY = year;

        let fcEndM = month + horizon - 1;
        let fcEndY = year;
        while (fcEndM > 12) {
            fcEndM -= 12;
            fcEndY += 1;
        }

        const now = new Date();
        const fcStart = fcStartY * 12 + fcStartM;
        const fcEnd = fcEndY * 12 + fcEndM;

        // Fixed 4-month range for Safety Stock, independent of horizon
        const FIXED_SS_MONTHS = 4;
        let bssEndM = month + FIXED_SS_MONTHS - 1;
        let bssEndY = year;
        while (bssEndM > 12) { bssEndM -= 12; bssEndY += 1; }
        const bssStart = year * 12 + month;
        const bssEnd = bssEndY * 12 + bssEndM;

        return await prisma.$executeRaw`
            WITH
                inv_agg AS (
                    SELECT 
                        rmi.raw_material_id, 
                        GREATEST(0,
                            SUM(rmi.quantity)::numeric
                            - COALESCE((
                                SELECT SUM(poi.quantity_planned)
                                FROM "production_order_items" poi
                                JOIN "production_orders" po ON poi.production_order_id = po.id
                                WHERE poi.raw_material_id = rmi.raw_material_id
                                  AND po.status = 'RELEASED'
                            ), 0)
                        ) AS total
                    FROM "raw_material_inventories" rmi
                    WHERE rmi.month = ${invMonth} AND rmi.year = ${invYear}
                    GROUP BY rmi.raw_material_id
                ),
                fc_agg AS (
                    SELECT rec.raw_mat_id, SUM(f.final_forecast * rec.quantity *
                        CASE WHEN rm2.type = 'FO' OR urm2.name ILIKE ANY(ARRAY['ml', 'l', 'liter', 'ML']) THEN COALESCE(ps.size, 1) ELSE 1 END
                    )::numeric AS total
                    FROM "forecasts" f
                    JOIN "recipes" rec ON rec.product_id = f.product_id AND rec.is_active = true
                    JOIN "raw_materials" rm2 ON rm2.id = rec.raw_mat_id
                    LEFT JOIN "unit_raw_materials" urm2 ON urm2.id = rm2.unit_id
                    JOIN "products" p ON p.id = f.product_id AND p.status = 'ACTIVE' AND p.deleted_at IS NULL
                    LEFT JOIN "product_size" ps ON ps.id = p.size_id
                    WHERE (f.year * 12 + f.month) >= ${fcStart} AND (f.year * 12 + f.month) <= ${fcEnd}
                    GROUP BY rec.raw_mat_id
                ),
                ss_agg AS (
                    SELECT
                        rec.raw_mat_id,
                        SUM(
                            (
                                (SELECT COALESCE(SUM(f2.final_forecast), 0)
                                 FROM "forecasts" f2
                                 WHERE f2.product_id = p.id
                                   AND (f2.year * 12 + f2.month) >= ${bssStart}
                                   AND (f2.year * 12 + f2.month) <= ${bssEnd}
                                ) / ${FIXED_SS_MONTHS}::numeric * p.safety_percentage
                            ) * rec.quantity *
                            CASE WHEN rm2.type = 'FO' OR urm2.name ILIKE ANY(ARRAY['ml', 'l', 'liter', 'ML']) THEN COALESCE(ps.size, 1) ELSE 1 END
                        )::numeric AS total
                    FROM "recipes" rec
                    JOIN "raw_materials" rm2 ON rm2.id = rec.raw_mat_id
                    LEFT JOIN "unit_raw_materials" urm2 ON urm2.id = rm2.unit_id
                    JOIN "products" p ON p.id = rec.product_id AND p.status = 'ACTIVE' AND p.deleted_at IS NULL
                    LEFT JOIN "product_size" ps ON ps.id = p.size_id
                    WHERE rec.is_active = true
                    GROUP BY rec.raw_mat_id
                ),
                fg_agg AS (
                    SELECT rec.raw_mat_id, SUM(pi_sub.total_qty * rec.quantity *
                        CASE WHEN rm2.type = 'FO' OR urm2.name ILIKE ANY(ARRAY['ml', 'l', 'liter', 'ML']) THEN COALESCE(ps.size, 1) ELSE 1 END
                    )::numeric AS total
                    FROM "recipes" rec
                    JOIN "raw_materials" rm2 ON rm2.id = rec.raw_mat_id
                    LEFT JOIN "unit_raw_materials" urm2 ON urm2.id = rm2.unit_id
                    JOIN "products" p ON p.id = rec.product_id AND p.status = 'ACTIVE' AND p.deleted_at IS NULL
                    LEFT JOIN "product_size" ps ON ps.id = p.size_id
                    JOIN (
                        SELECT product_id, SUM(quantity) AS total_qty
                        FROM "product_inventories"
                        WHERE month = ${fgInvMonth} AND year = ${fgInvYear}
                        GROUP BY product_id
                    ) pi_sub ON pi_sub.product_id = rec.product_id
                    WHERE rec.is_active = true
                    GROUP BY rec.raw_mat_id
                )
            INSERT INTO "material_purchase_drafts" (
                raw_mat_id, month, year, quantity, horizon,
                total_needed, current_stock, stock_fg_x_resep, safety_stock_x_resep,
                created_at, updated_at, status
            )
            SELECT
                rm.id AS raw_mat_id,
                ${month} AS month,
                ${year} AS year,
                0 AS quantity,
                ${horizon} AS horizon,
                COALESCE(fc.total, 0) AS total_needed,
                CASE
                    WHEN rm.barcode LIKE 'KTP-%' OR rm.barcode LIKE 'KTB-%' OR rm.barcode LIKE 'KTL-%' OR rm.barcode LIKE 'KEM-%'
                    THEN COALESCE(fg.total, 0)
                    ELSE COALESCE(inv.total, 0)
                END AS current_stock,
                COALESCE(fg.total, 0) AS stock_fg_x_resep,
                COALESCE(ss.total, 0) AS safety_stock_x_resep,
                ${now} AS created_at,
                ${now} AS updated_at,
                'DRAFT' AS status
            FROM "raw_materials" rm
            LEFT JOIN "raw_mat_categories" rmc ON rmc.id = rm.raw_mat_categories_id
            LEFT JOIN "supplier_materials" sm ON sm.raw_material_id = rm.id AND sm.is_preferred = true
            LEFT JOIN "suppliers" s ON s.id = sm.supplier_id
            LEFT JOIN inv_agg inv ON inv.raw_material_id = rm.id
            LEFT JOIN fc_agg fc ON fc.raw_mat_id = rm.id
            LEFT JOIN ss_agg ss ON ss.raw_mat_id = rm.id
            LEFT JOIN fg_agg fg ON fg.raw_mat_id = rm.id
            WHERE ${typeFilter}
              AND rm.deleted_at IS NULL
              AND (rm.barcode IS NULL OR rm.barcode NOT LIKE 'DP120V1-%')
              AND rm.name NOT ILIKE '%(DISPLAY)%'
              AND EXISTS (
                  SELECT 1 FROM "recipes" r2
                  WHERE r2.raw_mat_id = rm.id AND r2.is_active = true
              )
            ON CONFLICT (raw_mat_id, month, year) DO NOTHING;
        `;
    }

    static async export(query: QueryRecomendationV2DTO) {
        let { data, periods: meta } = await this.list({ ...query, take: 1000000, page: 1 });

        // Filter by selected IDs if provided (comma-separated material_id list)
        if (query.selectedIds) {
            const ids = query.selectedIds.split(",").map(Number).filter(Boolean);
            if (ids.length > 0) {
                data = data.filter((row: any) => ids.includes(row.material_id));
            }
        }

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Rekomendasi V2");

        const monthsShort = [
            "Jan",
            "Feb",
            "Mar",
            "Apr",
            "Mei",
            "Jun",
            "Jul",
            "Ags",
            "Sep",
            "Okt",
            "Nov",
            "Des",
        ];

        const visibleCols = query.visibleColumns ? query.visibleColumns.split(",") : null;

        // Custom filter function to check if a column should be included in export
        const isVisible = (uiId: string) => {
            if (!visibleCols) return true;
            return visibleCols.includes(uiId);
        };

        // Define All Possible Columns
        const allColumns: any[] = [
            { header: "RANK", key: "ranking", width: 8, uiId: "ranking" },
            { header: "BARCODE", key: "barcode", width: 15, uiId: "material_name" },
            { header: "MATERIAL", key: "material_name", width: 35, uiId: "material_name" },
            { header: "MOQ", key: "moq", width: 10, uiId: "moq" },
            {
                header: "SAFETY STOCK",
                key: "safety_stock_x_resep",
                width: 18,
                uiId: "safety_stock_x_resep",
            },
            { header: "LT", key: "lead_time", width: 10, uiId: "lead_time" },
            { header: "CURRENT STOCK", key: "current_stock", width: 15, uiId: "current_stock" },
            {
                header: "CURRENT STOCK + OPEN PO",
                key: "total_stock",
                width: 15,
                uiId: "available_stock",
            },
        ];

        // Dynamic Sales Headers
        meta.sales_periods?.forEach((p: any) => {
            const yearShort = String(p.year).slice(-2);
            allColumns.push({
                header: `SALES ${monthsShort[p.month - 1]?.toLocaleUpperCase()}${yearShort}`,
                key: `sales_${p.key}`,
                width: 15,
                uiId: "sales_history",
            });
        });

        // Dynamic Need Headers (with forecast percentage)
        meta.forecast_periods?.forEach((p: any) => {
            const yearShort = String(p.year).slice(-2);
            const pctLabel = p.percentage !== undefined && p.percentage !== null
                ? ` (${p.percentage > 0 ? "+" : ""}${(p.percentage * 100).toFixed(0)}%)`
                : "";
            allColumns.push({
                header: `NEED BUY ${monthsShort[p.month - 1]?.toLocaleUpperCase()}${yearShort}${pctLabel}`,
                key: `need_${p.key}`,
                width: 18,
                uiId: "needs_buy",
            });
        });

        // Remaining Fixed Columns
        allColumns.push(
            { header: "TOTAL NEED", key: "total_needed", width: 15, uiId: "total_needs" },
            {
                header: "REKOMENDASI",
                key: "recommendation_quantity",
                width: 15,
                uiId: "recommendation_quantity",
            },
            { header: "TOTAL OPEN PO", key: "open_po", width: 15, uiId: "total_open_po" },
            { header: "WORK ORDER", key: "work_order_quantity", width: 15, uiId: "action" },
        );

        // Filter based on visibility
        const filteredColumns = allColumns.filter((col) => {
            if (!col.uiId) return true;
            return isVisible(col.uiId);
        });

        // Apply custom order if provided
        if (query.columnOrder) {
            const orderArr = query.columnOrder.split(",");
            filteredColumns.sort((a, b) => {
                const uiIdA = a.uiId || "";
                const uiIdB = b.uiId || "";

                const indexA = orderArr.indexOf(uiIdA);
                const indexB = orderArr.indexOf(uiIdB);

                if (indexA !== -1 && indexB !== -1) {
                    if (indexA === indexB) return 0; // Same group (like barcode & material)
                    return indexA - indexB;
                }

                if (indexA !== -1) return -1;
                if (indexB !== -1) return 1;
                return 0;
            });
        }

        sheet.columns = filteredColumns;

        data.forEach((row: any) => {
            const currentStock = Math.round(row.current_stock || 0);
            const openPo = Math.round(row.open_po || 0);

            // Calculate total need based on horizon (Only if set by PIC)
            const h = row.work_order_horizon || 0;
            const hasNeeds = row.needs && row.needs.length > 0;
            const totalNeeded =
                h > 0 && hasNeeds
                    ? (row.needs || [])
                          .slice(0, h)
                          .reduce((sum: number, n: any) => sum + (n.override_needs ?? n.quantity ?? 0), 0)
                    : null;

            const formattedRow: any = {
                ...row,
                current_stock: currentStock,
                safety_stock_x_resep: Math.round(row.safety_stock_x_resep || 0),
                recommendation_quantity:
                    h > 0 ? Math.round(row.recommendation_quantity || 0) : null,
                open_po: openPo,
                total_stock: currentStock + openPo,
                total_needed: totalNeeded !== null ? Math.round(totalNeeded) : null,
                // Show Work Order Qty even if it is still a DRAFT
                work_order_quantity:
                    row.work_order_quantity ? Math.round(row.work_order_quantity) : null,
            };

            // Map Sales
            row.sales?.forEach((s: any) => {
                formattedRow[`sales_${s.key}`] = Math.round(s.quantity || 0);
            });

            // Map Needs
            row.needs?.forEach((n: any) => {
                formattedRow[`need_${n.key}`] = Math.round(n.override_needs ?? n.quantity ?? 0);
            });

            sheet.addRow(formattedRow);
        });

        const buffer = await workbook.csv.writeBuffer();
        return buffer;
    }

    static async updateMoq(body: RequestUpdateMoqDTO) {
        const { material_id, moq } = body;
        return await prisma.supplierMaterial.updateMany({
            where: { raw_material_id: material_id, is_preferred: true },
            data: { min_buy: moq },
        });
    }

    static async bulkToggleHide(body: RequestBulkHideDTO) {
        const { ids, hidden } = body;
        return await prisma.materialPurchaseDraft.updateMany({
            where: { id: { in: ids } },
            data: { hidden_at: hidden ? new Date() : null },
        });
    }

    private static getTypeFilter(type?: string): Prisma.Sql {
        const excludeTester = Prisma.sql`AND (rm.barcode IS NULL OR (rm.barcode NOT LIKE 'KTL-%' AND rm.barcode NOT LIKE 'KTP-%' AND rm.barcode NOT LIKE 'KA-%' AND rm.barcode NOT LIKE 'KTB-%'))`;
        switch (type) {
            case "ffo":
                return Prisma.sql`(rmc.slug ILIKE '%fragrance-oil%' OR rmc.slug ILIKE '%ffo%')`;
            case "lokal":
                return Prisma.sql`(rmc.slug IS NULL OR rmc.slug NOT ILIKE '%fragrance-oil%') AND s.source = 'LOCAL' ${excludeTester}`;
            case "impor":
                return Prisma.sql`(rmc.slug IS NULL OR rmc.slug NOT ILIKE '%fragrance-oil%') AND s.source = 'IMPORT' ${excludeTester}`;
            case "tester":
                return Prisma.sql`(rmc.slug IS NULL OR rmc.slug NOT ILIKE '%fragrance-oil%') AND (rm.barcode LIKE 'KTL-%' OR rm.barcode LIKE 'KTP-%' OR rm.barcode LIKE 'KA-%' OR rm.barcode LIKE 'KTB-%')`;
            default:
                return Prisma.sql`1=1`;
        }
    }

    private static buildSearchFilter(search?: string): Prisma.Sql {
        const cleanSearch = search?.trim();
        return cleanSearch
            ? Prisma.sql`AND (
                rm.name ILIKE '%' || ${cleanSearch} || '%'
                OR rm.barcode ILIKE '%' || ${cleanSearch} || '%'
                OR rmc.name ILIKE '%' || ${cleanSearch} || '%'
                OR urm.name ILIKE '%' || ${cleanSearch} || '%'
              )`
            : Prisma.empty;
    }

    private static resolveInvPeriod(
        current: { month: number; year: number },
        latest: { month: number; year: number } | null
    ): { month: number; year: number } {
        if (!latest) return current;
        return (current.year * 12 + current.month) > (latest.year * 12 + latest.month)
            ? { month: latest.month, year: latest.year }
            : current;
    }
}
