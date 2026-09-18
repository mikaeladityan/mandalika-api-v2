import prisma from "../../../../config/prisma.js";
import { calculateSafetyStock } from "./calculation.js";
import type { QuerySafetyStockDTO, QuerySafetyStockSummaryDTO } from "./schema.js";
import type { SafetyStockDetailRow, SafetyStockSummaryRow } from "./schema.js";

type Query = QuerySafetyStockDTO | QuerySafetyStockSummaryDTO;
type ProductRecord = { id: number; code: string; name: string; status: "ACTIVE" | "PENDING" };
type OutletRecord = { id: number; code: string; name: string };

function periodOf(query: Query) {
    const start = new Date(Date.UTC(query.year, query.month - 1, 1));
    const end = new Date(Date.UTC(query.year, query.month - 1, 29));
    return { start, end, period_start: start.toISOString().slice(0, 10), period_end: new Date(Date.UTC(query.year, query.month - 1, 28)).toISOString().slice(0, 10) };
}

function statusRank(status: string) { return status === "ACTIVE" ? 0 : 1; }
function compareNullable(a: number | null, b: number | null, order: "asc" | "desc") {
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return (a - b) * (order === "desc" ? -1 : 1);
}

function sortDetails(rows: SafetyStockDetailRow[], query: QuerySafetyStockDTO) {
    const key = query.sortBy ?? "product_code";
    const direction = query.order ?? "asc";
    rows.sort((left, right) => {
        const status = statusRank(left.product_status) - statusRank(right.product_status);
        if (status) return status;
        if (key === "total_sales" || key === "weekly_average" || key === "standard_deviation" || key === "safety_stock" || key === "buffer_weeks") {
            const result = compareNullable(left[key], right[key], direction);
            if (result) return result;
        } else {
            const result = left.product_code.localeCompare(right.product_code) * (direction === "desc" ? -1 : 1);
            if (result) return result;
        }
        return left.outlet_code.localeCompare(right.outlet_code);
    });
}

function sortSummary(rows: SafetyStockSummaryRow[], query: Query) {
    const key = query.sortBy ?? "product_code";
    const direction = query.order ?? "asc";
    rows.sort((left, right) => {
        const status = statusRank(left.product_status) - statusRank(right.product_status);
        if (status) return status;
        if (key === "total_sales" || key === "safety_stock" || key === "sales_to_stock_ratio" || key === "buffer_percentage") {
            const result = compareNullable(left[key], right[key], direction);
            if (result) return result;
        } else {
            const result = left.product_code.localeCompare(right.product_code) * (direction === "desc" ? -1 : 1);
            if (result) return result;
        }
        return left.product_id - right.product_id;
    });
}

async function buildRows(query: QuerySafetyStockDTO) {
    const period = periodOf(query);
    const [products, outlets, issuances] = await Promise.all([
        prisma.product.findMany({ where: { deleted_at: null, status: { in: ["ACTIVE", "PENDING"] }, ...(query.product_id ? { id: query.product_id } : {}) }, select: { id: true, code: true, name: true, status: true }, orderBy: { code: "asc" } }),
        prisma.outlet.findMany({ where: { deleted_at: null, ...(query.outlet_id ? { id: query.outlet_id } : {}) }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
        prisma.outletIssuance.findMany({ where: { date: { gte: period.start, lt: period.end }, ...(query.product_id ? { product_id: query.product_id } : {}), ...(query.outlet_id ? { outlet_id: query.outlet_id } : {}) }, select: { outlet_id: true, product_id: true, date: true, quantity: true } }),
    ]);
    const productRows = products as ProductRecord[];
    const outletRows = outlets as OutletRecord[];
    const byPair = new Map<string, { weeks: [number, number, number, number]; has_data: boolean }>();
    for (const issuance of issuances) {
        const day = issuance.date.getUTCDate();
        if (day < 1 || day > 28) continue;
        const key = `${issuance.outlet_id}|${issuance.product_id}`;
        const current = byPair.get(key) ?? { weeks: [0, 0, 0, 0], has_data: false };
        const weekIndex = Math.floor((day - 1) / 7);
        current.weeks[weekIndex] = (current.weeks[weekIndex] ?? 0) + Number(issuance.quantity);
        current.has_data = true;
        byPair.set(key, current);
    }
    const rows: SafetyStockDetailRow[] = [];
    for (const product of productRows) for (const outlet of outletRows) {
        const pair = byPair.get(`${outlet.id}|${product.id}`) ?? { weeks: [0, 0, 0, 0] as [number, number, number, number], has_data: false };
        const calculation = calculateSafetyStock(pair.weeks, query.service_level);
        const { z_value: _zValue, ...metrics } = calculation;
        rows.push({ outlet_id: outlet.id, outlet_code: outlet.code, outlet_name: outlet.name, product_id: product.id, product_code: product.code, product_name: product.name, product_status: product.status, weeks: pair.weeks, ...metrics, has_data: pair.has_data });
    }
    return { rows, ...period };
}

export class SafetyStockService {
    static async list(query: QuerySafetyStockDTO) {
        const { rows, period_start, period_end } = await buildRows(query);
        sortDetails(rows, query);
        const start = (query.page - 1) * query.take;
        return { data: rows.slice(start, start + query.take), len: rows.length, page: query.page, take: query.take, period_start, period_end, service_level: query.service_level, z_value: calculateSafetyStock([0, 0, 0, 0], query.service_level).z_value };
    }

    static async summary(query: QuerySafetyStockSummaryDTO) {
        const { rows, period_start, period_end } = await buildRows({ ...query, outlet_id: undefined });
        const grouped = new Map<number, SafetyStockSummaryRow>();
        for (const row of rows) {
            const current = grouped.get(row.product_id) ?? { product_id: row.product_id, product_code: row.product_code, product_name: row.product_name, product_status: row.product_status, total_sales: 0, safety_stock: 0, sales_to_stock_ratio: null, buffer_percentage: null, has_data: false };
            current.total_sales += row.total_sales;
            current.safety_stock += row.safety_stock;
            current.has_data ||= row.has_data;
            grouped.set(row.product_id, current);
        }
        const data = [...grouped.values()].map((row) => ({ ...row, sales_to_stock_ratio: row.total_sales > 0 && row.safety_stock > 0 ? row.total_sales / row.safety_stock : null, buffer_percentage: row.total_sales > 0 ? (row.safety_stock / row.total_sales) * 100 : null }));
        sortSummary(data, query);
        const start = (query.page - 1) * query.take;
        return { data: data.slice(start, start + query.take), len: data.length, page: query.page, take: query.take, period_start, period_end, service_level: query.service_level, z_value: calculateSafetyStock([0, 0, 0, 0], query.service_level).z_value };
    }
}
