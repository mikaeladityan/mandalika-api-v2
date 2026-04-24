import { describe, it, expect, vi, beforeEach } from "vitest";
import { RmSkuTransferService } from "../../../../module/application/manufacturing/inventory/rm-sku-transfer/rm-sku-transfer.service.js";
import prisma from "../../../../config/prisma.js";
import { ApiError } from "../../../../lib/errors/api.error.js";

vi.mock("../../../../config/prisma.js", () => ({
    default: {
        rawMaterial: {
            findUnique: vi.fn(),
        },
        warehouse: {
            findUnique: vi.fn(),
        },
        rawMaterialInventory: {
            findFirst: vi.fn(),
            findMany: vi.fn(),
            update: vi.fn(),
            create: vi.fn(),
        },
        stockMovement: {
            create: vi.fn(),
        },
        $transaction: vi.fn((cb) => cb(prisma)),
    },
}));

describe("RmSkuTransferService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default findMany to empty array to avoid reduce errors
        vi.mocked(prisma.rawMaterialInventory.findMany).mockResolvedValue([]);
    });

    const mockData = {
        source_rm_id: 1,
        target_rm_id: 2,
        warehouse_id: 3,
        quantity: 10,
        notes: "Test transfer",
    };

    it("should throw error if source and target RM are the same", async () => {
        await expect(
            RmSkuTransferService.transfer({
                ...mockData,
                target_rm_id: 1,
            })
        ).rejects.toThrow(ApiError);
    });

    it("should throw error if source RM not found", async () => {
        vi.mocked(prisma.rawMaterial.findUnique).mockResolvedValueOnce(null);

        await expect(RmSkuTransferService.transfer(mockData)).rejects.toThrow("RM Asal tidak ditemukan");
    });

    it("should throw error if target RM not found", async () => {
        vi.mocked(prisma.rawMaterial.findUnique)
            .mockResolvedValueOnce({ id: 1, name: "RM Asal" } as any) // Source found
            .mockResolvedValueOnce(null); // Target not found

        await expect(RmSkuTransferService.transfer(mockData)).rejects.toThrow("RM Tujuan tidak ditemukan");
    });

    it("should throw error if warehouse not found", async () => {
        vi.mocked(prisma.rawMaterial.findUnique)
            .mockResolvedValueOnce({ id: 1, name: "RM Asal" } as any)
            .mockResolvedValueOnce({ id: 2, name: "RM Tujuan" } as any);
        vi.mocked(prisma.warehouse.findUnique).mockResolvedValueOnce(null);

        await expect(RmSkuTransferService.transfer(mockData)).rejects.toThrow("Gudang tidak ditemukan");
    });

        it("should successfully transfer stock", async () => {
            vi.mocked(prisma.rawMaterial.findUnique)
                .mockResolvedValueOnce({ id: 1, name: "RM Asal" } as any)
                .mockResolvedValueOnce({ id: 2, name: "RM Tujuan" } as any);
            vi.mocked(prisma.warehouse.findUnique).mockResolvedValueOnce({ id: 3, name: "Gudang Utama" } as any);

            // Mock source inventory for findMany (InventoryHelper calls this)
            vi.mocked(prisma.rawMaterialInventory.findMany).mockResolvedValueOnce([
                { id: 10, quantity: 100, month: 4, year: 2026 }
            ] as any);

            // Mock target inventory for findMany
            vi.mocked(prisma.rawMaterialInventory.findMany).mockResolvedValueOnce([
                { id: 11, quantity: 50, month: 4, year: 2026 }
            ] as any);

            const result = await RmSkuTransferService.transfer(mockData, "system");

            expect(result).toBeDefined();
            expect(prisma.$transaction).toHaveBeenCalled();
            expect(prisma.rawMaterialInventory.update).toHaveBeenCalledTimes(2);
            expect(prisma.stockMovement.create).toHaveBeenCalledTimes(2);
        });
});
