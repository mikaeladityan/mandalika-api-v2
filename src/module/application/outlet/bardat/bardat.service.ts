import { randomUUID } from "crypto";
import { Prisma } from "../../../../generated/prisma/client.js";
import prisma from "../../../../config/prisma.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { GetPagination } from "../../../../lib/utils/pagination.js";
import { QueryBardatDTO, RequestBardatDTO } from "./bardat.schema.js";
import { orderProductIdsByForecast } from "../shared/forecast-product-order.js";

const BARDAT_INCLUDE = {
    outlet: { select: { id: true, code: true, name: true } },
    product: { select: { id: true, code: true, name: true } },
} satisfies Prisma.OutletGoodsReceiptInclude;

type BardatRecord = Prisma.OutletGoodsReceiptGetPayload<{ include: typeof BARDAT_INCLUDE }>;

function dateValue(date: string): Date {
    return new Date(`${date}T00:00:00.000Z`);
}

function periodOf(date: Date): { month: number; year: number } {
    return { month: date.getUTCMonth() + 1, year: date.getUTCFullYear() };
}

function responseOf(record: BardatRecord) {
    return {
        id: record.id,
        outlet_id: record.outlet_id,
        product_id: record.product_id,
        date: record.date.toISOString().slice(0, 10),
        month: record.month,
        year: record.year,
        quantity: Number(record.quantity),
        import_batch_id: record.import_batch_id,
        created_at: record.created_at,
        updated_at: record.updated_at,
        outlet: record.outlet,
        product: record.product,
    };
}

