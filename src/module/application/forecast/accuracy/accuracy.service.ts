import prisma from "../../../../config/prisma.js";
import { Prisma } from "../../../../generated/prisma/client.js";
import { GetPagination } from "../../../../lib/utils/pagination.js";
import { ISSUANCE_THRESHOLD_PERIOD } from "../../shared/constants.js";
import type {
    QueryForecastAccuracyDTO,
    ResponseForecastAccuracyDTO,
    ResponseForecastAccuracyItemDTO,
} from "./accuracy.schema.js";

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

        const { skip, take: limit } = GetPagination(query.page, query.take);

        const searchRaw = query.search ? `%${query.search}%` : null;

        const othersSlugs = Prisma.sql`pt.slug ILIKE '%display%' OR pt.slug ILIKE '%kertas%' OR pt.slug ILIKE '%botol%' OR pt.slug ILIKE '%paper-bag%' OR pt.slug ILIKE '%kartu-garansi%' OR pt.slug ILIKE '%canvas-bag%'`;
        const typeFilter = query.is_others
            ? Prisma.sql`(${othersSlugs})`
            : Prisma.sql`(pt.slug IS NULL OR NOT (${othersSlugs}))`;

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
            avg_accuracy: number | string | null;
        };

        const aggregateRows = await prisma.$queryRaw<Agg[]>(Prisma.sql`
            WITH matched AS (
                SELECT
                    COALESCE(f.final_forecast, f.base_forecast, 0)::float8 AS forecast,
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
                COUNT(*)::int                                                                                           AS product_count,
                SUM(forecast) FILTER (WHERE sales > 0)::float8                                                         AS total_forecast,
                SUM(sales)    FILTER (WHERE sales > 0)::float8                                                         AS total_sales,
                COUNT(*) FILTER (WHERE sales = 0 OR sales IS NULL)::int                                                AS excluded_count,
                AVG(GREATEST(0, (1 - ABS(forecast - sales) / NULLIF(sales, 0)) * 100)) FILTER (WHERE sales > 0)::float8 AS avg_accuracy
            FROM matched
        `);

        const agg = aggregateRows[0] ?? {
            product_count: 0,
            total_forecast: 0,
            total_sales: 0,
            excluded_count: 0,
            avg_accuracy: null,
        };

        const data: ResponseForecastAccuracyItemDTO[] = rows.map((r) => {
            const forecast = Number(r.forecast ?? 0);
            const sales = Number(r.sales ?? 0);
            return {
                product_id: Number(r.product_id),
                product_code: r.product_code,
                product_name: r.product_name,
                product_type: r.product_type_name ?? "",
                product_size: `${r.size ?? ""} ${r.unit_name ?? ""}`.trim(),
                forecast,
                sales,
                diff: forecast - sales,
                accuracy_percentage: ForecastAccuracyService.formatAccuracy(forecast, sales),
            };
        });

        const total_forecast = Number(agg.total_forecast ?? 0);
        const total_sales = Number(agg.total_sales ?? 0);
        const product_count = Number(agg.product_count ?? 0);
        const excluded_count = Number(agg.excluded_count ?? 0);
        const avg_accuracy = agg.avg_accuracy != null ? Number(agg.avg_accuracy) : null;

        return {
            period,
            summary: {
                total_forecast,
                total_sales,
                accuracy_percentage: avg_accuracy != null ? `${avg_accuracy.toFixed(2)}%` : "N/A",
                product_count,
                excluded_count,
            },
            data,
            len: product_count,
        };
    }

    static formatAccuracy(forecast: number, sales: number): string {
        if (sales <= 0) return "N/A";
        const accuracy = (1 - Math.abs(forecast - sales) / sales) * 100;
        const clamped = Math.max(0, accuracy);
        return `${clamped.toFixed(2)}%`;
    }
}
