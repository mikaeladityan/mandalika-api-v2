import prisma from "../../../../config/prisma.js";
import { Prisma } from "../../../../generated/prisma/client.js";
import { GetPagination } from "../../../../lib/utils/pagination.js";
import { ISSUANCE_THRESHOLD_PERIOD } from "../../shared/constants.js";
import type {
    QueryForecastAccuracyDTO,
    QueryForecastAccuracyTrendDTO,
    QueryEdarVsActDTO,
    ResponseForecastAccuracyDTO,
    ResponseForecastAccuracyItemDTO,
    ResponseForecastAccuracyTrendDTO,
    ResponseEdarVsActDTO,
    ResponseEdarVsActItemDTO,
} from "./accuracy.schema.js";

const DEFAULT_TOLERANCE = 25; // ±25% → band 75–125

// Symmetric tolerance band around 100%: ±tolerance percentage points.
function toleranceBand(tolerance: number): { threshold: number; upper: number } {
    return { threshold: 100 - tolerance, upper: 100 + tolerance };
}

const OTHERS_SLUGS = Prisma.sql`pt.slug ILIKE '%display%' OR pt.slug ILIKE '%kertas%' OR pt.slug ILIKE '%botol%' OR pt.slug ILIKE '%paper-bag%' OR pt.slug ILIKE '%kartu-garansi%' OR pt.slug ILIKE '%canvas-bag%'`;

function buildTypeFilter(isOthers: boolean): Prisma.Sql {
    return isOthers
        ? Prisma.sql`(${OTHERS_SLUGS})`
        : Prisma.sql`(pt.slug IS NULL OR NOT (${OTHERS_SLUGS}))`;
}

export class ForecastAccuracyService {
    static async resolvePeriod(
        query: QueryForecastAccuracyDTO,
    ): Promise<{ month: number; year: number }> {
        if (query.month !== undefined && query.year !== undefined) {
            return { month: query.month, year: query.year };
        }

        const rows = await prisma.$queryRaw<{ month: number; year: number }[]>(Prisma.sql`
            SELECT year, month
            FROM (
                SELECT
                    year,
                    month,
                    COALESCE(
                        NULLIF(SUM(CASE WHEN (year * 12 + month) > ${ISSUANCE_THRESHOLD_PERIOD} AND type != 'ALL'::"IssuanceType" THEN quantity ELSE 0 END), 0),
                        SUM(CASE WHEN (year * 12 + month) <= ${ISSUANCE_THRESHOLD_PERIOD} AND type = 'ALL'::"IssuanceType" THEN quantity ELSE 0 END)
                    ) AS month_qty
                FROM product_issuances
                GROUP BY year, month
            ) sub
            WHERE month_qty > 0
            ORDER BY year DESC, month DESC
            LIMIT 1
        `);

        if (rows.length > 0 && rows[0]) {
            return { month: Number(rows[0].month), year: Number(rows[0].year) };
        }

        const now = new Date();
        return { month: now.getUTCMonth() + 1, year: now.getUTCFullYear() };
    }

