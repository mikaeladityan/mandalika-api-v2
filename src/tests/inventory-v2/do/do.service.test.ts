import { describe, it, expect, vi, beforeEach } from "vitest";
import { DOService } from "../../../module/application/inventory-v2/do/do.service.js";
import { TransferStatus, TransferLocationType } from "../../../generated/prisma/enums.js";
import prisma from "../../../config/prisma.js";
import { RequestDeliveryOrderDTO } from "../../../module/application/inventory-v2/do/do.schema.js";

describe("DOService - Extended Testing", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // @ts-ignore
        prisma.$transaction.mockImplementation(async (callback) => {
            if (Array.isArray(callback)) return Promise.all(callback);
            return callback(prisma);
        });
    });

    describe("create", () => {
        it("should create a new delivery order with DO prefix", async () => {
            const payload: RequestDeliveryOrderDTO = {
                barcode: "DO-UNIQUE-001",
                from_warehouse_id: 1,
                to_outlet_id: 2,
                items: [{ product_id: 1, quantity_requested: 10 }]
            };
            (prisma.stockTransfer.findUnique as any).mockResolvedValueOnce(null);
            const result = await DOService.create(payload, "tester");
            expect(result).toBeDefined();
            expect(prisma.stockTransfer.create).toHaveBeenCalled();
        });
    });

    describe("list", () => {
        it("should return paginated and filtered DO list", async () => {
            (prisma.stockTransfer.findMany as any).mockResolvedValueOnce([]);
            (prisma.stockTransfer.count as any).mockResolvedValueOnce(0);
            const result = await DOService.list({ page: 1, take: 5, status: TransferStatus.PENDING });
            expect(result.data).toBeInstanceOf(Array);
            expect(result.len).toBe(0);
        });
    });

    describe("updateStatus Lifecycle", () => {
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

        it("should handle SHIPMENT transition with stock deduction", async () => {
            (prisma.stockTransfer.findUnique as any).mockResolvedValueOnce(mockDO);
            (prisma.productInventory.findFirst as any).mockResolvedValueOnce({ id: 1, quantity: 100 });
            (prisma.stockTransfer.update as any).mockResolvedValueOnce({ ...mockDO, status: TransferStatus.SHIPMENT });

            const result = await DOService.updateStatus(1, { status: TransferStatus.SHIPMENT }, "tester");
            expect(result.status).toBe(TransferStatus.SHIPMENT);
            expect(prisma.productInventory.update).toHaveBeenCalled();
        });

        it("should handle RECEIVED transition at outlet", async () => {
            (prisma.stockTransfer.findUnique as any).mockResolvedValueOnce({ ...mockDO, status: TransferStatus.SHIPMENT });
            (prisma.stockTransfer.update as any).mockResolvedValueOnce({ ...mockDO, status: TransferStatus.RECEIVED });

            const result = await DOService.updateStatus(1, { status: TransferStatus.RECEIVED }, "tester");
            expect(result.status).toBe(TransferStatus.RECEIVED);
        });

        it("should handle FULFILLMENT with COMPLETED status for perfect match", async () => {
            (prisma.stockTransfer.findUnique as any).mockResolvedValueOnce({ ...mockDO, status: TransferStatus.RECEIVED });
            (prisma.outletInventory.findUnique as any).mockResolvedValueOnce(null);
            (prisma.stockTransfer.update as any).mockResolvedValueOnce({ ...mockDO, status: TransferStatus.COMPLETED });

            const payload = {
                status: TransferStatus.FULFILLMENT,
                items: [{ id: 10, quantity_fulfilled: 10, quantity_missing: 0, quantity_rejected: 0 }]
            };

            const result = await DOService.updateStatus(1, payload, "tester");
            expect(result.status).toBe(TransferStatus.COMPLETED);
            expect(prisma.outletInventory.create).toHaveBeenCalled();
        });

        it("should handle FULFILLMENT with PARTIAL status if there are missing items", async () => {
            (prisma.stockTransfer.findUnique as any).mockResolvedValueOnce({ ...mockDO, status: TransferStatus.RECEIVED });
            (prisma.outletInventory.findUnique as any).mockResolvedValueOnce(null);
            (prisma.stockTransfer.update as any).mockResolvedValueOnce({ ...mockDO, status: TransferStatus.PARTIAL });

            const payload = {
                status: TransferStatus.FULFILLMENT,
                items: [{ id: 10, quantity_fulfilled: 8, quantity_missing: 2, quantity_rejected: 0 }]
            };

            const result = await DOService.updateStatus(1, payload, "tester");
            expect(result.status).toBe(TransferStatus.PARTIAL);
        });

        it("should throw error if attempting to update COMPLETED DO", async () => {
            (prisma.stockTransfer.findUnique as any).mockResolvedValueOnce({ ...mockDO, status: TransferStatus.COMPLETED });
            await expect(DOService.updateStatus(1, { status: TransferStatus.RECEIVED })).rejects.toThrow("Tidak dapat memperbarui transfer dengan status COMPLETED");
        });

        it("should throw error if transfer is NOT Warehouse-to-Outlet", async () => {
            (prisma.stockTransfer.findUnique as any).mockResolvedValueOnce({ ...mockDO, from_type: TransferLocationType.OUTLET });
            await expect(DOService.updateStatus(1, { status: TransferStatus.RECEIVED })).rejects.toThrow("Tipe data tidak valid untuk pembaruan status DO.");
        });
    });

    describe("detail", () => {
        it("should throw Indonesian error if not found", async () => {
            (prisma.stockTransfer.findUnique as any).mockResolvedValueOnce(null);
            await expect(DOService.detail(999)).rejects.toThrow("Data Delivery Order tidak ditemukan");
        });
    });
});
