import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "../../../../config/prisma.js";
import { RmReceiptService } from "../../../../module/application/manufacturing/inventory/rm-receipt/rm-receipt.service.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { TransferStatus } from "../../../../generated/prisma/enums.js";

// Mocking the prisma service
vi.mock("../../../../config/prisma.js", () => ({
    default: {
        stockTransfer: {
            findMany: vi.fn(),
            count: vi.fn(),
            findUnique: vi.fn(),
            update: vi.fn(),
        },
        stockTransferItem: {
            update: vi.fn(),
        },
        stockTransferPhoto: {
            createMany: vi.fn(),
        },
        $transaction: vi.fn((cb) => cb(prisma)),
    },
}));

describe("RmReceiptService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("list", () => {
        it("should return list of rm receipts", async () => {
            const mockData = [{ id: 1, transfer_number: "TRM-001" }];
            (prisma.stockTransfer.findMany as any).mockResolvedValue(mockData);
            (prisma.stockTransfer.count as any).mockResolvedValue(1);

            const result = await RmReceiptService.list({ page: 1, take: 10 });

            expect(result.data).toEqual(mockData);
            expect(result.total).toBe(1);
            expect(prisma.stockTransfer.findMany).toHaveBeenCalled();
        });
    });

    describe("detail", () => {
        it("should return detail of rm receipt", async () => {
            const mockData = { id: 1, transfer_number: "TRM-001" };
            (prisma.stockTransfer.findUnique as any).mockResolvedValue(mockData);

            const result = await RmReceiptService.detail(1);

            expect(result).toEqual(mockData);
            expect(prisma.stockTransfer.findUnique).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 1 }
            }));
        });

        it("should throw 404 if not found", async () => {
            (prisma.stockTransfer.findUnique as any).mockResolvedValue(null);

            await expect(RmReceiptService.detail(999)).rejects.toThrow(ApiError);
            await expect(RmReceiptService.detail(999)).rejects.toThrow("Data Penerimaan RM tidak ditemukan");
        });
    });

    describe("updateItems", () => {
        it("should update quantity requested if status is PENDING", async () => {
            const mockTransfer = {
                id: 1,
                status: TransferStatus.PENDING,
                items: [{ id: 10, quantity_requested: 100 }]
            };
            (prisma.stockTransfer.findUnique as any).mockResolvedValue(mockTransfer);
            (prisma.stockTransferItem.update as any).mockResolvedValue({});

            const payload = {
                items: [{ id: 10, quantity_requested: 150 }]
            };

            await RmReceiptService.updateItems(1, payload, "user-1");

            expect(prisma.stockTransferItem.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 10 },
                data: { quantity_requested: 150 }
            }));
        });

        it("should throw 400 if status is NOT PENDING", async () => {
            const mockTransfer = {
                id: 1,
                status: TransferStatus.COMPLETED,
                items: []
            };
            (prisma.stockTransfer.findUnique as any).mockResolvedValue(mockTransfer);

            const payload = { items: [] };

            await expect(RmReceiptService.updateItems(1, payload, "user-1")).rejects.toThrow(ApiError);
            await expect(RmReceiptService.updateItems(1, payload, "user-1")).rejects.toThrow("Hanya draf transfer (PENDING) yang dapat diubah kuantitasnya");
        });
    });

    describe("updateStatus", () => {
        beforeEach(() => {
            vi.mock("../../../../module/application/inventory-v2/inventory.helper.js", () => ({
                InventoryHelper: {
                    deductWarehouseStock: vi.fn().mockResolvedValue({}),
                    addWarehouseStock: vi.fn().mockResolvedValue({}),
                }
            }));
        });

        it("should approve a pending transfer", async () => {
            const mockTransfer = {
                id: 1,
                status: TransferStatus.PENDING,
                production_order_id: 100,
                items: []
            };
            (prisma.stockTransfer.findUnique as any).mockResolvedValue(mockTransfer);
            (prisma.stockTransfer.update as any).mockResolvedValue({ ...mockTransfer, status: TransferStatus.APPROVED });

            const result = await RmReceiptService.updateStatus(1, { status: TransferStatus.APPROVED }, "user-1");

            expect(result.status).toBe(TransferStatus.APPROVED);
            expect(prisma.stockTransfer.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 1 },
                data: expect.objectContaining({ status: TransferStatus.APPROVED })
            }));
        });

        it("should handle shipment (deduct stock)", async () => {
             const mockTransfer = {
                id: 1,
                status: TransferStatus.APPROVED,
                production_order_id: 100,
                from_warehouse_id: 1,
                items: [{ id: 10, raw_material_id: 5, quantity_requested: 100 }]
            };
            (prisma.stockTransfer.findUnique as any).mockResolvedValue(mockTransfer);
            (prisma.stockTransfer.update as any).mockResolvedValue({ ...mockTransfer, status: TransferStatus.SHIPMENT });

            const payload = { 
                status: TransferStatus.SHIPMENT, 
                items: [{ id: 10, quantity_packed: 100 }] 
            };
            const result = await RmReceiptService.updateStatus(1, payload, "user-1");

            expect(result.status).toBe(TransferStatus.SHIPMENT);
            expect(prisma.stockTransfer.update).toHaveBeenCalled();
        });

        it("should handle fulfillment and determine final status (COMPLETED/PARTIAL)", async () => {
            const mockTransfer = {
                id: 1,
                status: TransferStatus.RECEIVED,
                production_order_id: 100,
                to_warehouse_id: 2,
                items: [{ id: 10, raw_material_id: 5, quantity_packed: 100 }]
            };
            (prisma.stockTransfer.findUnique as any).mockResolvedValue(mockTransfer);
            
            // Full fulfillment
            const payloadFull = {
                status: TransferStatus.FULFILLMENT,
                items: [{ id: 10, quantity_fulfilled: 100, quantity_missing: 0, quantity_rejected: 0 }]
            };
            (prisma.stockTransfer.update as any).mockResolvedValue({ ...mockTransfer, status: TransferStatus.COMPLETED });
            const resultFull = await RmReceiptService.updateStatus(1, payloadFull, "user-1");
            expect(resultFull.status).toBe(TransferStatus.COMPLETED);

            // Partial fulfillment
            const payloadPartial = {
                status: TransferStatus.FULFILLMENT,
                items: [{ id: 10, quantity_fulfilled: 90, quantity_missing: 5, quantity_rejected: 5 }]
            };
            (prisma.stockTransfer.update as any).mockResolvedValue({ ...mockTransfer, status: TransferStatus.PARTIAL });
            const resultPartial = await RmReceiptService.updateStatus(1, payloadPartial, "user-1");
            expect(resultPartial.status).toBe(TransferStatus.PARTIAL);
        });
    });
});
