import { describe, it, expect, vi, beforeEach } from "vitest";
import { GoodsReceiptService } from "../../../module/application/inventory-v2/gr/gr.service.js";
import { GoodsReceiptStatus, GoodsReceiptType } from "../../../generated/prisma/enums.js";
import prisma from "../../../config/prisma.js";
import { RequestGoodsReceiptDTO } from "../../../module/application/inventory-v2/gr/gr.schema.js";
import { ReturnService } from "../../../module/application/inventory-v2/return/return.service.js";

vi.mock("../../../config/prisma.js", () => {
    const mockPrisma = {
        $transaction: vi.fn(),
        goodsReceipt: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), update: vi.fn() },
        goodsReceiptItem: { update: vi.fn() },
        productInventory: { findMany: vi.fn(), update: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
        rawMaterialInventory: { findMany: vi.fn(), update: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
        stockMovement: { create: vi.fn() },
        warehouse: { findUnique: vi.fn(), findFirst: vi.fn() },
        stockTransfer: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), update: vi.fn() },
    };
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        if (Array.isArray(cb)) return Promise.all(cb);
        return cb(mockPrisma);
    });
    return { default: mockPrisma };
});

describe("GoodsReceiptService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (prisma.productInventory.findMany as any).mockResolvedValue([{ id: 1, quantity: 100 }]);
    });

    describe("create", () => {
        it("should create a new goods receipt correctly", async () => {
            const payload: RequestGoodsReceiptDTO = {
                type: GoodsReceiptType.MANUAL,
                warehouse_id: 1,
                notes: "Test GR",
                items: [
                    {
                        product_id: 1,
                        quantity_planned: 100,
                        quantity_actual: 100,
                        notes: "Item note"
                    }
                ]
            };
            const mockGR = { id: 1, gr_number: "GR-001", status: GoodsReceiptStatus.PENDING, type: GoodsReceiptType.MANUAL, warehouse_id: 1, items: [] };
            (prisma.goodsReceipt.create as any).mockResolvedValue(mockGR);

            const result = await GoodsReceiptService.create(payload, "tester");
            expect(result).toBeDefined();
            expect(result.id).toBe(1);
            expect(prisma.goodsReceipt.create).toHaveBeenCalled();
        });
    });

    describe("post", () => {
        it("should post a goods receipt and update inventory", async () => {
            const mockGR = { id: 1, gr_number: "GR-001", status: GoodsReceiptStatus.PENDING, type: GoodsReceiptType.MANUAL, warehouse_id: 1, items: [{ product_id: 1, quantity: 10 }] };
            (prisma.goodsReceipt.findUnique as any).mockResolvedValue(mockGR);
            (prisma.goodsReceipt.update as any).mockResolvedValue({ ...mockGR, status: GoodsReceiptStatus.COMPLETED });

            const result = await GoodsReceiptService.post(1, "tester");
            expect(result.status).toBe(GoodsReceiptStatus.COMPLETED);
            expect(prisma.productInventory.update).toHaveBeenCalled();
        });

        it("should post a goods receipt and trigger Return creation if needed", async () => {
            const mockGR = { 
                id: 1, 
                gr_number: "GR-001", 
                status: GoodsReceiptStatus.PENDING, 
                type: GoodsReceiptType.MANUAL, 
                warehouse_id: 1, 
                items: [{ id: 10, product_id: 1, quantity: 10, quantity_rejected: 3, quantity_accepted: 7 }] 
            };
            (prisma.goodsReceipt.findUnique as any).mockResolvedValue(mockGR);
            (prisma.goodsReceipt.update as any).mockResolvedValue({ ...mockGR, status: GoodsReceiptStatus.COMPLETED });

            const spyReturn = vi.spyOn(ReturnService, "createFromRejection").mockResolvedValue({ id: 25, return_number: "RTN-GR-001" } as any);

            const result = await GoodsReceiptService.post(1, "tester");
            expect(result.status).toBe(GoodsReceiptStatus.COMPLETED);
            expect(spyReturn).toHaveBeenCalled();
            expect(result.created_return).toBeDefined();
        });

        it("should throw error if GR not found", async () => {
            (prisma.goodsReceipt.findUnique as any).mockResolvedValueOnce(null);

            await expect(GoodsReceiptService.post(999)).rejects.toThrow("Data Goods Receipt tidak ditemukan");
        });
    });

    describe("list", () => {
        it("should return data and length", async () => {
            (prisma.goodsReceipt.findMany as any).mockResolvedValueOnce([]);
            (prisma.goodsReceipt.count as any).mockResolvedValueOnce(0);

            const result = await GoodsReceiptService.list({ page: 1, take: 10 });

            expect(result.data).toBeInstanceOf(Array);
            expect(result.len).toBe(0);
        });
    });
});
