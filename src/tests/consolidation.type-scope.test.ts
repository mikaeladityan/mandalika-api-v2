import { describe, it, expect, vi, afterEach } from "vitest";
import { ConsolidationService } from "../module/application/consolidation/consolidation.service.js";
import prisma from "../config/prisma.js";

const draftRow = {
    id: 1,
    raw_mat_id: 11,
    quantity: 5,
    pic_id: null,
    status: "DRAFT",
    created_at: new Date(),
    raw_material: {
        barcode: "RM-11",
        name: "Material",
        unit_raw_material: { name: "PCS" },
        supplier_materials: [{ unit_price: 1000, min_buy: 1, supplier: { id: 3, source: "IMPORT" } }],
    },
};

const stubQueryRaw = (rows: { id: number }[]) =>
    vi.spyOn(prisma, "$queryRaw").mockResolvedValue(rows as never) as unknown as {
        mock: { calls: [{ sql?: string }][] };
    };

const stubDrafts = () => {
    const findMany = vi.fn().mockResolvedValue([draftRow]);
    const count = vi.fn().mockResolvedValue(1);
    (prisma as any).materialPurchaseDraft = { findMany, count };
    return { findMany, count };
};

describe("Consolidation type scope mengikuti aturan rekomendasi", () => {
    const original = (prisma as any).materialPurchaseDraft;

    afterEach(() => {
        (prisma as any).materialPurchaseDraft = original;
        vi.restoreAllMocks();
    });

    it("memilih RM lewat supplier preferred dengan supplier_id terkecil", async () => {
        const queryRaw = stubQueryRaw([{ id: 11 }]);
        const { findMany } = stubDrafts();

        await ConsolidationService.list({ type: "lokal", page: 1, take: 25, view: "visible" } as never);

        const sql = (queryRaw.mock.calls[0]?.[0] as any)?.sql ?? "";
        expect(sql).toContain("is_preferred = true");
        expect(sql).toContain("ORDER BY sm.supplier_id ASC");
        expect(findMany.mock.calls[0]?.[0]?.where?.raw_mat_id).toEqual({ in: [11] });
    });

    it("tidak lagi meloloskan RM hanya karena punya supplier non-preferred bersumber sama", async () => {
        stubQueryRaw([]);
        const { findMany } = stubDrafts();

        await ConsolidationService.list({ type: "lokal", page: 1, take: 25, view: "visible" } as never);

        expect(findMany.mock.calls[0]?.[0]?.where?.raw_material?.supplier_materials).toBeUndefined();
        expect(findMany.mock.calls[0]?.[0]?.where?.raw_mat_id).toEqual({ in: [] });
    });

    it("memakai scope yang sama pada ringkasan supplier", async () => {
        stubQueryRaw([{ id: 11 }]);
        const { findMany } = stubDrafts();

        await ConsolidationService.summaryBySupplier({ type: "impor", page: 1, take: 25, view: "visible" } as never);

        expect(findMany.mock.calls[0]?.[0]?.where?.raw_mat_id).toEqual({ in: [11] });
    });

    it("mengambil supplier preferred dengan supplier_id terkecil untuk nama dan harga", async () => {
        stubQueryRaw([{ id: 11 }]);
        const { findMany } = stubDrafts();

        await ConsolidationService.list({ type: "lokal", page: 1, take: 25, view: "visible" } as never);

        const include = findMany.mock.calls[0]?.[0]?.include?.raw_material?.include?.supplier_materials;
        expect(include?.where).toEqual({ is_preferred: true });
        expect(include?.orderBy).toEqual({ supplier_id: "asc" });
    });
});
