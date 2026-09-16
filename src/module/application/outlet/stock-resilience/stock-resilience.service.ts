import prisma from "../../../../config/prisma.js";
import type { Prisma } from "../../../../generated/prisma/client.js";
import type { QueryStockResilienceDTO, StockResilienceRowDTO } from "./stock-resilience.schema.js";

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
        const { start, end } = monthBounds(query.month, query.year);
        const selectedDate = query.date ? new Date(`${query.date}T00:00:00.000Z`) : null;
        const where: Prisma.OutletGoodsReceiptWhereInput = { date: selectedDate ? selectedDate : { gte: start, lt: end }, ...(query.outlet_id ? { outlet_id: query.outlet_id } : {}), ...(query.product_id ? { product_id: query.product_id } : {}), ...(query.search ? { OR: [{ outlet: { is: { code: { contains: query.search, mode: "insensitive" } } } }, { outlet: { is: { name: { contains: query.search, mode: "insensitive" } } } }, { product: { is: { code: { contains: query.search, mode: "insensitive" } } } }, { product: { is: { name: { contains: query.search, mode: "insensitive" } } } }] } : {}) };
        const total = await prisma.outletGoodsReceipt.count({ where });
        const bardats = await prisma.outletGoodsReceipt.findMany({
            where,
            orderBy: [{ outlet_id: "asc" }, { product_id: "asc" }, { date: "asc" }],
            skip: (query.page - 1) * query.take,
            take: query.take,
            include: { outlet: { select: { id: true, code: true, name: true } }, product: { select: { id: true, code: true, name: true } } },
        });
        const rows: StockResilienceRowDTO[] = [];
        for (const anchor of bardats) {
            const anchorNumber = await prisma.outletGoodsReceipt.count({ where: { outlet_id: anchor.outlet_id, product_id: anchor.product_id, date: { gte: start, lt: anchor.date } } }) + 1;
            const next = await prisma.outletGoodsReceipt.findFirst({ where: { outlet_id: anchor.outlet_id, product_id: anchor.product_id, date: { gt: anchor.date } }, orderBy: { date: "asc" }, select: { date: true } });
            const today = new Date();
            const intervalEnd = next?.date ?? (today < end ? today : end);
            const sales = await prisma.outletIssuance.aggregate({ where: { outlet_id: anchor.outlet_id, product_id: anchor.product_id, date: { gte: anchor.date, lt: intervalEnd } }, _sum: { quantity: true } });
            const bardatQuantity = Number(anchor.quantity);
            const salesQuantity = Number(sales._sum.quantity ?? 0);
            const resilienceQuantity = bardatQuantity - salesQuantity;
            const intervalDays = daysBetween(anchor.date, intervalEnd);
            const averageDailySales = salesQuantity / intervalDays;
            const salesPerWeek = averageDailySales * 7;
            const netWeeklyChange = bardatQuantity - salesPerWeek;
            rows.push({ outlet_id: anchor.outlet.id, outlet_code: anchor.outlet.code, outlet_name: anchor.outlet.name, product_id: anchor.product.id, product_code: anchor.product.code, product_name: anchor.product.name, anchor_number: anchorNumber, anchor_date: dateOnly(anchor.date), next_bardat_date: next ? dateOnly(next.date) : null, bardat_quantity: bardatQuantity, sales_quantity: salesQuantity, resilience_quantity: resilienceQuantity, average_daily_sales: averageDailySales, resilience_days: averageDailySales > 0 ? resilienceQuantity / averageDailySales : null, sales_per_week: salesPerWeek, net_weekly_change: netWeeklyChange, starting_stock_estimate: Math.max(netWeeklyChange, 0), minimum_starting_stock: Math.max(-netWeeklyChange, 0), stock_health: netWeeklyChange >= 0 ? "SEHAT" : "TERGERUS", status: resilienceQuantity > 0 ? "AMAN" : resilienceQuantity === 0 ? "HABIS" : "KURANG" });
        }
        return { data: rows, len: total, page: query.page, take: query.take, has_more: query.page * query.take < total };
    }
}
