import { Prisma } from "../../../generated/prisma/client.js";
import prisma from "../../../config/prisma.js";
import { QueryRecomendationDTO, RequestAccRecommendationDTO } from "./recomendation.schema.js";
import { GetPagination } from "../../../lib/utils/pagination.js";

export class RecomendationService {
    static async list(query: QueryRecomendationDTO) {
        const { search, page, take, month, year, sales_months, forecast_months, type } = query;
        const { skip, take: limit } = GetPagination(page, take);

        const now = new Date();
        const currentMonth = month ?? now.getMonth() + 1;
        const currentYear = year ?? now.getFullYear();

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

        const forecastPeriods: { month: number; year: number; key: string }[] = [];
        for (let i = 0; i < forecast_months; i++) {
            let m = currentMonth + i;
            let y = currentYear;
            while (m > 12) {
                m -= 12;
                y += 1;
            }
            forecastPeriods.push({ month: m, year: y, key: `${m}-${y}` });
        }

        const slStartM = salesPeriods[0]?.month || currentMonth;
        const slStartY = salesPeriods[0]?.year || currentYear;
        const slEndM = salesPeriods[salesPeriods.length - 1]?.month || currentMonth;
        const slEndY = salesPeriods[salesPeriods.length - 1]?.year || currentYear;

        const fcStartM = forecastPeriods[0]?.month || currentMonth;
        const fcStartY = forecastPeriods[0]?.year || currentYear;
        const fcEndM = forecastPeriods[forecastPeriods.length - 1]?.month || currentMonth;
        const fcEndY = forecastPeriods[forecastPeriods.length - 1]?.year || currentYear;

        const searchRaw = search ? `%${search}%` : null;

        const typeFilter = (() => {
            switch (type) {
                case "ffo":
                    return Prisma.sql`(rmc.slug ILIKE '%fragrance-oil%' OR rmc.slug ILIKE '%ffo%')`;
                case "lokal":
                    return Prisma.sql`(rmc.slug IS NULL OR rmc.slug NOT ILIKE '%fragrance-oil%') AND (s.country ILIKE 'LOCAL' OR s.country IS NULL)`;
                case "impor":
                    return Prisma.sql`(rmc.slug IS NULL OR rmc.slug NOT ILIKE '%fragrance-oil%') AND s.country ILIKE 'IMPORT'`;
                default:
                    return Prisma.sql`1=1`;
            }
        })();

        // Fetch latest available inventory period (month/year) for RM
        const latestInv = await prisma.rawMaterialInventory.findFirst({
            orderBy: [{ year: "desc" }, { month: "desc" }],
            select: { month: true, year: true },
        });

        const invMonth = latestInv?.month || currentMonth;
        const invYear = latestInv?.year || currentYear;

        // Fetch latest available FG inventory period
        const latestFgInv = await prisma.productInventory.findFirst({
            orderBy: [{ year: "desc" }, { month: "desc" }],
            select: { month: true, year: true },
        });

        const fgInvMonth = latestFgInv?.month || currentMonth;
        const fgInvYear = latestFgInv?.year || currentYear;

        const rows = await prisma.$queryRaw<any[]>`
            SELECT * FROM (
                SELECT
                    rm.id AS material_id,
                    rm.barcode AS barcode,
                    rm.name AS material_name,
                    s.name AS supplier_name,
                    rm.min_buy AS moq,
                    rm.lead_time AS lead_time,
                    urm.name AS uom,

                    COALESCE((
                        SELECT SUM(po.quantity)
                        FROM "raw_material_open_pos" po
                        WHERE po.raw_material_id = rm.id AND po.status = 'OPEN'
                    ), 0) AS open_po,

                    COALESCE((
                        SELECT SUM(rmi.quantity)
                        FROM "raw_material_inventories" rmi
                        WHERE rmi.raw_material_id = rm.id
                          AND rmi.month = ${invMonth}
                          AND rmi.year = ${invYear}
                    ), 0) AS current_stock,

                    COALESCE((
                        -- Aggregate FG stock per product_id FIRST, then multiply by recipe qty
                        SELECT SUM(
                            pi_agg.total_qty * rec.quantity *
                            CASE
                                WHEN rm.type = 'FO' OR urm.name ILIKE ANY(ARRAY['ml', 'l', 'liter', 'ML']) THEN COALESCE(ps.size, 1)
                                ELSE 1
                            END
                        )
                        FROM "recipes" rec
                        JOIN "products" p ON p.id = rec.product_id
                        LEFT JOIN "product_size" ps ON ps.id = p.size_id
                        JOIN (
                            SELECT pi.product_id, SUM(pi.quantity) AS total_qty
                            FROM "product_inventories" pi
                            WHERE pi.month = ${fgInvMonth}
                              AND pi.year = ${fgInvYear}
                            GROUP BY pi.product_id
                        ) pi_agg ON pi_agg.product_id = rec.product_id
                        WHERE rec.raw_mat_id = rm.id AND rec.is_active = true
                    ), 0) AS stock_fg_x_resep,

                    (
                        -- Breakdown per product
                        SELECT COALESCE(json_agg(
                            json_build_object(
                                'product_name', p.name,
                                'product_code', p.code,
                                'fg_stock', pi_agg.total_qty,
                                'recipe_qty', rec.quantity,
                                'recipe_version', rec.version,
                                'size_multiplier', CASE WHEN rm.type = 'FO' OR urm.name ILIKE ANY(ARRAY['ml', 'l', 'liter', 'ML']) THEN COALESCE(ps.size, 1) ELSE 1 END,
                                'contribution', pi_agg.total_qty * rec.quantity * CASE WHEN rm.type = 'FO' OR urm.name ILIKE ANY(ARRAY['ml', 'l', 'liter', 'ML']) THEN COALESCE(ps.size, 1) ELSE 1 END
                            )
                        ORDER BY p.code), '[]'::json)
                        FROM "recipes" rec
                        JOIN "products" p ON p.id = rec.product_id
                        LEFT JOIN "product_size" ps ON ps.id = p.size_id
                        JOIN (
                            SELECT pi.product_id, SUM(pi.quantity) AS total_qty
                            FROM "product_inventories" pi
                            WHERE pi.month = ${fgInvMonth}
                              AND pi.year = ${fgInvYear}
                            GROUP BY pi.product_id
                        ) pi_agg ON pi_agg.product_id = rec.product_id
                        WHERE rec.raw_mat_id = rm.id AND rec.is_active = true
                    ) AS fg_stock_breakdown,

                    (
                        -- Breakdown forecast per product (Forecast + Safety Stock)
                        SELECT COALESCE(json_agg(
                            json_build_object(
                                'product_name', p.name,
                                'product_code', p.code,
                                'forecast_qty', mr_agg.total_needed,
                                'safety_qty', COALESCE(ss.safety_stock_quantity, 0),
                                'recipe_qty', rec.quantity,
                                'recipe_version', rec.version,
                                'size_multiplier', CASE WHEN rm.type = 'FO' OR urm.name ILIKE ANY(ARRAY['ml', 'l', 'liter', 'ML']) THEN COALESCE(ps.size, 1) ELSE 1 END,
                                'contribution', mr_agg.total_needed * rec.quantity * CASE WHEN rm.type = 'FO' OR urm.name ILIKE ANY(ARRAY['ml', 'l', 'liter', 'ML']) THEN COALESCE(ps.size, 1) ELSE 1 END
                            )
                        ORDER BY p.code), '[]'::json)
                        FROM "recipes" rec
                        JOIN "products" p ON p.id = rec.product_id
                        LEFT JOIN "product_size" ps ON ps.id = p.size_id
                        LEFT JOIN "safety_stock" ss ON ss.product_id = p.id AND ss.month = ${fcStartM} AND ss.year = ${fcStartY}
                        JOIN (
                            SELECT f.product_id, SUM(f.final_forecast) AS total_needed
                            FROM "forecasts" f
                            WHERE f.month = ${fcStartM}
                              AND f.year = ${fcStartY}
                            GROUP BY f.product_id
                        ) mr_agg ON mr_agg.product_id = rec.product_id
                        WHERE rec.raw_mat_id = rm.id AND rec.is_active = true
                    ) AS fg_forecast_breakdown,

                    COALESCE((
                        -- Safety Stock x BOM Logic
                        SELECT SUM(
                            ss.safety_stock_quantity * rec.quantity *
                            CASE
                                WHEN rm.type = 'FO' OR urm.name ILIKE ANY(ARRAY['ml', 'l', 'liter', 'ML']) THEN COALESCE(ps.size, 1)
                                ELSE 1
                            END
                        )
                        FROM "recipes" rec
                        JOIN "products" p ON p.id = rec.product_id
                        LEFT JOIN "product_size" ps ON ps.id = p.size_id
                        JOIN "safety_stock" ss ON ss.product_id = p.id AND ss.month = ${fcStartM} AND ss.year = ${fcStartY}
                        WHERE rec.raw_mat_id = rm.id AND rec.is_active = true
                    ), 0) AS safety_stock_x_resep,

                    (
                        SELECT COALESCE(json_agg(
                             json_build_object(
                                 'month', ag.month,
                                 'year', ag.year,
                                 'sales', ag.qty
                             )
                        ), '[]'::json)
                        FROM (
                            SELECT sa.month, sa.year, SUM(sa.quantity * rec.quantity * 
                                CASE WHEN rm.type = 'FO' OR urm.name ILIKE ANY(ARRAY['ml', 'l', 'liter', 'ML']) THEN COALESCE(ps.size, 1) ELSE 1 END
                            ) as qty
                            FROM "sales_actuals" sa
                            JOIN "recipes" rec ON rec.product_id = sa.product_id AND rec.is_active = true
                            JOIN "products" p ON p.id = sa.product_id
                            LEFT JOIN "product_size" ps ON ps.id = p.size_id
                            WHERE rec.raw_mat_id = rm.id
                              AND (sa.year * 12 + sa.month) >= ${slStartY * 12 + slStartM}
                              AND (sa.year * 12 + sa.month) <= ${slEndY * 12 + slEndM}
                            GROUP BY sa.month, sa.year
                        ) ag
                    ) AS sales_data,

                    (
                        SELECT COALESCE(json_agg(
                             json_build_object(
                                 'month', mr.month,
                                 'year', mr.year,
                                 'needs', mr.total_needed
                             )
                        ), '[]'::json)
                        FROM (
                            SELECT f.month, f.year, SUM(f.final_forecast * rec.quantity * 
                                CASE WHEN rm.type = 'FO' OR urm.name ILIKE ANY(ARRAY['ml', 'l', 'liter', 'ML']) THEN COALESCE(ps.size, 1) ELSE 1 END
                            ) as total_needed
                            FROM "forecasts" f
                            JOIN "recipes" rec ON rec.product_id = f.product_id AND rec.is_active = true
                            JOIN "products" p ON p.id = f.product_id
                            LEFT JOIN "product_size" ps ON ps.id = p.size_id
                            WHERE rec.raw_mat_id = rm.id
                              AND (f.year * 12 + f.month) >= ${fcStartY * 12 + fcStartM}
                              AND (f.year * 12 + f.month) <= ${fcEndY * 12 + fcEndM}
                            GROUP BY f.month, f.year
                        ) mr
                    ) AS needs_data,

                    COALESCE((
                        -- Total Needs (Forecast ONLY) x Recipe x Multiplier
                        SELECT SUM(
                            f.final_forecast * rec.quantity * 
                            CASE WHEN rm.type = 'FO' OR urm.name ILIKE ANY(ARRAY['ml', 'l', 'liter', 'ML']) THEN COALESCE(ps.size, 1) ELSE 1 END
                        )
                        FROM "forecasts" f
                        JOIN "recipes" rec ON rec.product_id = f.product_id AND rec.is_active = true
                        JOIN "products" p ON p.id = f.product_id
                        LEFT JOIN "product_size" ps ON ps.id = p.size_id
                        WHERE rec.raw_mat_id = rm.id
                          AND f.month = ${fcStartM}
                          AND f.year = ${fcStartY}
                    ), 0) AS total_needs_scalar,

                    COALESCE((
                        SELECT mro.quantity
                        FROM "material_recommendation_orders" mro
                        WHERE mro.raw_mat_id = rm.id
                          AND mro.month = ${fcStartM}
                          AND mro.year = ${fcStartY}
                    ), 0) AS pic_order_quantity,

                    (
                        SELECT mro.status
                        FROM "material_recommendation_orders" mro
                        WHERE mro.raw_mat_id = rm.id
                          AND mro.month = ${fcStartM}
                          AND mro.year = ${fcStartY}
                        LIMIT 1
                    ) AS status,

                    (
                        SELECT mro.pic_id
                        FROM "material_recommendation_orders" mro
                        WHERE mro.raw_mat_id = rm.id
                          AND mro.month = ${fcStartM}
                          AND mro.year = ${fcStartY}
                        LIMIT 1
                    ) AS pic_id,

                    (
                        SELECT mro.id
                        FROM "material_recommendation_orders" mro
                        WHERE mro.raw_mat_id = rm.id
                          AND mro.month = ${fcStartM}
                          AND mro.year = ${fcStartY}
                        LIMIT 1
                    ) AS recommendation_id,

                    (
                        SELECT po.expected_arrival
                        FROM "raw_material_open_pos" po
                        JOIN "material_recommendation_orders" mro ON mro.raw_mat_id = po.raw_material_id
                        WHERE mro.raw_mat_id = rm.id
                          AND mro.month = ${fcStartM}
                          AND mro.year = ${fcStartY}
                          AND mro.open_po_id = po.id
                        LIMIT 1
                    ) AS open_po_expected_arrival

                FROM "raw_materials" rm
                LEFT JOIN "unit_raw_materials" urm ON urm.id = rm.unit_id
                LEFT JOIN "raw_mat_categories" rmc ON rmc.id = rm.raw_mat_categories_id
                LEFT JOIN "suppliers" s ON s.id = rm.supplier_id
                WHERE ${typeFilter}
                  ${searchRaw ? Prisma.sql`AND (rm.name ILIKE ${searchRaw} OR rm.barcode ILIKE ${searchRaw})` : Prisma.empty}
            ) AS base_data
            ORDER BY (total_needs_scalar - (stock_fg_x_resep + current_stock + open_po)) DESC, material_name ASC
            LIMIT ${limit} OFFSET ${skip}
        `;

        const totalQuery = await prisma.$queryRaw<{ count: number }[]>`
            SELECT COUNT(rm.id)::int as count
            FROM "raw_materials" rm
            LEFT JOIN "raw_mat_categories" rmc ON rmc.id = rm.raw_mat_categories_id
            LEFT JOIN "suppliers" s ON s.id = rm.supplier_id
            WHERE ${typeFilter}
              ${searchRaw ? Prisma.sql`AND (rm.name ILIKE ${searchRaw} OR rm.barcode ILIKE ${searchRaw})` : Prisma.empty}
        `;

        const parsedData = rows.map((r: any) => {
            const currentStock = Number(r.current_stock || 0);
            const openPo = Number(r.open_po || 0);
            const moq = Number(r.moq || 0);
            const stockPlusPo = currentStock + openPo;

            const salesRaw =
                typeof r.sales_data === "string" ? JSON.parse(r.sales_data) : r.sales_data || [];
            const needsRaw =
                typeof r.needs_data === "string" ? JSON.parse(r.needs_data) : r.needs_data || [];

            const mappedSales = salesPeriods.map((p) => {
                const found = salesRaw.find((s: any) => s.month === p.month && s.year === p.year);
                return { ...p, quantity: Math.round(Number(found?.sales || 0)) };
            });

            let totalNeeds = 0;
            const mappedNeeds = forecastPeriods.map((p) => {
                const found = needsRaw.find((n: any) => n.month === p.month && n.year === p.year);
                const q = Math.round(Number(found?.needs || 0));
                totalNeeds += q;
                return { ...p, quantity: q };
            });

            // Gunakan total_needs_scalar (kebutuhan 1 bulan target)
            const targetMonthNeeds = Math.round(Number(r.total_needs_scalar || 0));
            const ssResep = Number(r.safety_stock_x_resep || 0);
            const fgResep = Number(r.stock_fg_x_resep || 0);

            // Formula: Forecast - (Stock RM + Open PO + FGxRESEP + Safety Stock)
            const finalStance = targetMonthNeeds - (currentStock + openPo + fgResep + ssResep);
            const recommendation = finalStance > 0 ? finalStance : null;

            return {
                material_id: r.material_id,
                barcode: r.barcode,
                material_name: r.material_name,
                supplier_name: r.supplier_name,
                moq: moq,
                lead_time: r.lead_time,
                uom: r.uom || "UNIT",
                stock_fg_x_resep: Math.round(Number(r.stock_fg_x_resep || 0)),
                safety_stock_x_resep: Math.round(Number(r.safety_stock_x_resep || 0)),
                current_stock: currentStock,
                open_po: openPo,
                pic_order_quantity: Math.round(Number(r.pic_order_quantity || 0)),
                stock_plus_po: stockPlusPo,
                total_needs: totalNeeds,
                forecast_target_month_needs: Math.round(Number(r.total_needs_scalar || 0)),
                fg_stock_breakdown:
                    typeof r.fg_stock_breakdown === "string"
                        ? JSON.parse(r.fg_stock_breakdown)
                        : r.fg_stock_breakdown || [],
                fg_forecast_breakdown:
                    typeof r.fg_forecast_breakdown === "string"
                        ? JSON.parse(r.fg_forecast_breakdown)
                        : r.fg_forecast_breakdown || [],
                inv_period: { month: fgInvMonth, year: fgInvYear },
                recommendation: recommendation,
                recommendation_id: r.recommendation_id || null,
                status: r.status || "DRAFT",
                pic_id: r.pic_id || null,
                open_po_expected_arrival: r.open_po_expected_arrival || null,
                sales: mappedSales,
                needs: mappedNeeds,
            };
        });

        return {
            data: parsedData,
            len: Number(totalQuery[0]?.count || 0),
            periods: { sales_periods: salesPeriods, forecast_periods: forecastPeriods },
        };
    }

