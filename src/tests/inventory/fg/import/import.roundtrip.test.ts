import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "../../../../config/prisma.js";
import { ParseCSV } from "../../../../lib/csv.js";
import { FGService } from "../../../../module/application/inventory/fg/fg.service.js";
import {
    FG_IMPORT_HEADERS,
    FGImportRowSchema,
} from "../../../../module/application/inventory/fg/import/import.schema.js";

// Dev-flow §1.I "Verifikasi": export CSV → ParseCSV → FGImportRowSchema.safeParse(row).
// Memastikan user yang export → edit Excel → import balik tidak menemui rename kolom.

type ProductRow = {
    id: number;
    code: string;
    name: string;
    gender: "UNISEX" | "WOMEN" | "MEN";
    lead_time: number;
    z_value: string;
    distribution_percentage: string;
    safety_percentage: string;
    status: "PENDING" | "ACTIVE" | "INACTIVE" | "DELETE";
    product_type: { id: number; name: string; slug: string } | null;
    size: { id: number; size: number } | null;
};

const makeProduct = (overrides: Partial<ProductRow> = {}): ProductRow => ({
    id: 1,
    code: "FG_001",
    name: "Parfum Aroma A",
    gender: "UNISEX",
    lead_time: 14,
    z_value: "1.65",
    distribution_percentage: "0.50",
    safety_percentage: "0.10",
    status: "ACTIVE",
    product_type: { id: 1, name: "EDP", slug: "edp" },
    size: { id: 1, size: 60 },
    ...overrides,
});

const bufferOf = async (raw: ArrayBuffer | Uint8Array | Buffer): Promise<Buffer> => {
    if (Buffer.isBuffer(raw)) return raw;
    if (raw instanceof Uint8Array) return Buffer.from(raw);
    return Buffer.from(new Uint8Array(raw));
};

describe("FG export ⇄ import round-trip", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("setiap row CSV hasil export lolos FGImportRowSchema.safeParse", async () => {
        const products = [
            makeProduct({ id: 1, code: "FG_001", size: { id: 1, size: 60 } }),
            makeProduct({
                id: 2,
                code: "FG_002",
                name: "Parfum Aroma B",
                gender: "WOMEN",
                size: { id: 2, size: 110 },
                product_type: { id: 2, name: "EDT", slug: "edt" },
            }),
            makeProduct({
                id: 3,
                code: "FG_003",
                name: "Parfum Aroma C",
                gender: "MEN",
                size: { id: 3, size: 30 },
            }),
        ];
        vi.mocked(prisma.product.count).mockResolvedValueOnce(products.length);
        vi.mocked(prisma.product.findMany).mockResolvedValueOnce(products as never);

        const csvBuffer = await bufferOf(await FGService.export({ sortBy: "updated_at", sortOrder: "desc" }));
        const rows = ParseCSV(csvBuffer) as Array<Record<string, unknown>>;

        expect(rows).toHaveLength(products.length);

        for (const row of rows) {
            const result = FGImportRowSchema.safeParse(row);
            expect(result.success, JSON.stringify({ row, error: result.success ? null : result.error.format() })).toBe(true);
        }
    });

    it("kolom SIZE pada CSV adalah angka murni (tanpa unit suffix)", async () => {
        const products = [makeProduct({ size: { id: 1, size: 75 } })];
        vi.mocked(prisma.product.count).mockResolvedValueOnce(products.length);
        vi.mocked(prisma.product.findMany).mockResolvedValueOnce(products as never);

        const csvBuffer = await bufferOf(await FGService.export({ sortBy: "updated_at", sortOrder: "desc" }));
        const rows = ParseCSV(csvBuffer) as Array<Record<string, unknown>>;

        const sizeValue = rows[0]?.[FG_IMPORT_HEADERS.size];
        expect(String(sizeValue).trim()).toBe("75");
        expect(String(sizeValue)).not.toMatch(/ML/i);
    });

    it("CSV memuat semua header roundtrip dengan ejaan persis sama", async () => {
        vi.mocked(prisma.product.count).mockResolvedValueOnce(1);
        vi.mocked(prisma.product.findMany).mockResolvedValueOnce([makeProduct()] as never);

        const csvBuffer = await bufferOf(await FGService.export({ sortBy: "updated_at", sortOrder: "desc" }));
        const rows = ParseCSV(csvBuffer) as Array<Record<string, unknown>>;
        const headers = Object.keys(rows[0] ?? {});

        for (const header of Object.values(FG_IMPORT_HEADERS)) {
            expect(headers).toContain(header);
        }
    });
});
