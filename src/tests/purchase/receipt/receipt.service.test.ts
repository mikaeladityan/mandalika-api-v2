import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReceiptService } from "../../../module/application/purchase/receipt/receipt.service.js";
import prisma from "../../../config/prisma.js";
import { ApiError } from "../../../lib/errors/api.error.js";

const userId = "user-test";

const mockPOItem = {
    id: 10,
    po_id: 1,
    raw_material_id: 5,
    item_code: "RM001",
    item_name: "Kain Katun",
    item_category: "Fabric",
    item_type: "MASTER",
    uom: "meter",
    moq: null,
    unit_price: 20000,
    qty_ordered: 100,
    qty_received: 0,
    subtotal: 2000000,
    notes: null,
    created_at: new Date(),
    updated_at: new Date(),
    po: { id: 1, status: "ORDERED", supplier_id: 1, supplier_name: "PT Supplier ABC" },
};

const mockReceipt = {
    id: 1,
    receipt_number: "RCV-RM-20260509-1234",
    receipt_date: new Date(),
    po_id: null,
    warehouse_id: 3,
    status: "DRAFT",
    total_qty: 50,
    total_amount: 1000000,
    notes: null,
    posted_at: null,
    created_by: userId,
    updated_by: null,
    approved_by: null,
    created_at: new Date(),
    updated_at: new Date(),
    items: [
        {
            id: 100,
            receipt_id: 1,
            po_id: 1,
            po_item_id: 10,
            raw_material_id: 5,
            item_code: "RM001",
            item_name: "Kain Katun",
            uom: "meter",
            qty_received: 50,
            unit_price: 20000,
            amount: 1000000,
            notes: null,
            created_at: new Date(),
        },
    ],
    warehouse: { id: 3 },
};