    static async saveOrderQuantity(body: {
        raw_mat_id: number;
        month: number;
        year: number;
        quantity: number;
    }) {
        const { raw_mat_id, month, year, quantity } = body;

        return await prisma.materialRecommendationOrder.upsert({
            where: {
                raw_mat_id_month_year: {
                    raw_mat_id,
                    month,
                    year,
                },
            },
            update: {
                quantity,
                updated_at: new Date(),
            },
            create: {
                raw_mat_id,
                month,
                year,
                quantity,
            },
        });
    }

    static async approveRecommendation(body: RequestAccRecommendationDTO, userId: string) {
        return await prisma.$transaction(async (tx) => {
            const rec = await tx.materialRecommendationOrder.findUniqueOrThrow({
                where: { id: body.id },
            });

            if (rec.status !== "DRAFT") {
                throw new Error("Only DRAFT recommendations can be approved.");
            }

            const newPo = await tx.rawMaterialOpenPo.create({
                data: {
                    raw_material_id: rec.raw_mat_id,
                    quantity: rec.quantity,
                    status: "OPEN",
                },
            });

            // Verify if user exists to avoid FK constraint violation
            const userExists = await tx.user.findUnique({
                where: { id: userId },
                select: { id: true },
            });

            const updatedRec = await tx.materialRecommendationOrder.update({
                where: { id: body.id },
                data: {
                    status: "ACC",
                    pic_id: userExists ? userId : null,
                    open_po_id: newPo.id,
                },
            });

            return updatedRec;
        });
    }

    static async destroy(id: number) {
        const rec = await prisma.materialRecommendationOrder.findUnique({
            where: { id },
        });

        if (!rec) throw new Error("Recommendation not found.");
        if (rec.status !== "DRAFT") {
            throw new Error("Only DRAFT recommendations can be deleted.");
        }

        return await prisma.materialRecommendationOrder.delete({
            where: { id },
        });
    }
}
