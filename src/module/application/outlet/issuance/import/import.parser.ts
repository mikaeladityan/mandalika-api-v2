import {
    IssuanceCell,
    IssuanceMatrix,
    IssuancePeriod,
    IssuancePreviewRow,
} from "./import.schema.js";
import { ApiError } from "../../../../../lib/errors/api.error.js";

const asText = (cell: IssuanceCell): string =>
    cell instanceof Date ? cell.toISOString() : String(cell ?? "").trim();

function normalizeOutletCode(value: string): string {
    return value.trim().replace(/\s+/g, "-").toUpperCase();
}

function parseDate(cell: IssuanceCell): string | null {
    if (cell instanceof Date && !Number.isNaN(cell.getTime())) {
        return cell.toISOString().slice(0, 10);
    }
    if (typeof cell === "number" && Number.isFinite(cell)) {
        const date = new Date(Date.UTC(1899, 11, 30) + cell * 86400000);
        return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
    }
    const text = typeof cell === "string" ? cell.trim() : asText(cell);
    if (!text) return null;
    const shortDate = /^(\d{1,2})[/-](\d{1,2})$/.exec(text);
    if (shortDate) {
        const day = Number(shortDate[1]);
        const month = Number(shortDate[2]);
        if (day < 1 || day > 31 || month < 1 || month > 12) return null;
        return `${new Date().getUTCFullYear()}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function parseQuantity(cell: IssuanceCell): { value: number | null; blank: boolean } {
    if (cell === null || cell === undefined || (typeof cell === "string" && !cell.trim())) {
        return { value: null, blank: true };
    }
    if (typeof cell === "number") return { value: Number.isFinite(cell) ? cell : null, blank: false };
    if (cell instanceof Date) return { value: null, blank: false };
    const normalized = cell.replace(/\s/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
    const value = Number(normalized);
    return { value: Number.isFinite(value) ? value : null, blank: false };
}

export function unpivotIssuance(matrix: IssuanceMatrix): IssuancePreviewRow[] {
    if (matrix.length < 3) throw new Error("Format ISSUANCE tidak memiliki baris header yang cukup");
    const tokoRow = matrix.findIndex((row) => row.some((cell) => asText(cell).toUpperCase().startsWith("TOKO")));
    const tanggalRow = matrix.findIndex((row) => row.some((cell) => asText(cell).toUpperCase().startsWith("TANGGAL")));
    if (tokoRow < 0 || tanggalRow < 0 || tanggalRow <= tokoRow) {
        throw new ApiError(400, "Header ISSUANCE TOKO/TANGGAL tidak ditemukan atau urutannya salah");
    }

    const width = Math.max(...matrix.map((row) => row.length));
    const productHeaderRow = matrix.findIndex((row, index) => index > tanggalRow && row.some((cell) => asText(cell).toUpperCase() === "PRODUCT CODE"));
    const productCodeCol = productHeaderRow >= 0 ? (matrix[productHeaderRow] ?? []).findIndex((cell) => asText(cell).toUpperCase() === "PRODUCT CODE") : 0;
    const firstDateCol = (matrix[tanggalRow] ?? []).findIndex((cell) => parseDate(cell) !== null);
    if (productHeaderRow < 0 || productCodeCol < 0 || firstDateCol < 0) {
        throw new ApiError(400, "Kolom PRODUCT CODE atau tanggal ISSUANCE tidak ditemukan");
    }
    const outlets: Array<string | null> = Array.from({ length: width }, () => null);
    const dates: Array<string | null> = Array.from({ length: width }, () => null);
    let currentOutlet: string | null = null;
    let currentDate: string | null = null;
    for (let col = firstDateCol; col < width; col += 1) {
        const outletText = asText(matrix[tokoRow]?.[col] ?? null);
        if (outletText && outletText.toUpperCase() !== "TOKO") currentOutlet = normalizeOutletCode(outletText);
        const parsedDate = parseDate(matrix[tanggalRow]?.[col] ?? null);
        if (parsedDate) currentDate = parsedDate;
        outlets[col] = currentOutlet;
        dates[col] = currentDate;
    }

    const result: IssuancePreviewRow[] = [];
    for (let rowIndex = productHeaderRow + 1; rowIndex < matrix.length; rowIndex += 1) {
        const row = matrix[rowIndex] ?? [];
        const productCode = asText(row[productCodeCol] ?? null);
        if (!productCode || /^(total|subtotal|sku|produk)$/i.test(productCode)) continue;
        for (let col = firstDateCol; col < width; col += 1) {
            const quantity = parseQuantity(row[col] ?? null);
            if (quantity.blank) continue;
            const errors: string[] = [];
            if (!outlets[col]) errors.push("Outlet tidak terdeteksi");
            if (!dates[col]) errors.push("Tanggal tidak valid");
            if (quantity.value === null) errors.push("Quantity harus berupa angka");
            if (quantity.value !== null && quantity.value < 0) errors.push("Quantity tidak boleh negatif");
            const date = dates[col] ?? "";
            result.push({
                product_code: productCode,
                outlet_code: outlets[col] ?? "",
                date,
                quantity: quantity.value ?? 0,
                product_id: null,
                outlet_id: null,
                errors,
            });
        }
    }
    return result;
}

export function periodsFromRows(rows: IssuancePreviewRow[]): IssuancePeriod[] {
    const values = new Map<string, IssuancePeriod>();
    for (const row of rows) {
        const date = new Date(`${row.date}T00:00:00Z`);
        if (!Number.isNaN(date.getTime())) {
            const period = { month: date.getUTCMonth() + 1, year: date.getUTCFullYear() };
            values.set(`${period.year}-${period.month}`, period);
        }
    }
    return [...values.values()].sort((a, b) => a.year - b.year || a.month - b.month);
}