describe("ReceiptService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("list", () => {
        it("should return paginated receipts", async () => {
            const mockFindMany = vi.fn().mockResolvedValue([mockReceipt]);
            const mockCount = vi.fn().mockResolvedValue(1);
            // @ts-ignore
            prisma.purchaseReceipt = { findMany: mockFindMany, count: mockCount };

            const result = await ReceiptService.list({ page: 1, take: 10, order: "desc" });

            expect(result.data).toHaveLength(1);
            expect(result.total).toBe(1);
            expect(mockFindMany).toHaveBeenCalledOnce();
        });
    });

    describe("create", () => {
        it("should throw if PO item not found", async () => {
            // @ts-ignore
            prisma.purchaseOrderItem = {
                findMany: vi.fn().mockResolvedValue([]),
            };

            await expect(
                ReceiptService.create(
                    { warehouse_id: 3, items: [{ po_id: 1, po_item_id: 999, qty_received: 10 }] },
                    userId,
                )
            ).rejects.toThrow(ApiError);
        });

        it("should throw if qty_received exceeds open qty", async () => {
            // @ts-ignore
            prisma.purchaseOrderItem = {
                findMany: vi.fn().mockResolvedValue([mockPOItem]),
            };

            await expect(
                ReceiptService.create(
                    { warehouse_id: 3, items: [{ po_id: 1, po_item_id: 10, qty_received: 999 }] },
                    userId,
                )
            ).rejects.toThrow(ApiError);
        });

        it("should create receipt successfully", async () => {
            const mockCreated = { ...mockReceipt, items: mockReceipt.items };
            // @ts-ignore
            prisma.purchaseOrderItem = {
                findMany: vi.fn().mockResolvedValue([mockPOItem]),
            };
            // @ts-ignore
            prisma.$transaction = vi.fn().mockImplementation(async (cb) => cb({
                purchaseReceipt: { create: vi.fn().mockResolvedValue(mockCreated) },
            }));

            const result = await ReceiptService.create(
                { warehouse_id: 3, items: [{ po_id: 1, po_item_id: 10, qty_received: 50 }] },
                userId,
            );

            expect(result).toEqual(mockCreated);
        });

        it("should throw if po_item po_id mismatch", async () => {
            const wrongPOItem = { ...mockPOItem, po_id: 99 };
            // @ts-ignore
            prisma.purchaseOrderItem = {
                findMany: vi.fn().mockResolvedValue([wrongPOItem]),
            };

            await expect(
                ReceiptService.create(
                    { warehouse_id: 3, items: [{ po_id: 1, po_item_id: 10, qty_received: 10 }] },
                    userId,
                )
            ).rejects.toThrow(ApiError);
        });

        it("should throw if PO status is not ORDERED", async () => {
            const draftPOItem = { ...mockPOItem, po: { ...mockPOItem.po, status: "DRAFT" } };
            // @ts-ignore
            prisma.purchaseOrderItem = {
                findMany: vi.fn().mockResolvedValue([draftPOItem]),
            };

            await expect(
                ReceiptService.create(
                    { warehouse_id: 3, items: [{ po_id: 1, po_item_id: 10, qty_received: 10 }] },
                    userId,
                )
            ).rejects.toThrow(ApiError);
        });
    });

    describe("post", () => {
        it("should throw if receipt is not DRAFT", async () => {
            const postedReceipt = { ...mockReceipt, status: "POSTED" };
            // @ts-ignore
            prisma.purchaseReceipt = {
                findUniqueOrThrow: vi.fn().mockResolvedValue(postedReceipt),
            };

            await expect(ReceiptService.post(1, userId)).rejects.toThrow(ApiError);
        });

        it("should throw if receipt has no items", async () => {
            const emptyReceipt = { ...mockReceipt, items: [] };
            // @ts-ignore
            prisma.purchaseReceipt = {
                findUniqueOrThrow: vi.fn().mockResolvedValue(emptyReceipt),
            };

            await expect(ReceiptService.post(1, userId)).rejects.toThrow(ApiError);
        });

        it("should post receipt and run atomic operations", async () => {
            const mockPO = {
                id: 1,
                supplier_id: 1,
                supplier_name: "PT Supplier ABC",
                status: "ORDERED",
                items: [{ ...mockPOItem, qty_received: 0 }],
            };

            // @ts-ignore
            prisma.purchaseReceipt = {
                findUniqueOrThrow: vi.fn().mockResolvedValue(mockReceipt),
            };
            // @ts-ignore
            prisma.purchaseOrder = {
                findMany: vi.fn().mockResolvedValue([mockPO]),
            };

            const mockTx = {
                purchaseReceipt: {
                    update: vi.fn().mockResolvedValue({ ...mockReceipt, status: "POSTED" }),
                    findUniqueOrThrow: vi.fn().mockResolvedValue({ ...mockReceipt, status: "POSTED" }),
                },
                purchaseOrderItem: {
                    update: vi.fn().mockResolvedValue({}),
                    findMany: vi.fn().mockResolvedValue([
                        { ...mockPOItem, qty_received: 50 },
                    ]),
                },
                purchaseOrder: { update: vi.fn().mockResolvedValue({}) },
                purchaseTracking: { upsert: vi.fn().mockResolvedValue({}) },
                rawMaterialInventory: {
                    findUnique: vi.fn().mockResolvedValue({ quantity: 200 }),
                    upsert: vi.fn().mockResolvedValue({ id: 1, quantity: 250 }),
                },
                stockMovement: { create: vi.fn().mockResolvedValue({ id: 1 }) },
                accountPayable: { create: vi.fn().mockResolvedValue({ id: 1, ap_number: "AP-001" }) },
            };
            // @ts-ignore
            prisma.$transaction = vi.fn().mockImplementation(async (cb) => cb(mockTx));

            const result = await ReceiptService.post(1, userId);

            expect(mockTx.purchaseReceipt.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ status: "POSTED" }) }),
            );
            expect(mockTx.purchaseOrderItem.update).toHaveBeenCalledOnce();
            expect(mockTx.stockMovement.create).toHaveBeenCalledOnce();
            expect(mockTx.accountPayable.create).toHaveBeenCalledOnce();
        });
    });

    describe("approve", () => {
        it("should throw if receipt is not POSTED", async () => {
            // @ts-ignore
            prisma.purchaseReceipt = {
                findUniqueOrThrow: vi.fn().mockResolvedValue({ ...mockReceipt, status: "DRAFT" }),
            };

            await expect(ReceiptService.approve(1, userId)).rejects.toThrow(ApiError);
        });

        it("should approve a POSTED receipt", async () => {
            const postedReceipt = { ...mockReceipt, status: "POSTED" };
            // @ts-ignore
            prisma.purchaseReceipt = {
                findUniqueOrThrow: vi.fn().mockResolvedValue(postedReceipt),
                update: vi.fn().mockResolvedValue({ ...postedReceipt, status: "APPROVED" }),
            };

            const result = await ReceiptService.approve(1, userId);
            expect(result.status).toBe("APPROVED");
        });
    });

    describe("destroy", () => {
        it("should throw if receipt is not DRAFT", async () => {
            // @ts-ignore
            prisma.purchaseReceipt = {
                findUniqueOrThrow: vi.fn().mockResolvedValue({ ...mockReceipt, status: "POSTED" }),
            };

            await expect(ReceiptService.destroy(1)).rejects.toThrow(ApiError);
        });

        it("should delete a DRAFT receipt", async () => {
            // @ts-ignore
            prisma.purchaseReceipt = {
                findUniqueOrThrow: vi.fn().mockResolvedValue(mockReceipt),
                delete: vi.fn().mockResolvedValue(mockReceipt),
            };

            const result = await ReceiptService.destroy(1);
            expect(result).toEqual(mockReceipt);
        });
    });
});
