import prisma from "../../../config/prisma.js";
import { Prisma } from "../../../generated/prisma/client.js";
import { GetPagination } from "../../../lib/utils/pagination.js";
import {
    QueryBOMDTO,
    ResponseBOMListDTO,
    ResponseGroupedBOMDTO,
    ResponseMaterialBOMDetailDTO,
} from "./bom.schema.js";
import { ISSUANCE_THRESHOLD_PERIOD } from "../shared/constants.js";

export class BOMService {
    static async list(query: QueryBOMDTO): Promise<ResponseBOMListDTO> {
        const { page = 1, take = 25, search, forecast_months = 3 } = query;
        const { skip, take: limit } = GetPagination(page, take);

        // 1. Identify Month Ranges
        const now = new Date();
        const currentYear = now.getUTCFullYear();
        const currentMonth = now.getUTCMonth() + 1;

        // Sales: Last 4 months (excluding current month)
        const salesRange = Array.from({ length: 4 }, (_, i) => {
            const d = new Date(Date.UTC(currentYear, currentMonth - 2 - i, 1));
            return { month: d.getUTCMonth() + 1, year: d.getUTCFullYear() };
        }).reverse();

        // Forecast: Next n months starting from now (ensure at least 4 for Safety Stock)
        const FIXED_SS_MONTHS = 4;
        const effectiveForecastMonths = Math.max(forecast_months, FIXED_SS_MONTHS);
        const forecastRange = Array.from({ length: effectiveForecastMonths }, (_, i) => {
            const d = new Date(Date.UTC(currentYear, currentMonth - 1 + i, 1));
            return { month: d.getUTCMonth() + 1, year: d.getUTCFullYear() };
        });

        const forecastConditions = forecastRange.map(
            (f) => Prisma.sql`(f.month = ${f.month} AND f.year = ${f.year})`,
        );
        const forecastOrSql = Prisma.join(forecastConditions, " OR ");

        // 2. Build Query Conditions
        const conditions: Prisma.Sql[] = [
            Prisma.sql`rm.deleted_at IS NULL`,
            Prisma.sql`p.status = 'ACTIVE'::"STATUS"`,
            Prisma.sql`p.deleted_at IS NULL`,
        ];
        if (search) {
            const pat = `%${search}%`;
            conditions.push(
                Prisma.sql`(p.name  ILIKE ${pat} OR p.code ILIKE ${pat} OR rm.name ILIKE ${pat} OR rm.barcode ILIKE ${pat})`,
            );
        }
        const whereSql = Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;

        // 3. Get Paginated Product IDs (Paginating by Product, not Recipe)
        const productsPage = await prisma.$queryRaw<any[]>(Prisma.sql`
            SELECT 
                p.id,
                -- Total Forecast (6 months sum) for grouping & sorting
                COALESCE((
                    SELECT SUM(f.final_forecast)
                    FROM forecasts f
                    WHERE f.product_id = p.id
                    AND (${forecastOrSql})
                ), 0)::float8 as total_forecast
            FROM products p
            JOIN recipes r ON r.product_id = p.id AND r.is_active = true
            JOIN raw_materials rm ON rm.id = r.raw_mat_id
            ${whereSql}
            GROUP BY p.id
            ORDER BY total_forecast DESC, p.name ASC
            LIMIT ${limit} OFFSET ${skip}
        `);

        if (productsPage.length === 0) return { data: [], len: 0 };

        const productIds = productsPage.map((p) => p.id);

        // 4. Main Data Fetch for selected products
        const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
            SELECT
                r.id,
                r.version as recipe_version,
                r.quantity::float8 as recipe_qty,
                r.use_size_calc,
                p.id as p_id, p.code as p_code, p.name as p_name, p.gender::text as p_gender,
                p.safety_percentage::float8 as p_safety_percentage,
                pt.slug as pt_slug, pt.name as pt_name, ps.size as ps_val, u.name as u_name,
                rm.id as rm_id, rm.barcode as rm_barcode, rm.name as rm_name, 
                urm.name as urm_name,
                
                -- Material Available Stock (Latest record per warehouse, On-Hand minus Booked)
                GREATEST(0,
                    COALESCE((
                        SELECT SUM(quantity) FROM (
                            SELECT DISTINCT ON (warehouse_id) quantity
                            FROM raw_material_inventories
                            WHERE raw_material_id = rm.id
                            AND (year * 12 + month) <= (${currentYear} * 12 + ${currentMonth})
                            ORDER BY warehouse_id, year DESC, month DESC
                        ) latest_inv
                    ), 0)
                    -
                    COALESCE((
                        SELECT SUM(poi.quantity_planned)
                        FROM production_order_items poi
                        JOIN production_orders po ON poi.production_order_id = po.id
                        WHERE poi.raw_material_id = rm.id
                        AND po.status = 'RELEASED'
                    ), 0)
                )::float8 as rm_current_stock,

                -- Product Total Stock (Latest record per warehouse)
                COALESCE((
                    SELECT SUM(quantity) FROM (
                        SELECT DISTINCT ON (warehouse_id) quantity
                        FROM product_inventories
                        WHERE product_id = p.id
                        AND (year * 12 + month) <= (${currentYear} * 12 + ${currentMonth})
                        ORDER BY warehouse_id, year DESC, month DESC
                    ) latest_p_inv
                ), 0)::float8 as p_current_stock
                
            FROM recipes r
            JOIN products p ON p.id = r.product_id
            JOIN raw_materials rm ON rm.id = r.raw_mat_id
            LEFT JOIN product_types pt ON pt.id = p.type_id
            LEFT JOIN product_size ps ON ps.id = p.size_id
            LEFT JOIN unit_of_materials u ON u.id = p.unit_id
            LEFT JOIN unit_raw_materials urm ON urm.id = rm.unit_id
            WHERE p.id IN (${Prisma.join(productIds)}) AND r.is_active = true
            ORDER BY p.name ASC
        `);

        // 5. Batch Fetch Sales & Forecasts
        const salesPeriodVals = salesRange.map(s => s.year * 12 + s.month);
        
        const [salesData, forecastData] = await Promise.all([
            prisma.$queryRaw<any[]>(Prisma.sql`
                SELECT 
                    product_id, year, month,
                    COALESCE(
                        NULLIF(SUM(CASE WHEN (year * 12 + month) > ${ISSUANCE_THRESHOLD_PERIOD} AND type != 'ALL' THEN quantity ELSE 0 END), 0),
                        SUM(CASE WHEN (year * 12 + month) <= ${ISSUANCE_THRESHOLD_PERIOD} AND type = 'ALL' THEN quantity ELSE 0 END)
                    ) as quantity
                FROM product_issuances
                WHERE product_id IN (${Prisma.join(productIds)})
                  AND (year * 12 + month) IN (${Prisma.join(salesPeriodVals)})
                GROUP BY product_id, year, month
            `),
            prisma.forecast.findMany({
                where: {
                    product_id: { in: productIds },
                    OR: forecastRange.map((f) => ({ month: f.month, year: f.year })),
                },
            }),
        ]);

        const salesMap = new Map<string, number>();
        salesData.forEach((s) =>
            salesMap.set(`${s.product_id}-${s.year}-${s.month}`, Number(s.quantity)),
        );

        const forecastMap = new Map<string, number>();
        forecastData.forEach((f) =>
            forecastMap.set(
                `${f.product_id}-${f.year}-${f.month}`,
                Math.round(Number(f.final_forecast)),
            ),
        );

        // 6. Group and Map to DTO
        const groupedMap = new Map<number, any>();

        rows.forEach((r) => {
            if (!groupedMap.has(r.p_id)) {
                const fscRange = forecastRange.map((f) => ({
                    period: `${f.month}/${f.year}`,
                    month: f.month,
                    year: f.year,
                    value: forecastMap.get(`${r.p_id}-${f.year}-${f.month}`) ?? 0,
                }));

                const slsRange = salesRange.map((s) => ({
                    period: `${s.month}/${s.year}`,
                    month: s.month,
                    year: s.year,
                    value: salesMap.get(`${r.p_id}-${s.year}-${s.month}`) ?? 0,
                }));

                // Safety Stock: Always use fixed 4-month average (M+0..M+3), independent of forecast_months
                const FIXED_SS_MONTHS = 4;
                const ssForecasts = fscRange.slice(0, FIXED_SS_MONTHS);
                const totalForecastForSS = ssForecasts.reduce((acc, f) => acc + f.value, 0);
                const avgForecastForSS = totalForecastForSS / FIXED_SS_MONTHS;
                
                const isOthers = r.pt_slug && (
                    r.pt_slug.includes("display") || 
                    r.pt_slug.includes("kertas") || 
                    r.pt_slug.includes("botol") || 
                    r.pt_slug.includes("paper-bag") || 
                    r.pt_slug.includes("kartu-garansi") || 
                    r.pt_slug.includes("canvas-bag")
                );
                const safetyPct = (r.p_safety_percentage && r.p_safety_percentage > 0)
                    ? Number(r.p_safety_percentage)
                    : (isOthers ? 0.25 : 0);

                const calculatedSS = avgForecastForSS * safetyPct;

                // Calculate Need Produce for entire horizon
                let runningStock = Number(r.p_current_stock ?? 0);
                const needProduceRange = fscRange.map((f) => {
                    const consumption = f.value;
                    const need = Math.max(0, consumption - runningStock);
                    runningStock = Math.max(0, runningStock - consumption);
                    return {
                        period: f.period,
                        month: f.month,
                        year: f.year,
                        value: need,
                    };
                });

                groupedMap.set(r.p_id, {
                    product: {
                        id: r.p_id,
                        code: r.p_code,
                        name: r.p_name,
                        type: r.pt_name ?? "-",
                        gender: r.p_gender,
                        size: r.ps_val ? String(r.ps_val) : "-",
                        uom: r.u_name ?? "-",
                    },
                    sales_history: slsRange,
                    forecast: fscRange,
                    safety_stock: Math.round(calculatedSS),
                    need_produce: needProduceRange,
                    recipe_version: r.recipe_version,
                    items: [],
                });
            }

            const group = groupedMap.get(r.p_id) as any;
            const itemForecast = group.forecast;
            const pSize = Number(r.ps_val) || 0;

            group.items.push({
                id: r.id,
                material: {
                    id: r.rm_id,
                    barcode: r.rm_barcode,
                    name: r.rm_name,
                    quantity: r.recipe_qty,
                    uom: r.urm_name ?? "-",
                },
                needs_to_buy: itemForecast.map((f: any) => ({
                    period: f.period,
                    month: f.month,
                    year: f.year,
                    value: r.use_size_calc
                        ? Math.floor(Math.round(f.value) * pSize * r.recipe_qty)
                        : Math.floor(Math.round(f.value) * r.recipe_qty),
                })),
                safety_stock_x_bom: r.use_size_calc
                    ? Math.floor(Math.round(group.safety_stock) * pSize * r.recipe_qty)
                    : Math.floor(Math.round(group.safety_stock) * r.recipe_qty),
                need_produce_x_bom: group.need_produce.map((np: any) => ({
                    period: np.period,
                    month: np.month,
                    year: np.year,
                    value: r.use_size_calc ? np.value * pSize * r.recipe_qty : np.value * r.recipe_qty,
                })),
            });
        });

        // 7. Total count for pagination (Count of Products, not Recipes)
        const countRes = await prisma.$queryRaw<any[]>(Prisma.sql`
            SELECT COUNT(DISTINCT p.id)::bigint as total
            FROM products p
            JOIN recipes r ON r.product_id = p.id AND r.is_active = true
            JOIN raw_materials rm ON rm.id = r.raw_mat_id
            ${whereSql}
        `);

        return {
            data: productsPage
                .map((p) => groupedMap.get(p.id))
                .filter(Boolean) as ResponseGroupedBOMDTO[],
            len: Number(countRes[0]?.total ?? 0),
        };
    }

    static async detail(
        id: number | string,
        query?: any,
    ): Promise<ResponseGroupedBOMDTO | ResponseMaterialBOMDetailDTO> {
        if (!id) throw new Error("ID or Material Code is required");

        const { forecast_months = 3 } = query || {};

        const now = new Date();
        const currentYear = now.getUTCFullYear();
        const currentMonth = now.getUTCMonth() + 1;

        // Sales Range: Last 4 months (excluding current month)
        const salesRange = Array.from({ length: 4 }, (_, i) => {
            const d = new Date(Date.UTC(currentYear, currentMonth - 2 - i, 1));
            return { month: d.getUTCMonth() + 1, year: d.getUTCFullYear() };
        }).reverse();
        const salesPeriodVals = salesRange.map((s) => s.year * 12 + s.month);

        // 1. Check if this is a Material Code (Exploration View needed by detail.tsx)
        const rawMat = await prisma.rawMaterial.findFirst({
            where: { barcode: String(id) },
            include: {
                unit_raw_material: true,
                raw_mat_category: true,
                supplier: true,
            },
        });

        if (rawMat) {
            // Fetch Inventory status (On-Hand)
            const inventory = await prisma.rawMaterialInventory.aggregate({
                where: {
                    raw_material_id: rawMat.id,
                    month: currentMonth,
                    year: currentYear,
                },
                _sum: { quantity: true },
            });

            // Fetch Booked quantities (from RELEASED production orders)
            const booked = await prisma.productionOrderItem.aggregate({
                where: {
                    raw_material_id: rawMat.id,
                    production_order: { status: "RELEASED" as any },
                },
                _sum: { quantity_planned: true },
            });

            const onHand = Number(inventory._sum.quantity || 0);
            const bookedQty = Number(booked._sum.quantity_planned || 0);
            const currentStock = Math.max(0, onHand - bookedQty);

            // Forecast Range (Next n months, ensure at least 4 for Safety Stock)
            const FIXED_SS_MONTHS_DETAIL = 4;
            const effectiveFcMonths = Math.max(forecast_months, FIXED_SS_MONTHS_DETAIL);
            const forecastRange = Array.from({ length: effectiveFcMonths }, (_, i) => {
                const d = new Date(Date.UTC(currentYear, currentMonth - 1 + i, 1));
                return {
                    month: d.getUTCMonth() + 1,
                    year: d.getUTCFullYear(),
                    key: `${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`,
                };
            });

            // Fetch product usages
            const recipes = await prisma.recipes.findMany({
                where: {
                    raw_mat_id: rawMat.id,
                    is_active: true,
                    products: { status: "ACTIVE", deleted_at: null },
                },
                include: {
                    products: {
                        include: {
                            product_type: true,
                            size: true,
                            product_inventories: {
                                where: { month: currentMonth, year: currentYear },
                            },
                            forecasts: {
                                where: {
                                    OR: forecastRange.map((f) => ({
                                        month: f.month,
                                        year: f.year,
                                    })),
                                },
                            },
                        },
                    },
                },
            });

            const productIds = recipes.map((r) => r.product_id);

            // Fetch Forecasts for all products
            const forecasts = await prisma.forecast.findMany({
                where: {
                    product_id: { in: productIds },
                    OR: forecastRange.map((f) => ({ month: f.month, year: f.year })),
                },
            });

            const forecastMap = new Map<string, number>();
            forecasts.forEach((f) =>
                forecastMap.set(
                    `${f.product_id}-${f.month}-${f.year}`,
                    Math.round(Number(f.final_forecast)),
                ),
            );

            // Fetch Sales History (Product Issuance) for all products
            const salesData = await prisma.$queryRaw<any[]>(Prisma.sql`
                SELECT 
                    product_id, year, month,
                    COALESCE(
                        NULLIF(SUM(CASE WHEN (year * 12 + month) > ${ISSUANCE_THRESHOLD_PERIOD} AND type != 'ALL' THEN quantity ELSE 0 END), 0),
                        SUM(CASE WHEN (year * 12 + month) <= ${ISSUANCE_THRESHOLD_PERIOD} AND type = 'ALL' THEN quantity ELSE 0 END)
                    ) as quantity
                FROM product_issuances
                WHERE product_id IN (${Prisma.join(productIds)})
                  AND (year * 12 + month) IN (${Prisma.join(salesPeriodVals)})
                GROUP BY product_id, year, month
            `);

            const salesMap = new Map<string, number>();
            salesData.forEach((s) =>
                salesMap.set(`${s.product_id}-${s.year}-${s.month}`, Number(s.quantity)),
            );

            let totalRequirement = 0;
            const details = recipes.map((r) => {
                const monthly_data: Record<string, number> = {};
                let productTotal = 0;

                // Consistent FO Logic
                const pSize = Number(r.products.size?.size) || 0;

                forecastRange.forEach((p) => {
                    const fVal = forecastMap.get(`${r.product_id}-${p.month}-${p.year}`) || 0;
                    const req = r.use_size_calc
                        ? Math.floor(fVal * pSize * Number(r.quantity))
                        : Math.floor(fVal * Number(r.quantity));
                    monthly_data[p.key] = req;
                    productTotal += req;
                });

                const productForecasts = r.products.forecasts || [];
                const FIXED_SS_MONTHS = 4;
                // Safety Stock: Always use fixed 4-month average, independent of forecast_months
                const ssProductForecasts = productForecasts
                    .sort((a, b) => (a.year * 12 + a.month) - (b.year * 12 + b.month))
                    .slice(0, FIXED_SS_MONTHS);
                const totalProductForecast = ssProductForecasts.reduce(
                    (sum, f) => sum + Number(f.final_forecast),
                    0,
                );
                const avgProductForecast = totalProductForecast / FIXED_SS_MONTHS;
                
                const ptSlug = r.products.product_type?.slug?.toLowerCase() || "";
                const isOthers = ptSlug.includes("display") || 
                                ptSlug.includes("kertas") || 
                                ptSlug.includes("botol") || 
                                ptSlug.includes("paper-bag") || 
                                ptSlug.includes("kartu-garansi") || 
                                ptSlug.includes("canvas-bag");
                
                const safetyPct = (r.products.safety_percentage && Number(r.products.safety_percentage) > 0)
                    ? Number(r.products.safety_percentage)
                    : (isOthers ? 0.25 : 0);

                const productSS = Math.round(avgProductForecast * safetyPct);

                // Calculate product-specific Need Produce for entire Horizon
                const productStockDetail = r.products.product_inventories.reduce(
                    (sum, pi) => sum + Number(pi.quantity),
                    0,
                );
                let runningStockDetail = productStockDetail;

                const productNeedProduce = forecastRange.map((p) => {
                    const fMatch = productForecasts.find(
                        (f) => f.month === p.month && f.year === p.year,
                    );
                    const fValAtMonth = fMatch ? Math.round(Number(fMatch.final_forecast)) : 0;
                    const needAtMonth = Math.max(0, fValAtMonth - runningStockDetail);
                    runningStockDetail = Math.max(0, runningStockDetail - fValAtMonth);
                    
                    const val = r.use_size_calc
                        ? needAtMonth * pSize * Number(r.quantity)
                        : needAtMonth * Number(r.quantity);

                    return {
                        period: p.key,
                        month: p.month,
                        year: p.year,
                        value: Math.round(val),
                    };
                });

                // Calculate product-specific Sales History (Material Equivalent)
                const productSalesHistory = salesRange.map((s) => {
                    const sVal = salesMap.get(`${r.product_id}-${s.year}-${s.month}`) || 0;
                    const val = r.use_size_calc
                        ? Math.floor(sVal * pSize * Number(r.quantity))
                        : Math.floor(sVal * Number(r.quantity));
                    return {
                        period: `${s.month}/${s.year}`,
                        month: s.month,
                        year: s.year,
                        value: val,
                    };
                });

                totalRequirement += productTotal;

                return {
                    product_id: r.products.id,
                    product_code: r.products.code,
                    product_name: r.products.name,
                    product_type: r.products.product_type?.name || "-",
                    recipe_version: r.version,
                    monthly_data,
                    sales_history: productSalesHistory,
                    safety_stock: Math.floor(r.use_size_calc 
                        ? productSS * pSize * Number(r.quantity) 
                        : productSS * Number(r.quantity)),
                    need_produce: productNeedProduce,
                    exploded_at: now,
                };
            });

            return {
                material: {
                    id: rawMat.id,
                    barcode: rawMat.barcode || "",
                    name: rawMat.name,
                    price: Number(rawMat.price),
                    category: rawMat.raw_mat_category?.name || "-",
                    supplier: rawMat.supplier?.name || "-",
                    supplier_country: rawMat.supplier?.country || "-",
                    source: rawMat.supplier?.source ?? "LOCAL",
                    unit: rawMat.unit_raw_material?.name || "UNIT",
                },
                inventory: {
                    current_stock: currentStock,
                    stock_gap: Math.floor(currentStock - totalRequirement),
                    min_stock: Number(rawMat.min_stock || 0),
                },
                summary: {
                    total_requirement: Math.floor(totalRequirement),
                    is_stock_sufficient: currentStock >= totalRequirement,
                    affected_products_count: productIds.length,
                },
                periods: forecastRange.map((f) => ({ key: f.key, month: f.month, year: f.year })),
                details,
            };
        }

        // 2. Fallback to Product-centric detail (Old behavior)
        let row;
        if (typeof id === "number") {
            row = await prisma.recipes.findUnique({
                where: { id },
                include: { products: true, raw_materials: true },
            });
        } else {
            row = await prisma.recipes.findFirst({
                where: { products: { code: id }, is_active: true },
                include: { products: true, raw_materials: true },
            });
        }

        if (!row) throw new Error("BOM not found");

        const listResult = await this.list({
            take: 1,
            page: 1,
            search: row.products.code,
        });

        const found = listResult.data[0];
        if (!found) throw new Error("BOM details failed to load");
        return found;
    }
}
