import { describe, it, expect, vi, beforeEach } from "vitest";
import { TGService } from "../../../module/application/inventory-v2/tg/tg.service.js";
import { TransferStatus, TransferLocationType, TransferPhotoStage } from "../../../generated/prisma/enums.js";
import prisma from "../../../config/prisma.js";
import { ReturnService } from "../../../module/application/inventory-v2/return/return.service.js";

vi.mock("../../../config/prisma.js", () => {
    const mockPrisma = {
        $transaction: vi.fn(),
        stockTransfer: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), update: vi.fn() },
        stockTransferItem: { update: vi.fn() },
        stockTransferPhoto: { createMany: vi.fn() },
        productInventory: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn(), findMany: vi.fn() },
        rawMaterialInventory: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn(), findMany: vi.fn() },
        stockMovement: { create: vi.fn() },
        warehouse: { findUnique: vi.fn(), findFirst: vi.fn() },
        goodsReceipt: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), update: vi.fn() },
    };
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        if (Array.isArray(cb)) return Promise.all(cb);
        return cb(mockPrisma);
    });
    return { default: mockPrisma };
});

describe("TGService - Unit Testing", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (prisma.productInventory.findMany as any).mockResolvedValue([{ id: 1, quantity: 100 }]); // Include ID
        (prisma.stockTransferItem.update as any).mockResolvedValue({});
    });

    const mockTG = {
        id: 1,
        transfer_number: "TG-202604-0001",
        barcode: "TG123456789012",
        status: TransferStatus.PENDING,
        from_type: TransferLocationType.WAREHOUSE,
        from_warehouse_id: 1,
        to_type: TransferLocationType.WAREHOUSE,
        to_warehouse_id: 2,
        items: [{ id: 10, product_id: 1, quantity_requested: 10 }]
    };

    describe("create", () => {
        it("should create a new transfer gudang", async () => {
            (prisma.stockTransfer.create as any).mockResolvedValueOnce(mockTG);
            const payload = {
                date: "2027-01-01",
                from_warehouse_id: 1,
                to_warehouse_id: 2,
                items: [{ product_id: 1, quantity_requested: 10 }]
            };
            const result = await TGService.create(payload, "tester");
            expect(result).toBeDefined();
            expect(prisma.stockTransfer.create).toHaveBeenCalled();
            expect(result.transfer_number).toBe(mockTG.transfer_number);
        });

        it("should throw error if from and to warehouse are the same", async () => {
            const payload = {
                date: "2027-01-01",
                from_warehouse_id: 1,
                to_warehouse_id: 1,
                items: [{ product_id: 1, quantity_requested: 10 }]
            };
            await expect(TGService.create(payload, "tester")).rejects.toThrow("Gudang asal dan tujuan tidak boleh sama.");
        });
    });

    describe("updateStatus Lifecycle", () => {
        it("should handle APPROVED transition from PENDING", async () => {
            (prisma.stockTransfer.findUnique as any).mockResolvedValueOnce(mockTG);
            (prisma.stockTransfer.update as any).mockResolvedValueOnce({ ...mockTG, status: TransferStatus.APPROVED });
            
            const result = await TGService.updateStatus(1, { status: TransferStatus.APPROVED }, "tester");
            expect(result.status).toBe(TransferStatus.APPROVED);
        });

        it("should handle SHIPMENT transition from APPROVED and deduct inventory", async () => {
            (prisma.productInventory.findMany as any).mockResolvedValue([{ id: 100, quantity: 50 }]); // Match ID 100
            (prisma.stockTransfer.findUnique as any).mockResolvedValue({ ...mockTG, status: TransferStatus.APPROVED });
            (prisma.productInventory.findFirst as any).mockResolvedValue({ id: 100, quantity: 50 });
            (prisma.stockTransferItem.update as any).mockResolvedValue({});
            (prisma.stockTransfer.update as any).mockResolvedValue({ ...mockTG, status: TransferStatus.SHIPMENT });

            const result = await TGService.updateStatus(1, { 
                status: TransferStatus.SHIPMENT,
                notes: "Sending now",
                photos: ["url1"]
            }, "tester");

            expect(result.status).toBe(TransferStatus.SHIPMENT);
            expect(prisma.productInventory.update).toHaveBeenCalledWith({
                where: { id: 100 },
                data: { quantity: 40, date: 1 }
            });
            expect(prisma.stockMovement.create).toHaveBeenCalled();
        });

        it("should handle RECEIVED transition from SHIPMENT", async () => {
            (prisma.productInventory.findMany as any).mockResolvedValue([]);
            (prisma.stockTransfer.findUnique as any).mockResolvedValue({ ...mockTG, status: TransferStatus.SHIPMENT });
            (prisma.stockTransferItem.update as any).mockResolvedValue({});
            (prisma.stockTransfer.update as any).mockResolvedValue({ ...mockTG, status: TransferStatus.RECEIVED });

            const result = await TGService.updateStatus(1, { 
                status: TransferStatus.RECEIVED,
                items: [{ id: 10, quantity_received: 10 }]
            }, "tester");

            expect(result.status).toBe(TransferStatus.RECEIVED);
        });

        it("should handle FULFILLMENT transition (COMPLETED) and add inventory to target", async () => {
            const mockTGWithPacked = {
                ...mockTG,
                items: [{ ...mockTG.items[0], quantity_packed: 10 }]
            };
            (prisma.productInventory.findMany as any).mockResolvedValue([{ id: 200, quantity: 5 }]); // Match the ID used in assertion
            (prisma.productInventory.findFirst as any).mockResolvedValue({ id: 200, quantity: 5 });
            (prisma.stockTransfer.findUnique as any).mockResolvedValue({ ...mockTGWithPacked, status: TransferStatus.RECEIVED });
            (prisma.stockTransferItem.update as any).mockResolvedValue({});
            (prisma.stockTransfer.update as any).mockResolvedValue({ ...mockTGWithPacked, status: TransferStatus.COMPLETED });

            const result = await TGService.updateStatus(1, { 
                status: TransferStatus.FULFILLMENT,
                items: [{ id: 10, quantity_fulfilled: 10, quantity_missing: 0, quantity_rejected: 0 }]
            }, "tester");

            expect(result.status).toBe(TransferStatus.COMPLETED);
            expect(prisma.productInventory.update).toHaveBeenCalledWith({
                where: { id: 200 },
                data: { quantity: 15, date: 1 }
            });
        });

        it("should handle FULFILLMENT and trigger Return if items are REJECTED", async () => {
            const mockTGWithPacked = {
                ...mockTG,
                items: [{ ...mockTG.items[0], quantity_packed: 10 }]
            };
            (prisma.productInventory.findMany as any).mockResolvedValue([]);
            (prisma.stockTransfer.findUnique as any).mockResolvedValue({ ...mockTGWithPacked, status: TransferStatus.RECEIVED });
            (prisma.productInventory.findFirst as any).mockResolvedValue({ id: 200, quantity: 5 });
            (prisma.stockTransferItem.update as any).mockResolvedValue({});
            (prisma.stockTransfer.update as any).mockResolvedValue({ ...mockTGWithPacked, status: TransferStatus.COMPLETED });

            // Mock ReturnService
            const spyReturn = vi.spyOn(ReturnService, "createFromRejection").mockResolvedValue({ id: 25, return_number: "RTN-TG-001" } as any);

            const result = await TGService.updateStatus(1, { 
                status: TransferStatus.FULFILLMENT,
                items: [{ id: 10, quantity_fulfilled: 7, quantity_missing: 0, quantity_rejected: 3 }]
            }, "tester");

            expect(result.status).toBe(TransferStatus.COMPLETED);
            expect(spyReturn).toHaveBeenCalled();
            expect(result.created_return).toBeDefined();
        });
    });

    describe("list and detail", () => {
        it("should list data with warehouse filter", async () => {
            (prisma.stockTransfer.findMany as any).mockResolvedValueOnce([mockTG]);
            (prisma.stockTransfer.count as any).mockResolvedValueOnce(1);

            const result = await TGService.list({ from_warehouse_id: 1 });
            expect(result.data).toHaveLength(1);
            expect(result.len).toBe(1);
        });

        it("should throw error if detail not found", async () => {
            (prisma.stockTransfer.findUnique as any).mockResolvedValueOnce(null);
            await expect(TGService.detail(999)).rejects.toThrow("Data Transfer Gudang tidak ditemukan");
        });

        it("should throw error if detail is not a TG (mismatched type)", async () => {
            (prisma.stockTransfer.findUnique as any).mockResolvedValueOnce({ 
                ...mockTG, 
                from_type: TransferLocationType.WAREHOUSE,
                to_type: TransferLocationType.OUTLET 
            });
            await expect(TGService.detail(1)).rejects.toThrow("Akses ditolak: Data ini bukan merupakan Transfer Gudang.");
        });
    });
});
