import { beforeEach, describe, expect, it, vi } from "vitest";
import { RawmatImportService } from "../../module/application/rawmat/import/import.service.js";
import { redisClient } from "../../config/redis.js";

const tx = {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    supplier: { findMany: vi.fn() },
    rawMaterial: { upsert: vi.fn() },
    supplierMaterial: { upsert: vi.fn() },
};

vi.mock("../../config/prisma.js", () => ({
    default: {
        $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    },
}));

describe("RawmatImportService supplier reference", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        tx.$queryRaw
            .mockResolvedValueOnce([{ id: 1, slug: "pcs" }])
            .mockResolvedValueOnce([{ id: 2, slug: "packaging" }])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ id: 500, slug: "sup-005" }]);
        tx.supplier.findMany.mockResolvedValue([{ id: 5 }]);
        tx.rawMaterial.upsert.mockResolvedValue({ id: 99, barcode: "RM-005", name: "Material" });
        tx.supplierMaterial.upsert.mockResolvedValue({ id: 1 });
    });

    it("decodes SUP-005 to existing supplier id 5 without upserting a supplier", async () => {
        await (RawmatImportService as any).bulkInsert([
            {
                barcode: "RM-005",
                name: "Material",
                price: 95,
                min_buy: 1,
                min_stock: 0,
                unit: "PCS",
                category: "PACKAGING",
                supplier: "SUP-005",
                country: "INDONESIA",
                source: "LOCAL",
                lead_time: 30,
                errors: [],
            },
        ]);

        expect(tx.supplier.findMany).toHaveBeenCalledWith({
            where: { id: { in: [5] } },
            select: { id: true },
        });
        expect(tx.$queryRaw.mock.calls.some(([query]) =>
            query.strings?.join(" ").includes("INSERT INTO suppliers"),
        )).toBe(false);
        expect(tx.supplierMaterial.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                supplier_id_raw_material_id: {
                    supplier_id: 5,
                    raw_material_id: 99,
                },
            },
        }));
    });

    it("rejects an anonymous supplier code whose supplier ID does not exist", async () => {
        tx.supplier.findMany.mockResolvedValue([]);

        await expect((RawmatImportService as any).bulkInsert([
            {
                barcode: "RM-404",
                name: "Material",
                price: 95,
                min_buy: 1,
                min_stock: 0,
                unit: "PCS",
                category: "PACKAGING",
                supplier: "SUP-999",
                country: "INDONESIA",
                source: "LOCAL",
                lead_time: 30,
                errors: [],
            },
        ])).rejects.toThrow("Supplier dengan kode SUP-999 tidak ditemukan");
    });

    it("does not overwrite min_stock when CSV omits MIN STOCK", async () => {
        await (RawmatImportService as any).bulkInsert([
            {
                barcode: "RM-NO-MIN-STOCK",
                name: "Material",
                price: 95,
                min_buy: 1,
                min_stock: undefined,
                unit: "PCS",
                category: "PACKAGING",
                supplier: "SUP-005",
                country: "INDONESIA",
                source: "LOCAL",
                lead_time: 30,
                errors: [],
            },
        ]);

        const rawMaterialUpsert = tx.rawMaterial.upsert.mock.calls[0]?.[0];
        expect(rawMaterialUpsert.update).not.toHaveProperty("min_stock");
    });

    it("accepts SOURCE and NEGARA aliases used by raw-material CSV exports", async () => {
        const result = await RawmatImportService.preview([
            {
                BARCODE: "RM-005",
                "MATERIAL NAME": "Material",
                CATEGORY: "PACKAGING",
                UOM: "PCS",
                SUPPLIER: "SUP-005",
                SOURCE: "IMPORT",
                NEGARA: "INDONESIA",
                PRICE: 95,
            },
        ]);

        expect(result.valid).toBe(1);
        const payload = JSON.parse(vi.mocked(redisClient.set).mock.calls.at(-1)?.[1] as string);
        expect(payload.rows[0]).toMatchObject({ source: "IMPORT", country: "INDONESIA" });
    });
});
