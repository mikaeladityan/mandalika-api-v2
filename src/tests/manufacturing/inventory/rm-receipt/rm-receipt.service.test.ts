import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "../../../../config/prisma.js";
import { RmReceiptService } from "../../../../module/application/manufacturing/inventory/rm-receipt/rm-receipt.service.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { TransferStatus } from "../../../../generated/prisma/enums.js";

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
        productionOrderWaste: {
            create: vi.fn(),
        },
        $transaction: vi.fn((cb) => cb(prisma)),
    },
}));

vi.mock("../../../../module/application/shared/inventory.helper.js", () => ({
    InventoryHelper: {
        deductWarehouseStock: vi.fn().mockResolvedValue({}),
        addWarehouseStock: vi.fn().mockResolvedValue({}),
    },
}));

describe("RmReceiptService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("list", () => {
        it("should return list of rm receipts filtered by SHIPMENT+ status", async () => {
            const mockData = [{ id: 1, transfer_number: "TRM-001", status: TransferStatus.SHIPMENT }];
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

    describe("updateStatus", () => {
        it("should reject APPROVED status — not allowed in Penerimaan RM", async () => {
            const mockTransfer = {
                id: 1,
                status: TransferStatus.PENDING,
                items: [],
            };
            (prisma.stockTransfer.findUnique as any).mockResolvedValue(mockTransfer);

            await expect(
                RmReceiptService.updateStatus(1, { status: TransferStatus.APPROVED }, "user-1")
            ).rejects.toThrow(ApiError);
        });

        it("should reject SHIPMENT status — belongs to Transfer RM", async () => {
            const mockTransfer = {
                id: 1,
                status: TransferStatus.APPROVED,
                items: [],
            };
            (prisma.stockTransfer.findUnique as any).mockResolvedValue(mockTransfer);

            await expect(
                RmReceiptService.updateStatus(1, { status: TransferStatus.SHIPMENT }, "user-1")
            ).rejects.toThrow(ApiError);
        });

        it("should mark RECEIVED from SHIPMENT", async () => {
            const mockTransfer = {
                id: 1,
                status: TransferStatus.SHIPMENT,
                production_order_id: null,
                items: [{ id: 10, raw_material_id: 5, quantity_packed: 100 }],
            };
            (prisma.stockTransfer.findUnique as any).mockResolvedValue(mockTransfer);
            (prisma.stockTransfer.update as any).mockResolvedValue({ ...mockTransfer, status: TransferStatus.RECEIVED });
            (prisma.stockTransferItem.update as any).mockResolvedValue({});

            const payload = {
                status: TransferStatus.RECEIVED,
                items: [{ id: 10, quantity_received: 100 }],
            };
            const result = await RmReceiptService.updateStatus(1, payload, "user-1");

            expect(result.status).toBe(TransferStatus.RECEIVED);
        });

        it("should handle FULFILLMENT and return COMPLETED when no discrepancy", async () => {
            const mockTransfer = {
                id: 1,
                status: TransferStatus.RECEIVED,
                production_order_id: null,
                to_warehouse_id: 2,
                items: [{ id: 10, raw_material_id: 5, quantity_packed: 100, raw_material: { name: "RM A" } }],
            };
            (prisma.stockTransfer.findUnique as any).mockResolvedValue(mockTransfer);
            (prisma.stockTransfer.update as any).mockResolvedValue({ ...mockTransfer, status: TransferStatus.COMPLETED });
            (prisma.stockTransferItem.update as any).mockResolvedValue({});

            const payload = {
                status: TransferStatus.FULFILLMENT,
                items: [{ id: 10, quantity_fulfilled: 100, quantity_missing: 0, quantity_rejected: 0 }],
            };
            const result = await RmReceiptService.updateStatus(1, payload, "user-1");

            expect(result.status).toBe(TransferStatus.COMPLETED);
        });

        it("should return PARTIAL when there are discrepancies in FULFILLMENT", async () => {
            const mockTransfer = {
                id: 1,
                status: TransferStatus.RECEIVED,
                production_order_id: null,
                to_warehouse_id: 2,
                items: [{ id: 10, raw_material_id: 5, quantity_packed: 100, raw_material: { name: "RM A" } }],
            };
            (prisma.stockTransfer.findUnique as any).mockResolvedValue(mockTransfer);
            (prisma.stockTransfer.update as any).mockResolvedValue({ ...mockTransfer, status: TransferStatus.PARTIAL });
            (prisma.stockTransferItem.update as any).mockResolvedValue({});

            const payload = {
                status: TransferStatus.FULFILLMENT,
                items: [{ id: 10, quantity_fulfilled: 90, quantity_missing: 5, quantity_rejected: 5 }],
            };
            const result = await RmReceiptService.updateStatus(1, payload, "user-1");

            expect(result.status).toBe(TransferStatus.PARTIAL);
        });

        it("should throw 400 for COMPLETED/CANCELLED transfer", async () => {
            const mockTransfer = {
                id: 1,
                status: TransferStatus.COMPLETED,
                items: [],
            };
            (prisma.stockTransfer.findUnique as any).mockResolvedValue(mockTransfer);

            await expect(
                RmReceiptService.updateStatus(1, { status: TransferStatus.RECEIVED }, "user-1")
            ).rejects.toThrow(ApiError);
        });
    });
});