    static async list(query: QueryForecastAccuracyDTO): Promise<ResponseForecastAccuracyDTO> {
        const period = await ForecastAccuracyService.resolvePeriod(query);
        const { month, year } = period;
        const tolerance = query.tolerance ?? DEFAULT_TOLERANCE;
        const { threshold, upper } = toleranceBand(tolerance);

        const { skip, take: limit } = GetPagination(query.page, query.take);

        const searchRaw = query.search ? `%${query.search}%` : null;

        const typeFilter = buildTypeFilter(query.is_others);

        const searchFilter = searchRaw
            ? Prisma.sql`AND (p.name ILIKE ${searchRaw} OR p.code ILIKE ${searchRaw} OR pt.name ILIKE ${searchRaw})`
            : Prisma.empty;
        const typeIdFilter = query.type_id
            ? Prisma.sql`AND p.type_id = ${query.type_id}`
            : Prisma.empty;
        const sizeIdFilter = query.size_id
            ? Prisma.sql`AND p.size_id = ${query.size_id}`
            : Prisma.empty;

        const salesCte = Prisma.sql`
            SELECT product_id,
                COALESCE(
                    NULLIF(SUM(CASE WHEN (year * 12 + month) > ${ISSUANCE_THRESHOLD_PERIOD} AND type != 'ALL'::"IssuanceType" THEN quantity ELSE 0 END), 0),
                    SUM(CASE WHEN (year * 12 + month) <= ${ISSUANCE_THRESHOLD_PERIOD} AND type = 'ALL'::"IssuanceType" THEN quantity ELSE 0 END)
                )::float8 AS sales
            FROM product_issuances
            WHERE year = ${year} AND month = ${month}
            GROUP BY product_id
        `;

        type Row = {
            product_id: number;
            product_code: string | null;
            product_name: string;
            product_type_name: string | null;
            size: number | null;
            unit_name: string | null;
            forecast: string | number | null;
            sales: string | number | null;
        };

        const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
            SELECT
                p.id           AS product_id,
                p.code         AS product_code,
                p.name         AS product_name,
                pt.name        AS product_type_name,
                ps.size        AS size,
                u.name         AS unit_name,
                COALESCE(f.final_forecast, f.base_forecast, 0)::float8 AS forecast,
                COALESCE(s.sales, 0)::float8                          AS sales
            FROM products p
            LEFT JOIN product_types     pt ON pt.id = p.type_id
            LEFT JOIN unit_of_materials u  ON u.id  = p.unit_id
            LEFT JOIN product_size      ps ON ps.id = p.size_id
            LEFT JOIN forecasts f
                ON f.product_id = p.id AND f.month = ${month} AND f.year = ${year}
            LEFT JOIN (${salesCte}) s ON s.product_id = p.id
            WHERE p.status = 'ACTIVE'
              AND p.deleted_at IS NULL
              AND ${typeFilter}
              ${searchFilter}
              ${typeIdFilter}
              ${sizeIdFilter}
            ORDER BY p.name ASC, p.id ASC
            LIMIT ${limit} OFFSET ${skip}
        `);

        type Agg = {
            product_count: number | string;
            total_forecast: number | string | null;
            total_sales: number | string | null;
            excluded_count: number | string;
            wmape_accuracy: number | string | null;
            bias_pct: number | string | null;
            accurate_count: number | string;
            under_count: number | string;
            over_count: number | string;
        };

        const aggregateRows = await prisma.$queryRaw<Agg[]>(Prisma.sql`
            WITH matched AS (
                SELECT
                    COALESCE(f.final_forecast, f.base_forecast)::float8 AS forecast,
                    COALESCE(s.sales, 0)::float8 AS sales
                FROM products p
                LEFT JOIN product_types     pt ON pt.id = p.type_id
                LEFT JOIN forecasts f
                    ON f.product_id = p.id AND f.month = ${month} AND f.year = ${year}
                LEFT JOIN (${salesCte}) s ON s.product_id = p.id
                WHERE p.status = 'ACTIVE'
                  AND p.deleted_at IS NULL
                  AND ${typeFilter}
                  ${searchFilter}
                  ${typeIdFilter}
                  ${sizeIdFilter}
            )
            SELECT
                COUNT(*)::int                                                                                                AS product_count,
                SUM(forecast) FILTER (WHERE ROUND(sales) > 0 AND forecast IS NOT NULL)::float8                              AS total_forecast,
                SUM(sales)    FILTER (WHERE ROUND(sales) > 0 AND forecast IS NOT NULL)::float8                              AS total_sales,
                COUNT(*) FILTER (WHERE ROUND(sales) <= 0 OR forecast IS NULL)::int                                          AS excluded_count,
                GREATEST(0, (1 - SUM(ABS(ROUND(forecast) - ROUND(sales))) FILTER (WHERE ROUND(sales) > 0 AND forecast IS NOT NULL)
                    / NULLIF(SUM(ROUND(sales)) FILTER (WHERE ROUND(sales) > 0 AND forecast IS NOT NULL), 0)) * 100)::float8 AS wmape_accuracy,
                (SUM(ROUND(forecast)) FILTER (WHERE ROUND(sales) > 0 AND forecast IS NOT NULL)
                    / NULLIF(SUM(ROUND(sales)) FILTER (WHERE ROUND(sales) > 0 AND forecast IS NOT NULL), 0) * 100)::float8  AS bias_pct,
                COUNT(*) FILTER (WHERE ROUND(sales) > 0 AND forecast IS NOT NULL AND (ROUND(forecast)::float8 / NULLIF(ROUND(sales)::float8, 0)) * 100 BETWEEN ${threshold} AND ${upper})::int AS accurate_count,
                COUNT(*) FILTER (WHERE ROUND(sales) > 0 AND forecast IS NOT NULL AND (ROUND(forecast)::float8 / NULLIF(ROUND(sales)::float8, 0)) * 100 < ${threshold})::int                    AS under_count,
                COUNT(*) FILTER (WHERE ROUND(sales) > 0 AND forecast IS NOT NULL AND (ROUND(forecast)::float8 / NULLIF(ROUND(sales)::float8, 0)) * 100 > ${upper})::int                        AS over_count
            FROM matched
        `);

        const agg = aggregateRows[0] ?? {
            product_count: 0,
            total_forecast: 0,
            total_sales: 0,
            excluded_count: 0,
            wmape_accuracy: null,
            bias_pct: null,
            accurate_count: 0,
            under_count: 0,
            over_count: 0,
        };

        const data: ResponseForecastAccuracyItemDTO[] = rows.map((r) => {
            const forecast = Number(r.forecast ?? 0);
            const sales = Number(r.sales ?? 0);
            const accuracy_percentage = ForecastAccuracyService.formatAccuracy(forecast, sales);
            const rf = Math.round(forecast);
            const rs = Math.round(sales);
            const accuracy_ratio = rs <= 0 ? null : (rf / rs) * 100;
            const accuracy_status =
                accuracy_ratio === null
                    ? null
                    : accuracy_ratio < threshold
                      ? ("under" as const)
                      : accuracy_ratio > upper
                        ? ("over" as const)
                        : ("tepat_sasaran" as const);
            return {
                product_id: Number(r.product_id),
                product_code: r.product_code,
                product_name: r.product_name,
                product_type: r.product_type_name ?? "",
                product_size: `${r.size ?? ""} ML`.trim(),
                forecast,
                sales,
                diff: forecast - sales,
                accuracy_percentage,
                accuracy_status,
            };
        });

        const total_forecast = Number(agg.total_forecast ?? 0);
        const total_sales = Number(agg.total_sales ?? 0);
        const product_count = Number(agg.product_count ?? 0);
        const excluded_count = Number(agg.excluded_count ?? 0);
        const wmape_accuracy = agg.wmape_accuracy != null ? Number(agg.wmape_accuracy) : null;
        const bias_pct = agg.bias_pct != null ? Number(agg.bias_pct) : null;
        const accurate_count = Number(agg.accurate_count ?? 0);
        const under_count = Number(agg.under_count ?? 0);
        const over_count = Number(agg.over_count ?? 0);

        return {
            period,
            tolerance,
            summary: {
                total_forecast,
                total_sales,
                accuracy_percentage: wmape_accuracy != null ? `${wmape_accuracy.toFixed(2)}%` : "N/A",
                bias_percentage: bias_pct != null ? `${bias_pct.toFixed(2)}%` : "N/A",
                product_count,
                excluded_count,
                accurate_count,
                under_count,
                over_count,
            },
            data,
            len: product_count,
        };
    }

    static formatAccuracy(forecast: number, sales: number): string {
        const f = Math.round(forecast);
        const s = Math.round(sales);
        if (s <= 0) return "N/A";
        const accuracy = (f / s) * 100;
        return `${accuracy.toFixed(2)}%`;
    }

    static async edarVsAct(query: QueryEdarVsActDTO): Promise<ResponseEdarVsActDTO> {
        const { from_month, from_year, to_month, to_year } = query;
        const { skip, take: limit } = GetPagination(query.page, query.take);

        const MONTH_LABEL = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Ags","Sep","Okt","Nov","Des"];

        const searchRaw = query.search ? `%${query.search}%` : null;
        const searchFilter = searchRaw
            ? Prisma.sql`AND (p.name ILIKE ${searchRaw} OR p.code ILIKE ${searchRaw})`
            : Prisma.empty;

        // ── Flat rows: page_products × month_series ─────────────────────────────
        type FlatRow = {
            product_id:       number;
            product_code:     string | null;
            product_name:     string;
            product_type_name: string | null;
            size:             number | null;
            unit_name:        string | null;
            edar_pct:         number;
            group_key:        string;
            year:             number;
            month:            number;
            own_sales:        number;
            pair_total_sales: number;
            actual_pct:       number | null;
        };

        const rows = await prisma.$queryRaw<FlatRow[]>(Prisma.sql`
            WITH month_series AS (
                SELECT
                    EXTRACT(YEAR  FROM d)::int AS year,
                    EXTRACT(MONTH FROM d)::int AS month
                FROM generate_series(
                    make_date(${from_year}, ${from_month}, 1),
                    make_date(${to_year},   ${to_month},   1),
                    '1 month'::interval
                ) AS d
            ),
            all_edar AS (
                SELECT
                    p.id,
                    p.name || '|' || COALESCE(p.size_id::text, 'null') AS group_key
                FROM products p
                WHERE p.status = 'ACTIVE'
                  AND p.deleted_at IS NULL
                  AND p.distribution_percentage > 0
            ),
            page_prods AS (
                SELECT
                    p.id,
                    p.code,
                    p.name,
                    pt.name   AS type_name,
                    ps.size,
                    u.name    AS unit_name,
                    (p.distribution_percentage::float8 * 100) AS edar_pct,
                    p.name || '|' || COALESCE(p.size_id::text, 'null') AS group_key
                FROM products p
                LEFT JOIN product_types      pt ON pt.id = p.type_id
                LEFT JOIN product_size       ps ON ps.id = p.size_id
                LEFT JOIN unit_of_materials  u  ON u.id  = p.unit_id
                WHERE p.status = 'ACTIVE'
                  AND p.deleted_at IS NULL
                  AND p.distribution_percentage > 0
                  ${searchFilter}
                ORDER BY
                    p.name ASC,
                    CASE
                        WHEN pt.name ILIKE '%EDP%' OR pt.name ILIKE '%Parfum%' OR pt.name ILIKE '%Perfume%' THEN 1
                        WHEN pt.name ILIKE '%Atomizer%' THEN 2
                        ELSE 3
                    END ASC,
                    ps.size DESC NULLS LAST,
                    CASE
                        WHEN pt.name ILIKE '%EDP%' THEN 1
                        WHEN pt.name ILIKE '%Parfum%' OR pt.name ILIKE '%Perfume%' THEN 2
                        ELSE 3
                    END ASC,
                    p.id ASC
                LIMIT ${limit} OFFSET ${skip}
            ),
            sales_range AS (
                SELECT
                    pi.product_id,
                    pi.year,
                    pi.month,
                    COALESCE(
                        NULLIF(SUM(CASE WHEN (pi.year * 12 + pi.month) > ${ISSUANCE_THRESHOLD_PERIOD} AND pi.type != 'ALL'::"IssuanceType" THEN pi.quantity ELSE 0 END), 0),
                        SUM(CASE WHEN (pi.year * 12 + pi.month) <= ${ISSUANCE_THRESHOLD_PERIOD} AND pi.type = 'ALL'::"IssuanceType" THEN pi.quantity ELSE 0 END)
                    )::float8 AS sales
                FROM product_issuances pi
                INNER JOIN all_edar ae ON ae.id = pi.product_id
                WHERE (pi.year * 12 + pi.month)
                      BETWEEN (${from_year} * 12 + ${from_month})
                      AND     (${to_year}   * 12 + ${to_month})
                GROUP BY pi.product_id, pi.year, pi.month
            ),
            pair_totals AS (
                SELECT
                    ae.group_key,
                    ms.year,
                    ms.month,
                    SUM(COALESCE(sr.sales, 0))::float8 AS pair_total_sales
                FROM all_edar ae
                CROSS JOIN month_series ms
                LEFT JOIN sales_range sr
                    ON sr.product_id = ae.id AND sr.year = ms.year AND sr.month = ms.month
                GROUP BY ae.group_key, ms.year, ms.month
            )
            SELECT
                pp.id                                       AS product_id,
                pp.code                                     AS product_code,
                pp.name                                     AS product_name,
                pp.type_name                                AS product_type_name,
                pp.size,
                pp.unit_name,
                pp.edar_pct,
                pp.group_key,
                ms.year,
                ms.month,
                COALESCE(sr.sales, 0)::float8               AS own_sales,
                COALESCE(pt.pair_total_sales, 0)::float8    AS pair_total_sales,
                CASE
                    WHEN COALESCE(pt.pair_total_sales, 0) > 0
                    THEN ROUND(
                        (COALESCE(sr.sales, 0) / pt.pair_total_sales * 100)::numeric, 2
                    )::float8
                    ELSE NULL
                END                                         AS actual_pct
            FROM page_prods pp
            CROSS JOIN month_series ms
            LEFT JOIN sales_range sr
                ON sr.product_id = pp.id AND sr.year = ms.year AND sr.month = ms.month
            LEFT JOIN pair_totals pt
                ON pt.group_key = pp.group_key AND pt.year = ms.year AND pt.month = ms.month
            ORDER BY
                pp.name ASC,
                CASE
                    WHEN pp.type_name ILIKE '%EDP%' OR pp.type_name ILIKE '%Parfum%' OR pp.type_name ILIKE '%Perfume%' THEN 1
                    WHEN pp.type_name ILIKE '%Atomizer%' THEN 2
                    ELSE 3
                END ASC,
                pp.size DESC NULLS LAST,
                CASE
                    WHEN pp.type_name ILIKE '%EDP%' THEN 1
                    WHEN pp.type_name ILIKE '%Parfum%' OR pp.type_name ILIKE '%Perfume%' THEN 2
                    ELSE 3
                END ASC,
                pp.id ASC,
                ms.year ASC, ms.month ASC
        `);

        // ── Summary (global — ignores search/pagination) ─────────────────────────
        type SummaryMonthRow = {
            year:           number;
            month:          number;
            on_target:      number;
            warning:        number;
            off_target:     number;
            no_data:        number;
            avg_actual_pct: number | null;
            upper:          number;
            under:          number;
        };

        const summaryRows = await prisma.$queryRaw<SummaryMonthRow[]>(Prisma.sql`
            WITH month_series AS (
                SELECT
                    EXTRACT(YEAR  FROM d)::int AS year,
                    EXTRACT(MONTH FROM d)::int AS month
                FROM generate_series(
                    make_date(${from_year}, ${from_month}, 1),
                    make_date(${to_year},   ${to_month},   1),
                    '1 month'::interval
                ) AS d
            ),
            all_edar AS (
                SELECT
                    p.id,
                    p.distribution_percentage::float8 * 100 AS edar_pct,
                    p.name || '|' || COALESCE(p.size_id::text, 'null') AS group_key
                FROM products p
                WHERE p.status = 'ACTIVE'
                  AND p.deleted_at IS NULL
                  AND p.distribution_percentage > 0
            ),
            sales_range AS (
                SELECT
                    pi.product_id, pi.year, pi.month,
                    COALESCE(
                        NULLIF(SUM(CASE WHEN (pi.year * 12 + pi.month) > ${ISSUANCE_THRESHOLD_PERIOD} AND pi.type != 'ALL'::"IssuanceType" THEN pi.quantity ELSE 0 END), 0),
                        SUM(CASE WHEN (pi.year * 12 + pi.month) <= ${ISSUANCE_THRESHOLD_PERIOD} AND pi.type = 'ALL'::"IssuanceType" THEN pi.quantity ELSE 0 END)
                    )::float8 AS sales
                FROM product_issuances pi
                INNER JOIN all_edar ae ON ae.id = pi.product_id
                WHERE (pi.year * 12 + pi.month)
                      BETWEEN (${from_year} * 12 + ${from_month})
                      AND     (${to_year}   * 12 + ${to_month})
                GROUP BY pi.product_id, pi.year, pi.month
            ),
            pair_totals AS (
                SELECT
                    ae.group_key, ms.year, ms.month,
                    SUM(COALESCE(sr.sales, 0))::float8 AS pair_total_sales
                FROM all_edar ae
                CROSS JOIN month_series ms
                LEFT JOIN sales_range sr ON sr.product_id = ae.id AND sr.year = ms.year AND sr.month = ms.month
                GROUP BY ae.group_key, ms.year, ms.month
            ),
            per_product_month AS (
                SELECT
                    ae.id,
                    ae.edar_pct,
                    ms.year,
                    ms.month,
                    CASE
                        WHEN COALESCE(pt.pair_total_sales, 0) > 0
                        THEN ROUND((COALESCE(sr.sales, 0) / pt.pair_total_sales * 100)::numeric, 2)::float8
                        ELSE NULL
                    END AS actual_pct
                FROM all_edar ae
                CROSS JOIN month_series ms
                LEFT JOIN sales_range sr ON sr.product_id = ae.id AND sr.year = ms.year AND sr.month = ms.month
                LEFT JOIN pair_totals pt ON pt.group_key = ae.group_key AND pt.year = ms.year AND pt.month = ms.month
            )
            SELECT
                year, month,
                COUNT(*) FILTER (WHERE actual_pct IS NOT NULL AND ABS(actual_pct - edar_pct) <= 5)::int               AS on_target,
                COUNT(*) FILTER (WHERE actual_pct IS NOT NULL AND ABS(actual_pct - edar_pct) > 5 AND ABS(actual_pct - edar_pct) <= 15)::int AS warning,
                COUNT(*) FILTER (WHERE actual_pct IS NOT NULL AND ABS(actual_pct - edar_pct) > 15)::int               AS off_target,
                COUNT(*) FILTER (WHERE actual_pct IS NULL)::int                                                        AS no_data,
                ROUND(AVG(actual_pct)::numeric, 2)::float8                                                             AS avg_actual_pct,
                COUNT(*) FILTER (WHERE actual_pct IS NOT NULL AND actual_pct > edar_pct)::int                          AS upper,
                COUNT(*) FILTER (WHERE actual_pct IS NOT NULL AND actual_pct < edar_pct)::int                          AS under
            FROM per_product_month
            GROUP BY year, month
            ORDER BY year ASC, month ASC
        `);

        // ── Total count + groups (for pagination + KPI cards) ───────────────────
        type CountRow = { product_count: number; group_count: number; avg_edar_pct: number };
        const [countRow] = await prisma.$queryRaw<CountRow[]>(Prisma.sql`
            SELECT
                COUNT(p.id)::int                                                                       AS product_count,
                COUNT(DISTINCT p.name || '|' || COALESCE(p.size_id::text, 'null'))::int               AS group_count,
                ROUND(AVG(p.distribution_percentage::float8 * 100)::numeric, 2)::float8               AS avg_edar_pct
            FROM products p
            WHERE p.status = 'ACTIVE'
              AND p.deleted_at IS NULL
              AND p.distribution_percentage > 0
        `);

        // ── Build months header list ─────────────────────────────────────────────
        const monthsHeader: { month: number; year: number; label: string }[] = [];
        {
            let y = from_year;
            let m = from_month;
            while (y < to_year || (y === to_year && m <= to_month)) {
                monthsHeader.push({ year: y, month: m, label: `${MONTH_LABEL[m - 1]} '${String(y).slice(2)}` });
                m++;
                if (m > 12) { m = 1; y++; }
            }
        }

        // ── Group flat rows into per-product structure ──────────────────────────
        const productMap = new Map<number, ResponseEdarVsActItemDTO>();
        for (const r of rows) {
            const pid = Number(r.product_id);
            if (!productMap.has(pid)) {
                productMap.set(pid, {
                    product_id:   pid,
                    product_code: r.product_code,
                    product_name: r.product_name,
                    product_type: r.product_type_name ?? "",
                    product_size: `${r.size ?? ""} ML`.trim(),
                    edar_pct:     Number(r.edar_pct),
                    group_key:    r.group_key,
                    months:       [],
                });
            }
            const actual_pct = r.actual_pct != null ? Number(r.actual_pct) : null;
            const edar_pct   = Number(r.edar_pct);
            productMap.get(pid)!.months.push({
                month:            Number(r.month),
                year:             Number(r.year),
                own_sales:        Number(r.own_sales),
                pair_total_sales: Number(r.pair_total_sales),
                actual_pct,
                diff: actual_pct != null ? parseFloat((actual_pct - edar_pct).toFixed(2)) : null,
            });
        }

        const data = Array.from(productMap.values());
        const total_products = Number(countRow?.product_count ?? 0);
        const total_groups   = Number(countRow?.group_count   ?? 0);
        const avg_edar_pct   = Number(countRow?.avg_edar_pct  ?? 0);

        return {
            period: { from_month, from_year, to_month, to_year },
            months: monthsHeader,
            summary: {
                total_products,
                total_groups,
                avg_edar_pct,
                by_month: summaryRows.map((r) => ({
                    month:          Number(r.month),
                    year:           Number(r.year),
                    label:          `${MONTH_LABEL[Number(r.month) - 1]} '${String(Number(r.year)).slice(2)}`,
                    on_target:      Number(r.on_target  ?? 0),
                    warning:        Number(r.warning    ?? 0),
                    off_target:     Number(r.off_target ?? 0),
                    no_data:        Number(r.no_data    ?? 0),
                    avg_actual_pct: r.avg_actual_pct != null ? Number(r.avg_actual_pct) : null,
                    upper:          Number(r.upper ?? 0),
                    under:          Number(r.under ?? 0),
                })),
            },
            data,
            len: total_products,
        };
    }

    static async trend(query: QueryForecastAccuracyTrendDTO): Promise<ResponseForecastAccuracyTrendDTO> {
        const { from_month, from_year, to_month, to_year } = query;
        const { threshold, upper } = toleranceBand(query.tolerance ?? DEFAULT_TOLERANCE);

        const MONTH_LABEL = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Ags","Sep","Okt","Nov","Des"];

        const typeFilter = buildTypeFilter(query.is_others);

        type TrendRow = {
            year: number | string;
            month: number | string;
            accurate_count: number | string;
            under_count: number | string;
            over_count: number | string;
            excluded_count: number | string;
        };

        const rows = await prisma.$queryRaw<TrendRow[]>(Prisma.sql`
            WITH month_series AS (
                SELECT
                    EXTRACT(YEAR FROM d)::int AS year,
                    EXTRACT(MONTH FROM d)::int AS month
                FROM generate_series(
                    make_date(${from_year}, ${from_month}, 1),
                    make_date(${to_year}, ${to_month}, 1),
                    '1 month'::interval
                ) AS d
            ),
            product_base AS (
                SELECT p.id AS product_id
                FROM products p
                LEFT JOIN product_types pt ON pt.id = p.type_id
                WHERE p.status = 'ACTIVE'
                  AND p.deleted_at IS NULL
                  AND ${typeFilter}
            ),
            sales_data AS (
                SELECT
                    pi.product_id, pi.year, pi.month,
                    COALESCE(
                        NULLIF(SUM(CASE WHEN (pi.year * 12 + pi.month) > ${ISSUANCE_THRESHOLD_PERIOD} AND pi.type != 'ALL'::"IssuanceType" THEN pi.quantity ELSE 0 END), 0),
                        SUM(CASE WHEN (pi.year * 12 + pi.month) <= ${ISSUANCE_THRESHOLD_PERIOD} AND pi.type = 'ALL'::"IssuanceType" THEN pi.quantity ELSE 0 END)
                    )::float8 AS sales
                FROM product_issuances pi
                WHERE (pi.year * 12 + pi.month) BETWEEN (${from_year} * 12 + ${from_month}) AND (${to_year} * 12 + ${to_month})
                GROUP BY pi.product_id, pi.year, pi.month
            ),
            matched AS (
                SELECT
                    ms.year, ms.month,
                    COALESCE(f.final_forecast, f.base_forecast)::float8 AS forecast,
                    COALESCE(sd.sales, 0)::float8 AS sales
                FROM month_series ms
                CROSS JOIN product_base pb
                LEFT JOIN forecasts f
                    ON f.product_id = pb.product_id AND f.month = ms.month AND f.year = ms.year
                LEFT JOIN sales_data sd
                    ON sd.product_id = pb.product_id AND sd.year = ms.year AND sd.month = ms.month
            )
            SELECT
                year,
                month,
                COUNT(*) FILTER (WHERE ROUND(sales) > 0 AND forecast IS NOT NULL AND (ROUND(forecast)::float8 / NULLIF(ROUND(sales)::float8, 0)) * 100 BETWEEN ${threshold} AND ${upper})::int AS accurate_count,
                COUNT(*) FILTER (WHERE ROUND(sales) > 0 AND forecast IS NOT NULL AND (ROUND(forecast)::float8 / NULLIF(ROUND(sales)::float8, 0)) * 100 < ${threshold})::int                    AS under_count,
                COUNT(*) FILTER (WHERE ROUND(sales) > 0 AND forecast IS NOT NULL AND (ROUND(forecast)::float8 / NULLIF(ROUND(sales)::float8, 0)) * 100 > ${upper})::int                        AS over_count,
                COUNT(*) FILTER (WHERE ROUND(sales) <= 0 OR forecast IS NULL)::int                                                                                                              AS excluded_count
            FROM matched
            GROUP BY year, month
            ORDER BY year ASC, month ASC
        `);

        return rows.map((r) => {
            const month = Number(r.month);
            const year = Number(r.year);
            const accurate_count = Number(r.accurate_count ?? 0);
            const under_count = Number(r.under_count ?? 0);
            const over_count = Number(r.over_count ?? 0);
            const excluded_count = Number(r.excluded_count ?? 0);
            const base = accurate_count + under_count + over_count;
            return {
                month,
                year,
                label: `${MONTH_LABEL[month - 1]} '${String(year).slice(2)}`,
                accurate_count,
                under_count,
                over_count,
                excluded_count,
                pct_accurate: base > 0 ? parseFloat(((accurate_count / base) * 100).toFixed(1)) : 0,
                pct_under: base > 0 ? parseFloat(((under_count / base) * 100).toFixed(1)) : 0,
                pct_over: base > 0 ? parseFloat(((over_count / base) * 100).toFixed(1)) : 0,
            };
        });
    }
}
