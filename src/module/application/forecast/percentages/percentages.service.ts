import { Prisma } from "../../../../generated/prisma/client.js";
import prisma from "../../../../config/prisma.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { GetPagination } from "../../../../lib/utils/pagination.js";
import type {
    QueryForecastPercentageDTO,
    QueryForecastPercentageHistoryDTO,
    RequestForecastPercentageBulkDTO,
    RequestForecastPercentageDTO,
    ResponseForecastPercentageDTO,
    ResponseForecastPercentageHistoryDTO,
} from "./percentages.schema.js";

export class ForecastPercentageService {
    static async create(
        body: RequestForecastPercentageDTO,
    ): Promise<ResponseForecastPercentageDTO> {
        const { month, year, value } = body;

        const existing = await prisma.forecastPercentage.findUnique({
            where: { month_year: { month, year } },
            select: { id: true },
        });
        if (existing) {
            throw new ApiError(
                400,
                `Data persentase forecast untuk periode ${month}/${year} sudah tersedia`,
            );
        }

        const result = await prisma.forecastPercentage.create({
            data: { month, year, value },
        });

        return { ...result, value: Number(result.value) };
    }

    static async createMany(
        body: RequestForecastPercentageBulkDTO,
        ctx: { changed_by: string },
    ): Promise<{ count: number; data: ResponseForecastPercentageDTO[] }> {
        const { items, reason } = body;

        return await prisma.$transaction(async (tx) => {
            const existing = await tx.forecastPercentage.findMany({
                where: { OR: items.map((i) => ({ month: i.month, year: i.year })) },
            });
            const existingMap = new Map(
                existing.map((e) => [`${e.month}-${e.year}`, e]),
            );

            const historyRows: Prisma.ForecastPercentageHistoryCreateManyInput[] = [];
            const upserted: Array<{
                id: number;
                month: number;
                year: number;
                value: Prisma.Decimal | string;
            }> = [];

            for (const item of items) {
                const key = `${item.month}-${item.year}`;
                const prev = existingMap.get(key);
                const newValueDecimal = new Prisma.Decimal(item.value);

                if (prev && !prev.value.equals(newValueDecimal)) {
                    historyRows.push({
                        forecast_percentage_id: prev.id,
                        month: item.month,
                        year: item.year,
                        old_value: prev.value,
                        new_value: newValueDecimal,
                        action: "BULK_UPDATE",
                        changed_by: ctx.changed_by,
                        reason: reason ?? null,
                    });
                }

                const result = await tx.forecastPercentage.upsert({
                    where: { month_year: { month: item.month, year: item.year } },
                    update: { value: newValueDecimal },
                    create: { month: item.month, year: item.year, value: newValueDecimal },
                });
                upserted.push(result);
            }

            if (historyRows.length > 0) {
                await tx.forecastPercentageHistory.createMany({ data: historyRows });
            }

            return {
                count: upserted.length,
                data: upserted.map((r) => ({ ...r, value: Number(r.value) })),
            };
        });
    }

    static async list(
        query: QueryForecastPercentageDTO,
    ): Promise<{ data: ResponseForecastPercentageDTO[]; len: number }> {
        const { year, page = 1, take = 25 } = query;
        const { skip, take: limit } = GetPagination(page, take);

        const where: { year?: number } = {};
        if (year) where.year = year;

        const [data, len] = await Promise.all([
            prisma.forecastPercentage.findMany({
                where,
                orderBy: [{ year: "desc" }, { month: "asc" }],
                skip,
                take: limit,
            }),
            prisma.forecastPercentage.count({ where }),
        ]);

        return {
            len,
            data: data.map((r: any) => ({ ...r, value: Number(r.value) })),
        };
    }

    static async detail(id: number): Promise<ResponseForecastPercentageDTO> {
        const result = await prisma.forecastPercentage.findUnique({ where: { id } });
        if (!result) throw new ApiError(404, "Data persentase forecast tidak ditemukan");

        return { ...result, value: Number(result.value) };
    }

    static async update(
        id: number,
        body: { value: number; reason?: string },
        ctx: { changed_by: string },
    ): Promise<ResponseForecastPercentageDTO> {
        return await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT id FROM forecasts_percentages WHERE id = ${id} FOR UPDATE`;

            const existing = await tx.forecastPercentage.findUnique({ where: { id } });
            if (!existing) throw new ApiError(404, "Data persentase forecast tidak ditemukan");

            const newValueDecimal = new Prisma.Decimal(body.value);
            const sameValue = existing.value.equals(newValueDecimal);

            if (sameValue) {
                return { ...existing, value: Number(existing.value) };
            }

            await tx.forecastPercentageHistory.create({
                data: {
                    forecast_percentage_id: existing.id,
                    month: existing.month,
                    year: existing.year,
                    old_value: existing.value,
                    new_value: newValueDecimal,
                    action: "UPDATE",
                    changed_by: ctx.changed_by,
                    reason: body.reason ?? null,
                },
            });

            const updated = await tx.forecastPercentage.update({
                where: { id },
                data: { value: newValueDecimal },
            });

            return { ...updated, value: Number(updated.value) };
        });
    }

    static async destroy(id: number): Promise<void> {
        const existing = await prisma.forecastPercentage.findUnique({
            where: { id },
            select: { id: true },
        });
        if (!existing) throw new ApiError(404, "Data persentase forecast tidak ditemukan");

        await prisma.forecastPercentage.delete({ where: { id } });
    }

    static async destroyMany(ids: number[]): Promise<{ count: number }> {
        const result = await prisma.forecastPercentage.deleteMany({
            where: { id: { in: ids } },
        });
        return { count: result.count };
    }

    static async listHistory(
        query: QueryForecastPercentageHistoryDTO,
    ): Promise<{ data: ResponseForecastPercentageHistoryDTO[]; len: number }> {
        const { month, year, page = 1, take = 25 } = query;
        const { skip, take: limit } = GetPagination(page, take);

        const where = { month, year };

        const [data, len] = await Promise.all([
            prisma.forecastPercentageHistory.findMany({
                where,
                orderBy: { created_at: "desc" },
                skip,
                take: limit,
            }),
            prisma.forecastPercentageHistory.count({ where }),
        ]);

        return {
            len,
            data: data.map((r: any) => ({
                ...r,
                old_value: Number(r.old_value),
                new_value: Number(r.new_value),
            })),
        };
    }
}
