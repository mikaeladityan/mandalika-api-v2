import prisma from "../../../../config/prisma.js";
import type { Prisma } from "../../../../generated/prisma/client.js";
import type { QueryStockResilienceDTO, StockResilienceRowDTO } from "./stock-resilience.schema.js";
import { orderProductIdsByForecast } from "../shared/forecast-product-order.js";

function dateOnly(value: Date): string {
    return value.toISOString().slice(0, 10);
}

function monthBounds(month: number, year: number): { start: Date; end: Date } {
    return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 1)) };
}

function daysBetween(start: Date, end: Date): number {
    return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86_400_000));
}

export class StockResilienceService {
    static async list(query: QueryStockResilienceDTO): Promise<{ data: StockResilienceRowDTO[]; len: number; page: number; take: number; has_more: boolean }> {
        const { start: monthStart, end } = monthBounds(query.month, query.year);
        const selectedDate = query.date ? new Date(`${query.date}T00:00:00.000Z`) : null;
        const where: Prisma.OutletGoodsReceiptWhereInput = { date: selectedDate ? selectedDate : { gte: monthStart, lt: end }, ...(query.outlet_id ? { outlet_id: query.outlet_id } : {}), ...(query.product_id ? { product_id: query.product_id } : {}), ...(query.search ? { OR: [{ outlet: { is: { code: { contains: query.search, mode: "insensitive" } } } }, { outlet: { is: { name: { contains: query.search, mode: "insensitive" } } } }, { product: { is: { code: { contains: query.search, mode: "insensitive" } } } }, { product: { is: { name: { contains: query.search, mode: "insensitive" } } } }] } : {}) };
        const groupRecords = await prisma.outletGoodsReceipt.findMany({
            where,
            distinct: ["outlet_id", "product_id"],
            orderBy: [{ outlet: { code: "asc" } }, { product: { code: "asc" } }],
            select: {
                outlet_id: true,
                product_id: true,
                outlet: { select: { code: true } },
            },
        });
        const orderedProductIds = await orderProductIdsByForecast(groupRecords.map((group) => group.product_id));
        const productRank = new Map(orderedProductIds.map((productId, index) => [productId, index]));
        const orderedGroups = [...groupRecords].sort((left, right) => {
            const productComparison = (productRank.get(left.product_id) ?? Number.MAX_SAFE_INTEGER) - (productRank.get(right.product_id) ?? Number.MAX_SAFE_INTEGER);
            return productComparison || left.outlet.code.localeCompare(right.outlet.code) || left.outlet_id - right.outlet_id;
        });
        const pageStart = (query.page - 1) * query.take;
        const pageGroups = orderedGroups.slice(pageStart, pageStart + query.take);
        if (pageGroups.length === 0) return { data: [], len: orderedGroups.length, page: query.page, take: query.take, has_more: false };
        const groupFilter = { OR: pageGroups.map(({ outlet_id, product_id }) => ({ outlet_id, product_id })) };
        const bardats = await prisma.outletGoodsReceipt.findMany({
            where: { AND: [where, groupFilter] },
            orderBy: [{ outlet: { code: "asc" } }, { date: "asc" }, { product: { code: "asc" } }],
            include: { outlet: { select: { id: true, code: true, name: true } }, product: { select: { id: true, code: true, name: true } } },
        });
        const now = new Date();
        const rows: StockResilienceRowDTO[] = await Promise.all(bardats.map(async (anchor) => {
            const anchorNumber = await prisma.outletGoodsReceipt.count({ where: { outlet_id: anchor.outlet_id, product_id: anchor.product_id, date: { gte: monthStart, lt: anchor.date } } }) + 1;
            const next = await prisma.outletGoodsReceipt.findFirst({ where: { outlet_id: anchor.outlet_id, product_id: anchor.product_id, date: { gt: anchor.date } }, orderBy: { date: "asc" }, select: { date: true } });
            const intervalEnd = next?.date ?? (now < end ? now : end);
            const sales = await prisma.outletIssuance.aggregate({ where: { outlet_id: anchor.outlet_id, product_id: anchor.product_id, date: { gte: anchor.date, lt: intervalEnd } }, _sum: { quantity: true } });
            const bardatQuantity = Number(anchor.quantity);
            const salesQuantity = Number(sales._sum.quantity ?? 0);
            const resilienceQuantity = bardatQuantity - salesQuantity;
            const intervalDays = daysBetween(anchor.date, intervalEnd);
            const averageDailySales = salesQuantity / intervalDays;
            const salesPerWeek = averageDailySales * 7;
            const netWeeklyChange = bardatQuantity - salesPerWeek;
            return { outlet_id: anchor.outlet.id, outlet_code: anchor.outlet.code, outlet_name: anchor.outlet.name, product_id: anchor.product.id, product_code: anchor.product.code, product_name: anchor.product.name, anchor_number: anchorNumber, anchor_date: dateOnly(anchor.date), next_bardat_date: next ? dateOnly(next.date) : null, bardat_quantity: bardatQuantity, sales_quantity: salesQuantity, resilience_quantity: resilienceQuantity, average_daily_sales: averageDailySales, resilience_days: averageDailySales > 0 ? resilienceQuantity / averageDailySales : null, sales_per_week: salesPerWeek, net_weekly_change: netWeeklyChange, starting_stock_estimate: Math.max(netWeeklyChange, 0), minimum_starting_stock: Math.max(-netWeeklyChange, 0), stock_health: netWeeklyChange >= 0 ? "SEHAT" : "TERGERUS", status: resilienceQuantity > 0 ? "AMAN" : resilienceQuantity === 0 ? "HABIS" : "KURANG" };
        }));
        const groupRank = new Map(pageGroups.map((group, index) => [`${group.outlet_id}|${group.product_id}`, index]));
        rows.sort((left, right) => (groupRank.get(`${left.outlet_id}|${left.product_id}`) ?? Number.MAX_SAFE_INTEGER) - (groupRank.get(`${right.outlet_id}|${right.product_id}`) ?? Number.MAX_SAFE_INTEGER) || left.anchor_date.localeCompare(right.anchor_date));
        return { data: rows, len: orderedGroups.length, page: query.page, take: query.take, has_more: pageStart + query.take < orderedGroups.length };
    }
}
