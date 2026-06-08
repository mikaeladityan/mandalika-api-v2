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
    QueryOpenPoCellDTO,
    RequestCreateOpenPoCellDTO,
    RequestUpdateOpenPoCellQtyDTO,
} from "./recomendation-v2.schema.js";
import { GetPagination } from "../../../lib/utils/pagination.js";
import { ISSUANCE_THRESHOLD_PERIOD } from "../shared/constants.js";
import * as ExcelJS from "exceljs";
import { ApiError } from "../../../lib/errors/api.error.js";
import { logger } from "../../../lib/logger.js";

const EDITABLE_PO_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "ORDERED"] as const;
type EditablePOStatus = typeof EDITABLE_PO_STATUSES[number];

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
                    (
                        COALESCE((
                            SELECT SUM(po.quantity)
                            FROM "raw_material_open_pos" po
                            WHERE po.raw_material_id = fm.id AND po.status = 'OPEN'
                        ), 0)
                        +
                        COALESCE((
                            SELECT SUM(poi.qty_ordered - poi.qty_received)
                            FROM "purchase_order_items" poi
                            JOIN "purchase_orders" po ON poi.po_id = po.id
                            WHERE poi.raw_material_id = fm.id
                              AND po.status IN ('SUBMITTED', 'APPROVED', 'ORDERED')
                        ), 0)
                    ) AS open_po,

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

    static async listOpenPoCell(query: QueryOpenPoCellDTO) {
        const { raw_mat_id, month, year } = query;

        type ModernRow = {
            item_id: number;
            po_id: number;
            po_number: string;
            po_status: string;
            supplier_id: number | null;
            supplier_name: string;
            qty_ordered: number;
            qty_received: number;
            open_qty: number;
            unit_price: number;
            uom: string;
            po_date: Date;
        };

        const modernRows = await prisma.$queryRaw<ModernRow[]>`
            SELECT
                poi.id                                       AS item_id,
                poi.po_id                                    AS po_id,
                po.po_number                                 AS po_number,
                po.status::text                              AS po_status,
                po.supplier_id                               AS supplier_id,
                po.supplier_name                             AS supplier_name,
                poi.qty_ordered::float                       AS qty_ordered,
                poi.qty_received::float                      AS qty_received,
                (poi.qty_ordered - poi.qty_received)::float  AS open_qty,
                poi.unit_price::float                        AS unit_price,
                poi.uom                                      AS uom,
                po.po_date                                   AS po_date
            FROM purchase_order_items poi
            JOIN purchase_orders po ON po.id = poi.po_id
            WHERE poi.raw_material_id = ${raw_mat_id}
              AND po.status::text IN ('DRAFT','SUBMITTED','APPROVED','ORDERED')
              AND poi.qty_received < poi.qty_ordered
              AND EXTRACT(MONTH FROM po.po_date) = ${month}
              AND EXTRACT(YEAR  FROM po.po_date) = ${year}
            ORDER BY po.po_date DESC, po.po_number ASC
        `;

        const now = new Date();
        const isCurrentMonth = month === now.getMonth() + 1 && year === now.getFullYear();
        let legacyRows: Array<{ item_id: number; quantity: number; po_date: Date }> = [];
        if (isCurrentMonth) {
            try {
                legacyRows = await prisma.$queryRaw<typeof legacyRows>`
                    SELECT
                        rmop.id              AS item_id,
                        rmop.quantity::float AS quantity,
                        rmop.created_at      AS po_date
                    FROM raw_material_open_pos rmop
                    WHERE rmop.raw_material_id = ${raw_mat_id}
                      AND rmop.status = 'OPEN'
                `;
            } catch {
                legacyRows = [];
            }
        }

        return {
            items: modernRows.map((r) => ({
                item_id: Number(r.item_id),
                po_id: Number(r.po_id),
                po_number: r.po_number,
                po_status: r.po_status as "DRAFT" | "SUBMITTED" | "APPROVED" | "ORDERED",
                supplier_id: r.supplier_id ? Number(r.supplier_id) : null,
                supplier_name: r.supplier_name,
                qty_ordered: Number(r.qty_ordered),
                qty_received: Number(r.qty_received),
                open_qty: Number(r.open_qty),
                unit_price: Number(r.unit_price),
                uom: r.uom,
                po_date: r.po_date.toISOString(),
                is_legacy: false,
            })),
            legacy: legacyRows.map((r) => ({
                item_id: Number(r.item_id),
                po_id: 0,
                po_number: `LEGACY-${r.item_id}`,
                po_status: "ORDERED" as const,
                supplier_id: null,
                supplier_name: "Legacy entry",
                qty_ordered: Number(r.quantity),
                qty_received: 0,
                open_qty: Number(r.quantity),
                unit_price: 0,
                uom: "UNIT",
                po_date: new Date(r.po_date).toISOString(),
                is_legacy: true,
            })),
            legacy_count: legacyRows.length,
        };
    }

    static async createOpenPoCell(body: RequestCreateOpenPoCellDTO, userId: string) {
        const { raw_mat_id, month, year, quantity, supplier_id } = body;
        const MAX_RETRIES = 20;
        // Tagged per-request so we can correlate all retry attempts in logs.
        const traceId = `open-po-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

        let lastError: unknown = null;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                return await prisma.$transaction(async (tx) => {
                    // Serialize concurrent createOpenPoCell calls. Released on tx end.
                    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('po_number_seq'))`;

                    const rm = await tx.rawMaterial.findUnique({
                        where: { id: raw_mat_id },
                        include: {
                            unit_raw_material: { select: { name: true } },
                            raw_mat_category: { select: { name: true } },
                            supplier_materials: {
                                select: { min_buy: true },
                                take: 1,
                                orderBy: { is_preferred: "desc" },
                            },
                        },
                    });
                    if (!rm) throw new ApiError(404, "Raw material tidak ditemukan");

                    const resolved = await this.resolveSupplierAndPrice(tx, raw_mat_id, supplier_id);

                    const today = new Date();
                    const datePrefix = `PO-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}-`;
                    // Defensive MAX: only consider purely-numeric suffixes so a malformed
                    // legacy row (e.g. "PO-20260604-X" from a manual entry) can't poison
                    // the result via CAST exception or wrong order.
                    const maxRows = await tx.$queryRaw<{ max_seq: number | null }[]>`
                        SELECT MAX(CAST(SUBSTRING(po_number FROM ${datePrefix.length + 1}) AS INTEGER)) AS max_seq
                        FROM purchase_orders
                        WHERE po_number LIKE ${datePrefix + "%"}
                          AND SUBSTRING(po_number FROM ${datePrefix.length + 1}) ~ '^[0-9]+$'
                    `;
                    // Bump by attempt with growing offset + jitter so concurrent
                    // retriers don't lockstep into each other on the same value.
                    const jump = attempt === 0 ? 1 : 1 + attempt * 10 + Math.floor(Math.random() * 50);
                    const nextSeq = Number(maxRows[0]?.max_seq ?? 0) + jump;
                    const poNumber = `${datePrefix}${String(nextSeq).padStart(3, "0")}`;
                    logger.info("createOpenPoCell attempt", {
                        traceId,
                        attempt,
                        datePrefix,
                        max_seq: Number(maxRows[0]?.max_seq ?? 0),
                        jump,
                        nextSeq,
                        poNumber,
                    });
                    const poDate = new Date(Date.UTC(year, month - 1, 1));
                    const unitPrice = resolved.unit_price;
                    const subtotal = quantity * unitPrice;

                    const moq = rm.supplier_materials[0]?.min_buy ?? null;

                    const po = await tx.purchaseOrder.create({
                        data: {
                            po_number: poNumber,
                            po_date: poDate,
                            po_type: "LOCAL",
                            supplier_id: resolved.supplier_id,
                            supplier_name: resolved.supplier_name,
                            currency: "IDR",
                            exchange_rate: 1,
                            total_estimated: subtotal,
                            status: "ORDERED",
                            approved_by: userId,
                            approved_at: new Date(),
                            ordered_at: new Date(),
                            created_by: userId,
                            items: {
                                create: {
                                    raw_material_id: rm.id,
                                    item_code: rm.barcode || `RM-${rm.id}`,
                                    item_name: rm.name,
                                    item_category: rm.raw_mat_category?.name ?? null,
                                    item_type: "MASTER",
                                    uom: rm.unit_raw_material?.name || "UNIT",
                                    moq,
                                    unit_price: unitPrice,
                                    qty_ordered: quantity,
                                    subtotal,
                                },
                            },
                        },
                        include: { items: true },
                    });

                    const item = po.items[0];
                    if (!item) throw new ApiError(500, "Gagal membuat PO item");
                    return {
                        item_id: item.id,
                        po_id: po.id,
                        po_number: po.po_number,
                        po_status: po.status as "ORDERED",
                        supplier_id: po.supplier_id,
                        supplier_name: po.supplier_name,
                        qty_ordered: Number(item.qty_ordered),
                        qty_received: Number(item.qty_received),
                        open_qty: Number(item.qty_ordered) - Number(item.qty_received),
                        unit_price: Number(item.unit_price),
                        uom: item.uom,
                        po_date: po.po_date.toISOString(),
                        is_legacy: false,
                    };
                });
            } catch (e) {
                // PurchaseOrder's only unique constraint is po_number, so any P2002
                // from purchaseOrder.create is a po_number collision. Retry up to
                // MAX_RETRIES to ride past races with concurrent generators.
                if (
                    e instanceof Prisma.PrismaClientKnownRequestError &&
                    e.code === "P2002" &&
                    attempt < MAX_RETRIES - 1
                ) {
                    logger.warn("createOpenPoCell P2002 collision, retrying", {
                        traceId,
                        attempt,
                        code: e.code,
                        meta: e.meta,
                    });
                    lastError = e;
                    continue;
                }
                logger.error("createOpenPoCell giving up", {
                    traceId,
                    attempt,
                    errorName: e instanceof Error ? e.name : typeof e,
                    errorMessage: e instanceof Error ? e.message : String(e),
                    code: e instanceof Prisma.PrismaClientKnownRequestError ? e.code : undefined,
                    meta: e instanceof Prisma.PrismaClientKnownRequestError ? e.meta : undefined,
                });
                throw e;
            }
        }
        throw lastError instanceof Error
            ? lastError
            : new ApiError(500, "Gagal generate PO number setelah beberapa percobaan");
    }

    static async updateOpenPoCellQty(itemId: number, body: RequestUpdateOpenPoCellQtyDTO) {
        const { quantity } = body;

        return await prisma.$transaction(async (tx) => {
            const item = await tx.purchaseOrderItem.findUnique({
                where: { id: itemId },
                include: { po: { select: { id: true, status: true } } },
            });
            if (!item) throw new ApiError(404, "PO item tidak ditemukan");
            if (!EDITABLE_PO_STATUSES.includes(item.po.status as EditablePOStatus)) {
                throw new ApiError(403, `Status PO ${item.po.status} tidak bisa diubah dari sini`);
            }
            if (quantity < Number(item.qty_received)) {
                throw new ApiError(
                    422,
                    `Min qty = ${Number(item.qty_received)} (sudah diterima)`,
                );
            }

            // Row lock parent header to serialize concurrent edits
            await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${item.po.id} FOR UPDATE`;

            const newSubtotal = quantity * Number(item.unit_price);
            const updated = await tx.purchaseOrderItem.update({
                where: { id: itemId },
                data: { qty_ordered: quantity, subtotal: newSubtotal },
            });

            const agg = await tx.purchaseOrderItem.aggregate({
                where: { po_id: item.po.id },
                _sum: { subtotal: true },
            });
            await tx.purchaseOrder.update({
                where: { id: item.po.id },
                data: { total_estimated: Number(agg._sum.subtotal ?? 0) },
            });

            return {
                item_id: updated.id,
                po_id: item.po.id,
                qty_ordered: Number(updated.qty_ordered),
                qty_received: Number(updated.qty_received),
                open_qty: Number(updated.qty_ordered) - Number(updated.qty_received),
                unit_price: Number(updated.unit_price),
                subtotal: Number(updated.subtotal),
            };
        });
    }

    static async deleteOpenPoCellItem(itemId: number) {
        return await prisma.$transaction(async (tx) => {
            const item = await tx.purchaseOrderItem.findUnique({
                where: { id: itemId },
                include: { po: { select: { id: true, status: true } } },
            });
            if (!item) throw new ApiError(404, "PO item tidak ditemukan");
            if (!EDITABLE_PO_STATUSES.includes(item.po.status as EditablePOStatus)) {
                throw new ApiError(403, `Status PO ${item.po.status} tidak bisa dihapus dari sini`);
            }
            if (Number(item.qty_received) > 0) {
                throw new ApiError(422, "Tidak bisa hapus, PO sudah ada GR");
            }

            await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${item.po.id} FOR UPDATE`;
            await tx.purchaseOrderItem.delete({ where: { id: itemId } });

            const remaining = await tx.purchaseOrderItem.count({ where: { po_id: item.po.id } });
            if (remaining === 0) {
                await tx.purchaseOrder.delete({ where: { id: item.po.id } });
                return { deleted: true, header_deleted: true };
            }

            const agg = await tx.purchaseOrderItem.aggregate({
                where: { po_id: item.po.id },
                _sum: { subtotal: true },
            });
            await tx.purchaseOrder.update({
                where: { id: item.po.id },
                data: { total_estimated: Number(agg._sum.subtotal ?? 0) },
            });
            return { deleted: true, header_deleted: false };
        });
    }

    static async listSuppliersForMaterial(rawMatId: number) {
        const rows = await prisma.supplierMaterial.findMany({
            where: { raw_material_id: rawMatId, status: "ACTIVE" },
            orderBy: [{ is_preferred: "desc" }, { unit_price: "asc" }],
            include: { supplier: { select: { id: true, name: true, country: true } } },
        });
        return rows.map((r) => ({
            supplier_id: r.supplier_id,
            supplier_name: r.supplier.name,
            country: r.supplier.country,
            unit_price: Number(r.unit_price),
            is_preferred: r.is_preferred,
        }));
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
            return await tx.materialPurchaseDraft.upsert({
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
        // Note: cascade errors above bubble up intentionally to surface mis-configs

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
            // Delete the KTP override first, then recalculate KA-% without it
            await prisma.rawMaterialNeedOverride.deleteMany({
                where: { raw_material_id, month, year },
            });
            const kaIds = await RecomendationV2Service.findKaParentMaterials(raw_material_id);
            cascadeCount = kaIds.length;
            for (const kaId of kaIds) {
                const { need, hasKtpOverride } = await RecomendationV2Service.recalculateKaNeedForPeriod(kaId, month, year);
                if (hasKtpOverride) {
                    await prisma.rawMaterialNeedOverride.upsert({
                        where: { raw_material_id_month_year: { raw_material_id: kaId, month, year } },
                        update: { quantity: need },
                        create: { raw_material_id: kaId, month, year, quantity: need },
                    });
                } else {
                    // No remaining KTP overrides — revert KA to system calc
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
     * Recalculates KA-% need (in sheets) for a period using a single SQL query.
     * Uses a LATERAL join to fetch the KTP/KTL/KTB override per product, avoiding Prisma.join.
     * For each product using this KA-% material:
     *   - If that product's KTP/KTL/KTB has an override: effective_demand = override / ktp_recipe_qty
     *   - Else: effective_demand = final_forecast
     * Returns the total sheets need and whether any KTP override contributed.
     */
    private static async recalculateKaNeedForPeriod(
        ka_material_id: number,
        month: number,
        year: number,
    ): Promise<{ need: number; hasKtpOverride: boolean }> {
        const rows = await prisma.$queryRaw<{
            ka_recipe_qty: number;
            override_qty: number | null;
            ktp_recipe_qty: number | null;
            final_forecast: number | null;
        }[]>`
            SELECT
                ka_rec.quantity::numeric          AS ka_recipe_qty,
                ktp_ov.override_qty::numeric      AS override_qty,
                ktp_ov.ktp_recipe_qty::numeric    AS ktp_recipe_qty,
                f.final_forecast::numeric         AS final_forecast
            FROM recipes ka_rec
            JOIN products p
                ON p.id = ka_rec.product_id
                AND p.status = 'ACTIVE'
                AND p.deleted_at IS NULL
            LEFT JOIN LATERAL (
                SELECT
                    o.quantity            AS override_qty,
                    rec.quantity          AS ktp_recipe_qty
                FROM recipes rec
                JOIN raw_materials rm ON rm.id = rec.raw_mat_id
                JOIN raw_material_need_overrides o
                    ON o.raw_material_id = rec.raw_mat_id
                    AND o.month = ${month}
                    AND o.year  = ${year}
                WHERE rec.product_id = ka_rec.product_id
                  AND rec.is_active   = true
                  AND (
                      rm.barcode LIKE 'KTP-%'
                      OR rm.barcode LIKE 'KTL-%'
                      OR rm.barcode LIKE 'KTB-%'
                  )
                LIMIT 1
            ) ktp_ov ON true
            LEFT JOIN forecasts f
                ON f.product_id = ka_rec.product_id
                AND f.month = ${month}
                AND f.year  = ${year}
            WHERE ka_rec.raw_mat_id = ${ka_material_id}
              AND ka_rec.is_active  = true
        `;

        if (rows.length === 0) return { need: 0, hasKtpOverride: false };

        let kaNeed = 0;
        let hasKtpOverride = false;

        for (const r of rows) {
            const kaQty = Number(r.ka_recipe_qty);
            if (r.override_qty != null && r.ktp_recipe_qty != null && Number(r.ktp_recipe_qty) > 0) {
                hasKtpOverride = true;
                kaNeed += (Number(r.override_qty) / Number(r.ktp_recipe_qty)) * kaQty;
            } else {
                kaNeed += Number(r.final_forecast ?? 0) * kaQty;
            }
        }

        return { need: Math.round(kaNeed), hasKtpOverride };
    }

    static async createOpenPosFromDrafts(draftIds: number[], userId: string) {
        if (draftIds.length === 0) {
            return { created_po_ids: [] as number[], affected_draft_ids: [] as number[] };
        }

        const MAX_RETRIES = 20;
        const traceId = `approve-po-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

        let lastError: unknown = null;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                return await prisma.$transaction(async (tx) => {
                    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('po_number_seq'))`;

                    const userExists = await tx.user.findUnique({
                        where: { id: userId },
                        select: { id: true },
                    });
                    const picId = userExists ? userId : null;

                    const drafts = await tx.materialPurchaseDraft.findMany({
                        where: { id: { in: draftIds }, status: "DRAFT" },
                        include: {
                            raw_material: {
                                include: {
                                    unit_raw_material: { select: { name: true } },
                                    raw_mat_category: { select: { name: true } },
                                    supplier_materials: {
                                        select: { min_buy: true, supplier_id: true, is_preferred: true },
                                    },
                                },
                            },
                        },
                    });

                    if (drafts.length === 0) {
                        return { created_po_ids: [] as number[], affected_draft_ids: [] as number[] };
                    }

                    type ResolvedDraft = {
                        draft: (typeof drafts)[number];
                        supplier_id: number;
                        supplier_name: string;
                        unit_price: number;
                        moq: Prisma.Decimal | null;
                    };
                    const groups = new Map<string, ResolvedDraft[]>();
                    for (const d of drafts) {
                        const r = await this.resolveSupplierAndPrice(tx, d.raw_mat_id, undefined);
                        const moqRow = d.raw_material.supplier_materials.find(
                            (sm) => sm.supplier_id === r.supplier_id,
                        );
                        const key = `${r.supplier_id}|${d.year}|${d.month}`;
                        const arr = groups.get(key) ?? [];
                        arr.push({
                            draft: d,
                            supplier_id: r.supplier_id,
                            supplier_name: r.supplier_name,
                            unit_price: r.unit_price,
                            moq: moqRow?.min_buy ?? null,
                        });
                        groups.set(key, arr);
                    }

                    const today = new Date();
                    const datePrefix = `PO-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}-`;
                    const maxRows = await tx.$queryRaw<{ max_seq: number | null }[]>`
                        SELECT MAX(CAST(SUBSTRING(po_number FROM ${datePrefix.length + 1}) AS INTEGER)) AS max_seq
                        FROM purchase_orders
                        WHERE po_number LIKE ${datePrefix + "%"}
                          AND SUBSTRING(po_number FROM ${datePrefix.length + 1}) ~ '^[0-9]+$'
                    `;
                    const jumpBase = attempt === 0 ? 0 : attempt * 100 + Math.floor(Math.random() * 50);
                    let nextSeq = Number(maxRows[0]?.max_seq ?? 0) + jumpBase;

                    const createdPoIds: number[] = [];
                    const affectedDraftIds: number[] = [];

                    for (const items of groups.values()) {
                        nextSeq += 1;
                        const poNumber = `${datePrefix}${String(nextSeq).padStart(3, "0")}`;
                        const first = items[0]!;
                        const year = first.draft.year;
                        const month = first.draft.month;
                        const poDate = new Date(Date.UTC(year, month - 1, 1));

                        let totalEstimated = 0;
                        const poItemsData = items.map((it) => {
                            const qty = Number(it.draft.quantity);
                            const subtotal = qty * it.unit_price;
                            totalEstimated += subtotal;
                            const rm = it.draft.raw_material;
                            return {
                                raw_material_id: rm.id,
                                item_code: rm.barcode || `RM-${rm.id}`,
                                item_name: rm.name,
                                item_category: rm.raw_mat_category?.name ?? null,
                                item_type: "MASTER" as const,
                                uom: rm.unit_raw_material?.name || "UNIT",
                                moq: it.moq,
                                unit_price: it.unit_price,
                                qty_ordered: qty,
                                subtotal,
                            };
                        });

                        const po = await tx.purchaseOrder.create({
                            data: {
                                po_number: poNumber,
                                po_date: poDate,
                                po_type: "LOCAL",
                                supplier_id: first.supplier_id,
                                supplier_name: first.supplier_name,
                                currency: "IDR",
                                exchange_rate: 1,
                                total_estimated: totalEstimated,
                                status: "ORDERED",
                                approved_by: userId,
                                approved_at: new Date(),
                                ordered_at: new Date(),
                                created_by: userId,
                                items: { create: poItemsData },
                            },
                            select: { id: true },
                        });
                        createdPoIds.push(po.id);
                        affectedDraftIds.push(...items.map((it) => it.draft.id));
                    }

                    await tx.materialPurchaseDraft.updateMany({
                        where: { id: { in: affectedDraftIds }, status: "DRAFT" },
                        data: { status: "ACC", pic_id: picId, updated_at: new Date() },
                    });

                    logger.info("createOpenPosFromDrafts done", {
                        traceId,
                        attempt,
                        drafts_in: draftIds.length,
                        drafts_processed: affectedDraftIds.length,
                        pos_created: createdPoIds.length,
                    });

                    return { created_po_ids: createdPoIds, affected_draft_ids: affectedDraftIds };
                });
            } catch (e) {
                if (
                    e instanceof Prisma.PrismaClientKnownRequestError &&
                    e.code === "P2002" &&
                    attempt < MAX_RETRIES - 1
                ) {
                    logger.warn("createOpenPosFromDrafts P2002, retrying", {
                        traceId,
                        attempt,
                        code: e.code,
                        meta: e.meta,
                    });
                    lastError = e;
                    continue;
                }
                logger.error("createOpenPosFromDrafts giving up", {
                    traceId,
                    attempt,
                    errorMessage: e instanceof Error ? e.message : String(e),
                });
                throw e;
            }
        }
        throw lastError instanceof Error
            ? lastError
            : new ApiError(500, "Gagal generate PO number setelah beberapa percobaan");
    }

    static async approveWorkOrder(body: RequestApproveWorkOrderDTO, userId: string) {
        const rec = await prisma.materialPurchaseDraft.findUnique({
            where: { id: body.id },
            select: { id: true, status: true },
        });
        if (!rec) throw new ApiError(404, "Work order tidak ditemukan");
        if (rec.status !== "DRAFT") {
            throw new ApiError(400, "Only DRAFT work orders can be approved.");
        }
        return await this.createOpenPosFromDrafts([body.id], userId);
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
            ON CONFLICT (raw_mat_id, month, year) DO UPDATE SET
                horizon = EXCLUDED.horizon,
                total_needed = EXCLUDED.total_needed,
                current_stock = EXCLUDED.current_stock,
                stock_fg_x_resep = EXCLUDED.stock_fg_x_resep,
                safety_stock_x_resep = EXCLUDED.safety_stock_x_resep,
                updated_at = EXCLUDED.updated_at
            WHERE "material_purchase_drafts".status = 'DRAFT'::"RecommendationStatus"
              AND "material_purchase_drafts".open_po_id IS NULL;
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

    private static async resolveSupplierAndPrice(
        tx: Prisma.TransactionClient,
        rawMatId: number,
        overrideSupplierId?: number,
    ): Promise<{ supplier_id: number; supplier_name: string; unit_price: number }> {
        let supplierId = overrideSupplierId;

        if (!supplierId) {
            const preferred = await tx.supplierMaterial.findFirst({
                where: { raw_material_id: rawMatId, is_preferred: true, status: "ACTIVE" },
                select: { supplier_id: true, unit_price: true },
            });
            if (!preferred) {
                throw new ApiError(422, "Material ini tidak punya preferred supplier — pilih manual");
            }
            supplierId = preferred.supplier_id;
        }

        const supplier = await tx.supplier.findUnique({
            where: { id: supplierId },
            select: { id: true, name: true },
        });
        if (!supplier) throw new ApiError(422, "Supplier tidak ditemukan");

        const supplierMaterial = await tx.supplierMaterial.findFirst({
            where: { supplier_id: supplierId, raw_material_id: rawMatId, status: "ACTIVE" },
            select: { unit_price: true },
        });

        let unitPrice = supplierMaterial ? Number(supplierMaterial.unit_price) : 0;

        if (unitPrice === 0) {
            const lastItem = await tx.purchaseOrderItem.findFirst({
                where: { raw_material_id: rawMatId, po: { supplier_id: supplierId } },
                orderBy: { po: { po_date: "desc" } },
                select: { unit_price: true },
            });
            if (lastItem) unitPrice = Number(lastItem.unit_price);
        }

        return { supplier_id: supplier.id, supplier_name: supplier.name, unit_price: unitPrice };
    }
}
