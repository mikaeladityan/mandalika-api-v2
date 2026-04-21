import { describe, it, expect, vi, beforeEach } from "vitest";
import { DOService } from "../../../module/application/inventory-v2/do/do.service.js";
import { TransferStatus, TransferLocationType } from "../../../generated/prisma/enums.js";
import prisma from "../../../config/prisma.js";
import { ReturnService } from "../../../module/application/inventory-v2/return/return.service.js";

vi.mock("../../../config/prisma.js", () => ({
    default: {
        $transaction: vi.fn(),
        stockTransfer: {
            create: vi.fn(),
            findUnique: vi.fn(),
            findMany: vi.fn(),
            count: vi.fn(),
            update: vi.fn(),
        },
        stockTransferItem: {
            update: vi.fn(),
        },
        stockTransferPhoto: {
            createMany: vi.fn(),
        },
        productInventory: {
            findFirst: vi.fn(),
            update: vi.fn(),
            create: vi.fn(),
            findMany: vi.fn(),
        },
        rawMaterialInventory: {
            findFirst: vi.fn(),
            update: vi.fn(),
            create: vi.fn(),
            findMany: vi.fn(),
        },
        outletInventory: {
            findUnique: vi.fn(),
            update: vi.fn(),
            create: vi.fn(),
            findMany: vi.fn(),
        },
        stockMovement: {
            create: vi.fn(),
        },
        warehouse: {
            findUnique: vi.fn(),
            findFirst: vi.fn(),
        },
        outlet: {
            findUnique: vi.fn(),
            findFirst: vi.fn(),
        }
    },
}));

describe("DOService - Extended Testing", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        (prisma.$transaction as any).mockImplementation(async (callback: any) => {
            if (Array.isArray(callback)) return Promise.all(callback);
            return callback(prisma);
        });
        (prisma.productInventory.findMany as any).mockResolvedValue([]);
        (prisma.outletInventory.findMany as any).mockResolvedValue([]);
        (prisma.stockTransferItem.update as any).mockResolvedValue({});
    });

    const mockDO = {
        id: 1,
        transfer_number: "DO-202603-001",
        status: TransferStatus.PENDING,
        from_type: TransferLocationType.WAREHOUSE,
        from_warehouse_id: 1,
        to_type: TransferLocationType.OUTLET,
        to_outlet_id: 2,
        items: [{ id: 10, product_id: 1, quantity_requested: 10 }]
    };

    describe("create", () => {
        it("should create a new delivery order", async () => {
            (prisma.stockTransfer.create as any).mockResolvedValueOnce(mockDO);
            const payload = {
                date: "2027-01-01",
                from_warehouse_id: 1,
                to_outlet_id: 2,
                items: [{ product_id: 1, quantity_requested: 10 }]
            };
            const result = await DOService.create(payload, "tester");
            expect(result).toBeDefined();
            expect(prisma.stockTransfer.create).toHaveBeenCalled();
        });
    });

    describe("updateStatus Lifecycle", () => {
        it("should handle APPROVED transition from PENDING", async () => {
            (prisma.stockTransfer.findUnique as any).mockResolvedValueOnce(mockDO);
            (prisma.stockTransfer.update as any).mockResolvedValueOnce({ ...mockDO, status: TransferStatus.APPROVED });
            const result = await DOService.updateStatus(1, { status: TransferStatus.APPROVED }, "tester");
            expect(result.status).toBe(TransferStatus.APPROVED);
        });

        it("should handle SHIPMENT transition from APPROVED", async () => {
            (prisma.productInventory.findMany as any).mockResolvedValue([{ quantity: 100 }]); // provide stock info for InventoryHelper
            (prisma.stockTransfer.findUnique as any).mockResolvedValue({ ...mockDO, status: TransferStatus.APPROVED });
            (prisma.productInventory.findFirst as any).mockResolvedValue({ id: 1, quantity: 100 });
            (prisma.stockTransferItem.update as any).mockResolvedValue({});
            (prisma.stockTransfer.update as any).mockResolvedValue({ ...mockDO, status: TransferStatus.SHIPMENT });

            const result = await DOService.updateStatus(1, { status: TransferStatus.SHIPMENT }, "tester");
            expect(result.status).toBe(TransferStatus.SHIPMENT);
        });

        it("should handle RECEIVED transition from SHIPMENT", async () => {
            (prisma.stockTransfer.findUnique as any).mockResolvedValueOnce({ ...mockDO, status: TransferStatus.SHIPMENT });
            (prisma.stockTransferItem.update as any).mockResolvedValue({});
            (prisma.stockTransfer.update as any).mockResolvedValueOnce({ ...mockDO, status: TransferStatus.RECEIVED });

            const result = await DOService.updateStatus(1, { status: TransferStatus.RECEIVED }, "tester");
            expect(result.status).toBe(TransferStatus.RECEIVED);
        });

        it("should handle FULFILLMENT transition (COMPLETED if perfect)", async () => {
            (prisma.productInventory.findMany as any).mockResolvedValue([]);
            (prisma.outletInventory.findMany as any).mockResolvedValue([]);
            (prisma.stockTransfer.findUnique as any).mockResolvedValue({ ...mockDO, status: TransferStatus.RECEIVED });
            (prisma.outletInventory.findUnique as any).mockResolvedValue(null);
            (prisma.stockTransferItem.update as any).mockResolvedValue({});
            (prisma.stockTransfer.update as any).mockResolvedValue({ ...mockDO, status: TransferStatus.COMPLETED });

            const result = await DOService.updateStatus(1, { 
                status: TransferStatus.FULFILLMENT,
                items: [{ id: 10, quantity_fulfilled: 10, quantity_missing: 0, quantity_rejected: 0 }]
            }, "tester");
            expect(result.status).toBe(TransferStatus.COMPLETED);
        });

        it("should handle FULFILLMENT and trigger Return if items are REJECTED", async () => {
            (prisma.productInventory.findMany as any).mockResolvedValue([]);
            (prisma.outletInventory.findMany as any).mockResolvedValue([]);
            (prisma.stockTransfer.findUnique as any).mockResolvedValue({ ...mockDO, status: TransferStatus.RECEIVED });
            (prisma.stockTransferItem.update as any).mockResolvedValue({});
            (prisma.stockTransfer.update as any).mockResolvedValue({ ...mockDO, status: TransferStatus.COMPLETED });

            // Mock ReturnService
            const spyReturn = vi.spyOn(ReturnService, "createFromRejection").mockResolvedValue({ id: 20, return_number: "RTN-DO-001" } as any);

            const result = await DOService.updateStatus(1, { 
                status: TransferStatus.FULFILLMENT,
                items: [{ id: 10, quantity_fulfilled: 8, quantity_missing: 0, quantity_rejected: 2 }]
            }, "tester");

            expect(result.status).toBe(TransferStatus.COMPLETED);
            expect(spyReturn).toHaveBeenCalled();
            expect(result.created_return).toBeDefined();
        });

        it("should throw error if attempting to update COMPLETED DO", async () => {
            (prisma.stockTransfer.findUnique as any).mockResolvedValueOnce({ ...mockDO, status: TransferStatus.COMPLETED });
            await expect(DOService.updateStatus(1, { status: TransferStatus.RECEIVED })).rejects.toThrow("Tidak dapat memperbarui transfer dengan status COMPLETED");
        });
    });

    describe("detail", () => {
        it("should throw error if not found", async () => {
            (prisma.stockTransfer.findUnique as any).mockResolvedValueOnce(null);
            await expect(DOService.detail(999)).rejects.toThrow("Data Delivery Order tidak ditemukan");
        });
    });
});
