import { Prisma } from "../../../../generated/prisma/client.js";
import prisma from "../../../../config/prisma.js";

/**
 * Keeps outlet CSV grids aligned with the canonical product ordering used by
 * the Forecasting/Product list (`forecast_default`).
 */
export async function orderProductIdsByForecast(productIds: number[]): Promise<number[]> {
    const uniqueIds = [...new Set(productIds)];
    if (uniqueIds.length < 2) return uniqueIds;

    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const ordered = await prisma.$queryRaw<Array<{ id: number }>>`
        SELECT p.id
        FROM products p
        LEFT JOIN product_types pt ON p.type_id = pt.id
        LEFT JOIN product_size ps ON p.size_id = ps.id
        LEFT JOIN forecasts f_m1
            ON f_m1.product_id = p.id
           AND f_m1.month = ${month}
           AND f_m1.year = ${year}
        WHERE p.id IN (${Prisma.join(uniqueIds)})
        ORDER BY
            CASE WHEN pt.name ILIKE '%Display%' THEN 1 ELSE 0 END ASC,
            CASE WHEN p.code ILIKE 'KEM-%' OR p.code ILIKE 'KT%-%' THEN 1 ELSE 0 END ASC,
            MAX(COALESCE(f_m1.final_forecast, 0)) OVER (PARTITION BY p.name) DESC,
            p.name ASC,
            CASE
                WHEN pt.name ILIKE '%EXT%'
                  OR pt.name ILIKE '%Parfum%'
                  OR pt.name ILIKE '%Perfume%' THEN 1
                WHEN pt.name ILIKE '%Atomizer%' THEN 2
                ELSE 3
            END ASC,
            ps.size DESC NULLS LAST,
            CASE
                WHEN pt.name ILIKE '%EXT%' THEN 1
                WHEN pt.name ILIKE '%Parfum%'
                  OR pt.name ILIKE '%Perfume%' THEN 2
                ELSE 3
            END ASC,
            p.id ASC
    `;

    const rank = new Map(ordered.map((row, index) => [row.id, index]));
    return uniqueIds.sort((left, right) =>
        (rank.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(right) ?? Number.MAX_SAFE_INTEGER),
    );
}
