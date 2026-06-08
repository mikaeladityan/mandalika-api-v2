import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConsolidationService } from "../module/application/consolidation/consolidation.service.js";
import prisma from "../config/prisma.js";

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
