import prisma from "../../../../config/prisma.js";
import type { QueryStockResilienceDTO, StockResilienceRowDTO } from "./stock-resilience.schema.js";

function dateOnly(value: Date): string {
    return value.toISOString().slice(0, 10);
}

function monthBounds(month: number, year: number): { start: Date; end: Date } {
    return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 1)) };
}

export class StockResilienceService {
    static async list(query: QueryStockResilienceDTO): Promise<{ data: StockResilienceRowDTO[]; len: number }> {
        const { start, end } = monthBounds(query.month, query.year);
        const bardats = await prisma.outletGoodsReceipt.findMany({
            where: { date: { gte: start, lt: end }, ...(query.outlet_id ? { outlet_id: query.outlet_id } : {}), ...(query.product_id ? { product_id: query.product_id } : {}) },
            orderBy: [{ outlet_id: "asc" }, { product_id: "asc" }, { date: "asc" }],
            include: { outlet: { select: { id: true, code: true, name: true } }, product: { select: { id: true, code: true, name: true } } },
        });
        const rows: StockResilienceRowDTO[] = [];
        for (const [index, anchor] of bardats.entries()) {
            const next = bardats.slice(index + 1).find((candidate) => candidate.outlet_id === anchor.outlet_id && candidate.product_id === anchor.product_id);
            const intervalEnd = next?.date ?? end;
            const sales = await prisma.outletIssuance.aggregate({ where: { outlet_id: anchor.outlet_id, product_id: anchor.product_id, date: { gte: anchor.date, lt: intervalEnd } }, _sum: { quantity: true } });
            const bardatQuantity = Number(anchor.quantity);
            const salesQuantity = Number(sales._sum.quantity ?? 0);
            const resilienceQuantity = bardatQuantity - salesQuantity;
            rows.push({ outlet_id: anchor.outlet.id, outlet_code: anchor.outlet.code, outlet_name: anchor.outlet.name, product_id: anchor.product.id, product_code: anchor.product.code, product_name: anchor.product.name, anchor_date: dateOnly(anchor.date), next_bardat_date: next ? dateOnly(next.date) : null, bardat_quantity: bardatQuantity, sales_quantity: salesQuantity, resilience_quantity: resilienceQuantity, status: resilienceQuantity > 0 ? "AMAN" : resilienceQuantity === 0 ? "HABIS" : "KURANG" });
        }
        return { data: rows, len: rows.length };
    }
}
