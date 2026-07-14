import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConsolidationService } from "../module/application/consolidation/consolidation.service.js";
import prisma from "../config/prisma.js";
import { SUPPLIER_OBSCURE_REGEX } from "../lib/utils/supplier-obscure.js";

describe("ConsolidationService.bulkUpdateStatus(DRAFT) — rollback with PO cleanup", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    const buildTx = (overrides: Partial<any> = {}) => ({
        purchaseRFQItem: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        purchaseOrderItem: {
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            groupBy: vi.fn().mockResolvedValue([]),
        },
        purchaseOrder: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        materialPurchaseDraft: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        ...overrides,
    });

    const mockRollbackFor = (
        draftRows: { id: number; raw_mat_id: number; month: number; year: number }[],
        poItems: any[],
        rfqLinks: any[] = [],
        apCount = 0,
    ) => {
        // @ts-ignore
        prisma.purchaseRFQItem = { findMany: vi.fn().mockResolvedValue(rfqLinks) };
        // @ts-ignore
        prisma.materialPurchaseDraft = { findMany: vi.fn().mockResolvedValue(draftRows) };
        // @ts-ignore
        prisma.$queryRaw = vi.fn().mockResolvedValue(poItems);
        // @ts-ignore
        prisma.accountPayable = { count: vi.fn().mockResolvedValue(apCount) };
    };

    it("deletes matching PO items and removes empty PO header on rollback", async () => {
        mockRollbackFor(
            [{ id: 1, raw_mat_id: 10, month: 6, year: 2026 }],
            [
                {
                    item_id: 501,
                    po_id: 901,
                    raw_material_id: 10,
                    qty_received: 0,
                    po_number: "PO-1",
                    month: 6,
                    year: 2026,
                },
            ],
        );
        const tx = buildTx();
        // After deletion, no items remain for po_id 901 (groupBy returns empty)
        // @ts-ignore
        prisma.$transaction = vi.fn(async (cb) => cb(tx));

        await ConsolidationService.bulkUpdateStatus([1], "DRAFT");

        expect(tx.purchaseOrderItem.deleteMany).toHaveBeenCalledWith({
            where: { id: { in: [501] } },
        });
        expect(tx.purchaseOrder.deleteMany).toHaveBeenCalledWith({
            where: { id: { in: [901] } },
        });
        expect(tx.materialPurchaseDraft.updateMany).toHaveBeenCalledWith({
            where: { id: { in: [1] } },
            data: { status: "DRAFT", updated_at: expect.any(Date) },
        });
    });

    it("keeps PO header when other items remain", async () => {
        mockRollbackFor(
            [{ id: 1, raw_mat_id: 10, month: 6, year: 2026 }],
            [
                {
                    item_id: 501,
                    po_id: 901,
                    raw_material_id: 10,
                    qty_received: 0,
                    po_number: "PO-1",
                    month: 6,
                    year: 2026,
                },
            ],
        );
        const tx = buildTx({
            purchaseOrderItem: {
                deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
                // Sibling item still exists on PO 901
                groupBy: vi.fn().mockResolvedValue([{ po_id: 901, _count: { id: 1 } }]),
            },
        });
        // @ts-ignore
        prisma.$transaction = vi.fn(async (cb) => cb(tx));

        await ConsolidationService.bulkUpdateStatus([1], "DRAFT");

        expect(tx.purchaseOrderItem.deleteMany).toHaveBeenCalled();
        expect(tx.purchaseOrder.deleteMany).not.toHaveBeenCalled();
    });

    it("blocks rollback when qty_received > 0", async () => {
        mockRollbackFor(
            [{ id: 1, raw_mat_id: 10, month: 6, year: 2026 }],
            [
                {
                    item_id: 501,
                    po_id: 901,
                    raw_material_id: 10,
                    qty_received: 5,
                    po_number: "PO-RECEIVED",
                    month: 6,
                    year: 2026,
                },
            ],
        );

        await expect(
            ConsolidationService.bulkUpdateStatus([1], "DRAFT"),
        ).rejects.toThrow(/sudah ada penerimaan barang/i);
    });

    it("blocks rollback when AP exists for affected PO", async () => {
        mockRollbackFor(
            [{ id: 1, raw_mat_id: 10, month: 6, year: 2026 }],
            [
                {
                    item_id: 501,
                    po_id: 901,
                    raw_material_id: 10,
                    qty_received: 0,
                    po_number: "PO-1",
                    month: 6,
                    year: 2026,
                },
            ],
            [],
            2,
        );

        await expect(
            ConsolidationService.bulkUpdateStatus([1], "DRAFT"),
        ).rejects.toThrow(/Account Payable/i);
    });

    it("does nothing on PO side when no matching PO items exist (no PO ever created)", async () => {
        mockRollbackFor([{ id: 1, raw_mat_id: 10, month: 6, year: 2026 }], []);
        const tx = buildTx();
        // @ts-ignore
        prisma.$transaction = vi.fn(async (cb) => cb(tx));

        await ConsolidationService.bulkUpdateStatus([1], "DRAFT");

        expect(tx.purchaseOrderItem.deleteMany).not.toHaveBeenCalled();
        expect(tx.purchaseOrder.deleteMany).not.toHaveBeenCalled();
        expect(tx.materialPurchaseDraft.updateMany).toHaveBeenCalled();
    });

    it("ignores PO items whose raw_mat matches but month/year doesn't", async () => {
        mockRollbackFor(
            [{ id: 1, raw_mat_id: 10, month: 6, year: 2026 }],
            [
                {
                    item_id: 777,
                    po_id: 999,
                    raw_material_id: 10,
                    qty_received: 0,
                    po_number: "PO-OTHER-MONTH",
                    month: 7, // different month
                    year: 2026,
                },
            ],
        );
        const tx = buildTx();
        // @ts-ignore
        prisma.$transaction = vi.fn(async (cb) => cb(tx));

        await ConsolidationService.bulkUpdateStatus([1], "DRAFT");

        expect(tx.purchaseOrderItem.deleteMany).not.toHaveBeenCalled();
        expect(tx.purchaseOrder.deleteMany).not.toHaveBeenCalled();
    });
});

