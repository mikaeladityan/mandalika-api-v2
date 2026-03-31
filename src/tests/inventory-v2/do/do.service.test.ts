import { describe, it, expect, vi, beforeEach } from "vitest";
import { DOService } from "../../../module/application/inventory-v2/do/do.service.js";
import { TransferStatus, TransferLocationType } from "../../../generated/prisma/enums.js";
import prisma from "../../../config/prisma.js";

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
        productInventory: {
            findFirst: vi.fn(),
            update: vi.fn(),
            create: vi.fn(),
        },
        stockMovement: {
            create: vi.fn(),
        },
        outletInventory: {
            findUnique: vi.fn(),
            update: vi.fn(),
            create: vi.fn(),
        },
    },
}));

describe("DOService - Extended Testing", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (prisma.$transaction as any).mockImplementation(async (callback: any) => {
            if (Array.isArray(callback)) return Promise.all(callback);
            return callback(prisma);
        });
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
                date: "2026-03-31",
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
        it("should handle SHIPMENT transition", async () => {
            (prisma.stockTransfer.findUnique as any).mockResolvedValueOnce(mockDO);
            (prisma.productInventory.findFirst as any).mockResolvedValueOnce({ id: 1, quantity: 100 });
            (prisma.stockTransferItem.update as any).mockResolvedValue({});
            (prisma.stockTransfer.update as any).mockResolvedValueOnce({ ...mockDO, status: TransferStatus.SHIPMENT });

            const result = await DOService.updateStatus(1, { status: TransferStatus.SHIPMENT }, "tester");
            expect(result.status).toBe(TransferStatus.SHIPMENT);
        });

        it("should handle RECEIVED transition (direct to COMPLETED)", async () => {
            (prisma.stockTransfer.findUnique as any).mockResolvedValueOnce({ ...mockDO, status: TransferStatus.SHIPMENT });
            (prisma.outletInventory.findUnique as any).mockResolvedValueOnce(null);
            (prisma.stockTransferItem.update as any).mockResolvedValue({});
            (prisma.stockTransfer.update as any).mockResolvedValueOnce({ ...mockDO, status: TransferStatus.COMPLETED });

            const result = await DOService.updateStatus(1, { status: TransferStatus.RECEIVED }, "tester");
            expect(result.status).toBe(TransferStatus.COMPLETED);
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