function isUniqueError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export class BardatService {
    private static whereOf(query: QueryBardatDTO): Prisma.OutletGoodsReceiptWhereInput {
        const { search, outlet_id, product_id, month, year, date } = query;
        return {
            ...(outlet_id && { outlet_id }), ...(product_id && { product_id }), ...(month && { month }), ...(year && { year }), ...(date && { date: dateValue(date) }),
            ...(search && { OR: [
                { outlet: { code: { contains: search, mode: "insensitive" } } },
                { outlet: { name: { contains: search, mode: "insensitive" } } },
                { product: { code: { contains: search, mode: "insensitive" } } },
                { product: { name: { contains: search, mode: "insensitive" } } },
            ] }),
        };
    }

    static async list(query: QueryBardatDTO) {
        const { page = 1, take = 25, search, outlet_id, product_id, month, year, sortOrder = "desc" } = query;
        const { skip, take: limit } = GetPagination(page, take);
        const where = this.whereOf(query);
        const [data, len] = await Promise.all([
            prisma.outletGoodsReceipt.findMany({ where, skip, take: limit, orderBy: [{ date: sortOrder }, { id: sortOrder }], include: BARDAT_INCLUDE }),
            prisma.outletGoodsReceipt.count({ where }),
        ]);
        return { data: data.map(responseOf), len };
    }

    static async grid(query: QueryBardatDTO) {
        const { page = 1, take = 25 } = query;
        const records = await prisma.outletGoodsReceipt.findMany({ where: this.whereOf(query), orderBy: [{ outlet: { code: "asc" } }, { date: "asc" }, { product: { code: "asc" } }], include: BARDAT_INCLUDE });
        const columns = [...new Map(records.map((record) => {
            const date = record.date.toISOString().slice(0, 10);
            return [`${record.outlet_id}|${date}`, { key: `${record.outlet_id}|${date}`, outlet_id: record.outlet_id, outlet_code: record.outlet.code, outlet_name: record.outlet.name, date }];
        })).values()];
        const rows = [...new Map(records.map((record) => [`${record.product_id}`, { product_id: record.product_id, product_code: record.product.code, product_name: record.product.name, values: {} as Record<string, number>, ids: {} as Record<string, number> }])).values()];
        const rowMap = new Map(rows.map((row) => [row.product_id, row]));
        for (const record of records) {
            const row = rowMap.get(record.product_id);
            if (row) row.values[`${record.outlet_id}|${record.date.toISOString().slice(0, 10)}`] = Number(record.quantity);
            if (row) row.ids[`${record.outlet_id}|${record.date.toISOString().slice(0, 10)}`] = record.id;
        }
        const orderedProductIds = await orderProductIdsByForecast(rows.map((row) => row.product_id));
        const rank = new Map(orderedProductIds.map((productId, index) => [productId, index]));
        rows.sort((left, right) => (rank.get(left.product_id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.product_id) ?? Number.MAX_SAFE_INTEGER));
        const start = (page - 1) * take;
        return { columns, rows: rows.slice(start, start + take), len: rows.length, page, take, has_more: start + take < rows.length };
    }

    static async detail(id: number) {
        const record = await prisma.outletGoodsReceipt.findUnique({ where: { id }, include: BARDAT_INCLUDE });
        if (!record) throw new ApiError(404, "Data BARDAT tidak ditemukan");
        return responseOf(record);
    }

    private static async assertReferences(tx: Prisma.TransactionClient, payload: RequestBardatDTO): Promise<void> {
        const [outlet, product] = await Promise.all([
            tx.outlet.findFirst({ where: { id: payload.outlet_id, deleted_at: null }, select: { id: true } }),
            tx.product.findFirst({ where: { id: payload.product_id, deleted_at: null }, select: { id: true } }),
        ]);
        if (!outlet) throw new ApiError(404, "Outlet tidak ditemukan atau sudah tidak aktif");
        if (!product) throw new ApiError(404, "Produk tidak ditemukan atau sudah tidak aktif");
    }

    private static async syncInventory(tx: Prisma.TransactionClient, periods: Array<{ month: number; year: number }>): Promise<void> {
        const uniquePeriods = [...new Map(periods.map((period) => [`${period.year}-${period.month}`, period])).values()];
        const periodWhere = uniquePeriods.map((period) => ({ month: period.month, year: period.year }));
        const existing = await tx.outletInventory.findMany({ where: { OR: periodWhere }, select: { outlet_id: true, product_id: true, month: true, year: true } });
        const aggregates = await tx.outletGoodsReceipt.groupBy({ by: ["outlet_id", "product_id", "month", "year"], where: { OR: periodWhere }, _sum: { quantity: true } });
        const keys = new Set(existing.map((item) => `${item.outlet_id}|${item.product_id}|${item.month}|${item.year}`));
        for (const aggregate of aggregates) {
            const key = { outlet_id: aggregate.outlet_id, product_id: aggregate.product_id, month: aggregate.month, year: aggregate.year };
            keys.delete(`${key.outlet_id}|${key.product_id}|${key.month}|${key.year}`);
            await tx.outletInventory.upsert({
                where: { outlet_id_product_id_month_year: key },
                update: { quantity: aggregate._sum.quantity ?? 0 },
                create: { ...key, quantity: aggregate._sum.quantity ?? 0 },
            });
        }
        for (const key of keys) {
            const parts = key.split("|").map(Number);
            if (parts.length !== 4 || parts.some((value) => Number.isNaN(value))) continue;
            const outlet_id = Number(parts[0]);
            const product_id = Number(parts[1]);
            const month = Number(parts[2]);
            const year = Number(parts[3]);
            await tx.outletInventory.update({ where: { outlet_id_product_id_month_year: { outlet_id, product_id, month, year } }, data: { quantity: 0 } });
        }
    }

    static async create(payload: RequestBardatDTO) {
        try {
            const date = dateValue(payload.date);
            const period = periodOf(date);
            const record = await prisma.$transaction(async (tx) => {
                await this.assertReferences(tx, payload);
                const created = await tx.outletGoodsReceipt.create({
                    data: { outlet_id: payload.outlet_id, product_id: payload.product_id, date, month: period.month, year: period.year, quantity: payload.quantity, import_batch_id: `manual-${randomUUID()}` },
                    include: BARDAT_INCLUDE,
                });
                await this.syncInventory(tx, [period]);
                return created;
            });
            return responseOf(record);
        } catch (error) {
            if (isUniqueError(error)) throw new ApiError(409, "BARDAT untuk outlet, SKU, dan tanggal tersebut sudah ada");
            throw error;
        }
    }

    static async update(id: number, payload: RequestBardatDTO) {
        try {
            const record = await prisma.$transaction(async (tx) => {
                const existing = await tx.outletGoodsReceipt.findUnique({ where: { id }, select: { id: true, date: true } });
                if (!existing) throw new ApiError(404, "Data BARDAT tidak ditemukan");
                const date = dateValue(payload.date);
                const period = periodOf(date);
                const oldPeriod = periodOf(existing.date);
                await this.assertReferences(tx, payload);
                const updated = await tx.outletGoodsReceipt.update({
                    where: { id },
                    data: { outlet_id: payload.outlet_id, product_id: payload.product_id, date, month: period.month, year: period.year, quantity: payload.quantity },
                    include: BARDAT_INCLUDE,
                });
                await this.syncInventory(tx, [oldPeriod, period]);
                return updated;
            });
            return responseOf(record);
        } catch (error) {
            if (isUniqueError(error)) throw new ApiError(409, "BARDAT untuk outlet, SKU, dan tanggal tersebut sudah ada");
            throw error;
        }
    }
}
