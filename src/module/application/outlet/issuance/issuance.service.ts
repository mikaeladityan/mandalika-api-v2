import { randomUUID } from "crypto";
import { Prisma } from "../../../../generated/prisma/client.js";
import prisma from "../../../../config/prisma.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { GetPagination } from "../../../../lib/utils/pagination.js";
import { QueryIssuanceDTO, RequestIssuanceDTO } from "./issuance.schema.js";
import { orderProductIdsByForecast } from "../shared/forecast-product-order.js";

const ISSUANCE_INCLUDE = {
    outlet: { select: { id: true, code: true, name: true } },
    product: { select: { id: true, code: true, name: true } },
} satisfies Prisma.OutletIssuanceInclude;

type IssuanceRecord = Prisma.OutletIssuanceGetPayload<{ include: typeof ISSUANCE_INCLUDE }>;

function dateValue(date: string): Date {
    return new Date(`${date}T00:00:00.000Z`);
}

function periodOf(date: Date): { month: number; year: number } {
    return { month: date.getUTCMonth() + 1, year: date.getUTCFullYear() };
}

function responseOf(record: IssuanceRecord) {
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

export class IssuanceService {
    private static whereOf(query: QueryIssuanceDTO): Prisma.OutletIssuanceWhereInput {
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

    static async list(query: QueryIssuanceDTO) {
        const { page = 1, take = 25, search, outlet_id, product_id, month, year, sortOrder = "desc" } = query;
        const { skip, take: limit } = GetPagination(page, take);
        const where = this.whereOf(query);
        const [data, len] = await Promise.all([
            prisma.outletIssuance.findMany({ where, skip, take: limit, orderBy: [{ date: sortOrder }, { id: sortOrder }], include: ISSUANCE_INCLUDE }),
            prisma.outletIssuance.count({ where }),
        ]);
        return { data: data.map(responseOf), len };
    }

    static async grid(query: QueryIssuanceDTO) {
        const records = await prisma.outletIssuance.findMany({ where: this.whereOf(query), orderBy: [{ outlet: { code: "asc" } }, { date: "asc" }, { product: { code: "asc" } }], include: ISSUANCE_INCLUDE });
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
        return { columns, rows };
    }

    static async detail(id: number) {
        const record = await prisma.outletIssuance.findUnique({ where: { id }, include: ISSUANCE_INCLUDE });
        if (!record) throw new ApiError(404, "Data ISSUANCE tidak ditemukan");
        return responseOf(record);
    }

    private static async assertReferences(tx: Prisma.TransactionClient, payload: RequestIssuanceDTO): Promise<void> {
        const [outlet, product] = await Promise.all([
            tx.outlet.findFirst({ where: { id: payload.outlet_id, deleted_at: null }, select: { id: true } }),
            tx.product.findFirst({ where: { id: payload.product_id, deleted_at: null }, select: { id: true } }),
        ]);
        if (!outlet) throw new ApiError(404, "Outlet tidak ditemukan atau sudah tidak aktif");
        if (!product) throw new ApiError(404, "Produk tidak ditemukan atau sudah tidak aktif");
    }

    static async create(payload: RequestIssuanceDTO) {
        try {
            const date = dateValue(payload.date);
            const period = periodOf(date);
            const record = await prisma.$transaction(async (tx) => {
                await this.assertReferences(tx, payload);
                const created = await tx.outletIssuance.create({
                    data: { outlet_id: payload.outlet_id, product_id: payload.product_id, date, month: period.month, year: period.year, quantity: payload.quantity, import_batch_id: `manual-${randomUUID()}` },
                    include: ISSUANCE_INCLUDE,
                });
                return created;
            });
            return responseOf(record);
        } catch (error) {
            if (isUniqueError(error)) throw new ApiError(409, "ISSUANCE untuk outlet, SKU, dan tanggal tersebut sudah ada");
            throw error;
        }
    }

    static async update(id: number, payload: RequestIssuanceDTO) {
        try {
            const record = await prisma.$transaction(async (tx) => {
                const existing = await tx.outletIssuance.findUnique({ where: { id }, select: { id: true, date: true } });
                if (!existing) throw new ApiError(404, "Data ISSUANCE tidak ditemukan");
                const date = dateValue(payload.date);
                const period = periodOf(date);
                await this.assertReferences(tx, payload);
                const updated = await tx.outletIssuance.update({
                    where: { id },
                    data: { outlet_id: payload.outlet_id, product_id: payload.product_id, date, month: period.month, year: period.year, quantity: payload.quantity },
                    include: ISSUANCE_INCLUDE,
                });
                return updated;
            });
            return responseOf(record);
        } catch (error) {
            if (isUniqueError(error)) throw new ApiError(409, "ISSUANCE untuk outlet, SKU, dan tanggal tersebut sudah ada");
            throw error;
        }
    }
}