describe("ConsolidationService.list — supplier identity masking", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("masks supplier identity in list response (preferred supplier name obscured)", async () => {
        const mockFindMany = vi.fn().mockResolvedValue([
            {
                id: 1, raw_mat_id: 7, quantity: 10, pic_id: null, status: "DRAFT", created_at: new Date(),
                raw_material: {
                    barcode: "X1", name: "RM-1",
                    unit_raw_material: { name: "kg" },
                    supplier_materials: [
                        { unit_price: 100, min_buy: 1, supplier: { id: 42, name: "PT Real Vendor" } },
                    ],
                },
            },
            {
                id: 2, raw_mat_id: 8, quantity: 5, pic_id: null, status: "DRAFT", created_at: new Date(),
                raw_material: {
                    barcode: "X2", name: "RM-2",
                    unit_raw_material: { name: "kg" },
                    supplier_materials: [
                        { unit_price: 200, min_buy: 1, supplier: { id: 1000, name: "PT Other Vendor" } },
                    ],
                },
            },
            {
                id: 3, raw_mat_id: 9, quantity: 1, pic_id: null, status: "DRAFT", created_at: new Date(),
                raw_material: {
                    barcode: "X3", name: "RM-3",
                    unit_raw_material: { name: "kg" },
                    supplier_materials: [],  // no preferred supplier
                },
            },
        ]);
        const mockCount = vi.fn().mockResolvedValue(3);
        // @ts-ignore
        prisma.materialPurchaseDraft = { findMany: mockFindMany, count: mockCount };

        const { data } = await ConsolidationService.list({ page: 1, take: 10 } as any);

        expect(data[0]!.supplier_name).toBe("SUP-042");
        expect(data[1]!.supplier_name).toBe("SUP1000");
        expect(data[2]!.supplier_name).toBe("SUP-???");  // no preferred supplier → null id → fallback
        for (const row of data) {
            expect(row.supplier_name).toMatch(SUPPLIER_OBSCURE_REGEX);
            expect(row.supplier_name).toHaveLength(7);
        }
    });
});

describe("ConsolidationService.bulkToggleHide", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("sets hidden_at to a Date when hidden=true", async () => {
        const updateMany = vi.fn().mockResolvedValue({ count: 2 });
        // @ts-ignore
        prisma.materialPurchaseDraft = { updateMany };

        await ConsolidationService.bulkToggleHide({ ids: [1, 2], hidden: true });

        expect(updateMany).toHaveBeenCalledWith({
            where: { id: { in: [1, 2] } },
            data: { hidden_at: expect.any(Date) },
        });
    });

    it("clears hidden_at when hidden=false", async () => {
        const updateMany = vi.fn().mockResolvedValue({ count: 1 });
        // @ts-ignore
        prisma.materialPurchaseDraft = { updateMany };

        await ConsolidationService.bulkToggleHide({ ids: [3], hidden: false });

        expect(updateMany).toHaveBeenCalledWith({
            where: { id: { in: [3] } },
            data: { hidden_at: null },
        });
    });
});

describe("ConsolidationService.list — hidden filter", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    const setupListMocks = (visibleCount = 0, hiddenCount = 0) => {
        const count = vi
            .fn()
            .mockResolvedValueOnce(visibleCount)
            .mockResolvedValueOnce(hiddenCount);
        const findMany = vi.fn().mockResolvedValue([]);
        // @ts-ignore
        prisma.materialPurchaseDraft = { count, findMany };
        return { count, findMany };
    };

    it("filters hidden_at: null on visible view", async () => {
        const { findMany } = setupListMocks();
        await ConsolidationService.list({ page: 1, take: 10, view: "visible" } as any);
        expect(findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ hidden_at: null }),
            }),
        );
    });

    it("filters hidden_at: { not: null } on hidden view", async () => {
        const { findMany } = setupListMocks();
        await ConsolidationService.list({ page: 1, take: 10, view: "hidden" } as any);
        expect(findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ hidden_at: { not: null } }),
            }),
        );
    });

    it("returns visible_len, hidden_len, and len matching active view", async () => {
        setupListMocks(5, 2);
        const res = await ConsolidationService.list({ page: 1, take: 10, view: "visible" } as any);
        expect(res.visible_len).toBe(5);
        expect(res.hidden_len).toBe(2);
        expect(res.len).toBe(5);
    });

    it("len uses hidden count on hidden view", async () => {
        setupListMocks(5, 2);
        const res = await ConsolidationService.list({ page: 1, take: 10, view: "hidden" } as any);
        expect(res.len).toBe(2);
    });
});

describe("ConsolidationService.summaryBySupplier — hidden excluded", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("always filters hidden_at: null", async () => {
        const findMany = vi.fn().mockResolvedValue([]);
        // @ts-ignore
        prisma.materialPurchaseDraft = { findMany };
        await ConsolidationService.summaryBySupplier({ page: 1, take: 10 } as any);
        expect(findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ hidden_at: null }),
            }),
        );
    });
});
