import { describe, it, expect, vi, beforeEach } from "vitest";
import { GoodsReceiptService } from "../../../module/application/inventory-v2/gr/gr.service.js";
import { GoodsReceiptStatus, GoodsReceiptType } from "../../../generated/prisma/enums.js";
import prisma from "../../../config/prisma.js";
import { RequestGoodsReceiptDTO } from "../../../module/application/inventory-v2/gr/gr.schema.js";

describe("GoodsReceiptService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // @ts-ignore
        prisma.$transaction.mockImplementation(async (callback) => {
            if (Array.isArray(callback)) {
                return Promise.all(callback);
            }
            return callback(prisma);
        });
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

            const result = await GoodsReceiptService.create(payload, "test@example.com");

            expect(result).toBeDefined();
            expect(prisma.goodsReceipt.create).toHaveBeenCalled();
        });
    });

    describe("post", () => {
        it("should post a goods receipt and update inventory", async () => {
            (prisma.goodsReceipt.findUnique as any).mockResolvedValueOnce({
                id: 1,
                status: GoodsReceiptStatus.PENDING,
                warehouse_id: 1,
                items: [
                    {
                        product_id: 1,
                        quantity_actual: 50
                    }
                ]
            });

             // Mock update result
            (prisma.goodsReceipt.update as any).mockResolvedValueOnce({
                id: 1,
                status: GoodsReceiptStatus.COMPLETED
            });

            const result = await GoodsReceiptService.post(1, "test@example.com");

            expect(result).toBeDefined();
            expect(result.status).toBe(GoodsReceiptStatus.COMPLETED);
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
