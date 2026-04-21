import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "../../../../config/prisma.js";
import { RmTransferService } from "../../../../module/application/manufacturing/inventory/rm-transfer/rm-transfer.service.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { TransferStatus, TransferLocationType } from "../../../../generated/prisma/enums.js";

// Mocking the prisma service
vi.mock("../../../../config/prisma.js", () => {
    const mockPrisma = {
        $transaction: vi.fn(),
        stockTransfer: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), update: vi.fn() },
        stockTransferItem: { update: vi.fn() },
        rawMaterialInventory: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
        productInventory: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
        stockMovement: { create: vi.fn() },
    };
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        if (Array.isArray(cb)) return Promise.all(cb);
        return cb(mockPrisma);
    });
    return { default: mockPrisma };
});

describe("RmTransferService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (prisma.rawMaterialInventory.findFirst as any).mockResolvedValue({ id: 1, month: 1, year: 2026 });
        (prisma.rawMaterialInventory.findMany as any).mockResolvedValue([{ id: 1, quantity: 100 }]);
        (prisma.productInventory.findMany as any).mockResolvedValue([{ id: 1, quantity: 100 }]);
    });

    describe("create", () => {
        it("should create a manual transfer", async () => {
            const payload = {
                date: new Date().toISOString(),
                from_warehouse_id: 1,
                to_warehouse_id: 2,
                notes: "Manual transfer test",
                items: [
                    { raw_material_id: 5, quantity_requested: 10, notes: "Item note" }
                ]
            };

            const mockCreated = { id: 1, ...payload };
            (prisma.stockTransfer.create as any).mockResolvedValue(mockCreated);

            const result = await RmTransferService.create(payload, "user-1");

            expect(result).toEqual(mockCreated);
            expect(prisma.stockTransfer.create).toHaveBeenCalled();
            const lastCall = (prisma.stockTransfer.create as any).mock.calls[0][0];
            expect(lastCall.data.from_warehouse_id).toBe(1);
            expect(lastCall.data.to_warehouse_id).toBe(2);
            expect(lastCall.data.production_order_id).toBeFalsy();
        });

        it("should throw error if same warehouse", async () => {
             const payload = {
                date: new Date().toISOString(),
                from_warehouse_id: 1,
                to_warehouse_id: 1,
                items: [{ raw_material_id: 5, quantity_requested: 10 }]
            };

            await expect(RmTransferService.create(payload)).rejects.toThrow(ApiError);
            await expect(RmTransferService.create(payload)).rejects.toThrow("Gudang asal dan tujuan tidak boleh sama.");
        });
    });

    describe("updateStatus", () => {
        it("should approve a pending transfer", async () => {
            const mockTransfer = {
                id: 1,
                status: TransferStatus.PENDING,
                items: []
            };
            (prisma.stockTransfer.findUnique as any).mockResolvedValue(mockTransfer);
            (prisma.stockTransfer.update as any).mockResolvedValue({ ...mockTransfer, status: TransferStatus.APPROVED });

            const result = await RmTransferService.updateStatus(1, { status: TransferStatus.APPROVED }, "user-1");

            expect(result.status).toBe(TransferStatus.APPROVED);
        });

        it("should handle shipment and deduct stock", async () => {
            const mockTransfer = {
                id: 1,
                status: TransferStatus.APPROVED,
                from_warehouse_id: 1,
                items: [
                    { id: 10, raw_material_id: 5, quantity_requested: 100 }
                ]
            };
            (prisma.stockTransfer.findUnique as any).mockResolvedValue(mockTransfer);
            (prisma.stockTransfer.update as any).mockResolvedValue({ ...mockTransfer, status: TransferStatus.SHIPMENT });

            const payload = {
                status: TransferStatus.SHIPMENT,
                items: [{ id: 10, quantity_packed: 100 }]
            };

            const result = await RmTransferService.updateStatus(1, payload, "user-1");

            expect(result.status).toBe(TransferStatus.SHIPMENT);
        });

        it("should handle fulfillment and add stock", async () => {
            const mockTransfer = {
                id: 1,
                status: TransferStatus.RECEIVED,
                to_warehouse_id: 2,
                items: [
                    { id: 10, raw_material_id: 5, quantity_packed: 100, quantity_requested: 100 }
                ]
            };
            (prisma.stockTransfer.findUnique as any).mockResolvedValue(mockTransfer);
            (prisma.stockTransfer.update as any).mockResolvedValue({ ...mockTransfer, status: TransferStatus.COMPLETED });

            const payload = {
                status: TransferStatus.FULFILLMENT,
                items: [{ id: 10, quantity_fulfilled: 100, quantity_missing: 0, quantity_rejected: 0 }]
            };

            const result = await RmTransferService.updateStatus(1, payload, "user-1");

            expect(result.status).toBe(TransferStatus.COMPLETED);
        });
    });
});
