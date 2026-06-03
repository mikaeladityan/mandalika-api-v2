import prisma from "../../../../config/prisma.js";
import { Prisma } from "../../../../generated/prisma/client.js";
import { ISSUANCE_THRESHOLD_PERIOD } from "../../shared/constants.js";
import type { QueryForecastAccuracyDTO } from "./accuracy.schema.js";

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

    static formatAccuracy(forecast: number, sales: number): string {
        if (sales <= 0) return "N/A";
        const accuracy = (1 - Math.abs(forecast - sales) / sales) * 100;
        const clamped = Math.max(0, accuracy);
        return `${clamped.toFixed(2)}%`;
    }
}
