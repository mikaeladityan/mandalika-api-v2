import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReturnService } from "../../../module/application/inventory-v2/return/return.service.js";
import { ReturnStatus, TransferLocationType, MovementType, MovementRefType } from "../../../generated/prisma/enums.js";
import prisma from "../../../config/prisma.js";
import { RequestReturnDTO } from "../../../module/application/inventory-v2/return/return.schema.js";

vi.mock("../../../config/prisma.js", () => {
    const mockPrisma = {
        $transaction: vi.fn(),
        stockReturn: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), update: vi.fn() },
        productInventory: { findMany: vi.fn(), update: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
        outletInventory: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), findMany: vi.fn() },
        stockMovement: { create: vi.fn() },
        warehouse: { findUnique: vi.fn(), findFirst: vi.fn() },
        outlet: { findUnique: vi.fn(), findFirst: vi.fn() }
    };
    mockPrisma.$transaction.mockImplementation(async (cb: any) => {
        if (Array.isArray(cb)) return Promise.all(cb);
        return cb(mockPrisma);
    });
    return { default: mockPrisma };
});

describe("ReturnService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (prisma.productInventory.findMany as any).mockResolvedValue([{ id: 1, quantity: 100 }]);
        (prisma.outletInventory.findMany as any).mockResolvedValue([{ id: 1, quantity: 100 }]);
    });
    });

    describe("create", () => {
        it("should create a manual draft return correctly", async () => {
            const payload: RequestReturnDTO = {
                from_type: TransferLocationType.OUTLET,
                from_outlet_id: 1,
                to_type: TransferLocationType.WAREHOUSE,
                to_warehouse_id: 1,
                notes: "Manual return test",
                items: [
                    {
                        product_id: 1,
                        quantity: 10,
                        notes: "Broken"
                    }
                ]
            };

            const result = await ReturnService.create(payload, "test@example.com");

            expect(result).toBeDefined();
            expect(prisma.stockReturn.create).toHaveBeenCalled();
        });
    });

    describe("createFromRejection", () => {
        it("should create a return from rejected items in a transfer", async () => {
            const mockTransfer = {
                id: 123,
                transfer_number: "DO-2026-001",
                to_type: TransferLocationType.OUTLET,
                to_outlet_id: 1,
                from_type: TransferLocationType.WAREHOUSE,
                from_warehouse_id: 1,
                items: [
                    {
                        product_id: 1,
                        quantity_rejected: 5,
                        notes: "Rejected at destination"
                    },
                    {
                        product_id: 2,
                        quantity_rejected: 0
                    }
                ]
            };

            // @ts-ignore
            const result = await ReturnService.createFromRejection(prisma, mockTransfer, "system");

            expect(result).toBeDefined();
            expect(prisma.stockReturn.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    source_transfer_id: 123,
                    status: ReturnStatus.DRAFT,
                    items: expect.objectContaining({
                        create: [
                            expect.objectContaining({ product_id: 1, quantity: 5 })
                        ]
                    })
                })
            }));
        });
    });

    describe("updateStatus", () => {
        const mockReturn = {
            id: 1,
            return_number: "RTN-001",
            status: ReturnStatus.DRAFT,
            from_type: TransferLocationType.OUTLET,
            from_outlet_id: 1,
            to_warehouse_id: 1,
            items: [
                {
                    product_id: 1,
                    quantity: 5,
                    product: { id: 1, name: "Product 1" }
                }
            ]
        };

            (prisma.stockReturn.findUnique as any).mockResolvedValueOnce(mockReturn);
            (prisma.stockReturn.update as any).mockResolvedValue({ ...mockReturn, status: ReturnStatus.SHIPPING });
            (prisma.outletInventory.findUnique as any).mockResolvedValueOnce({
                id: 1,
                quantity: 10
            });

            // const result = await ReturnService.updateStatus(1, { status: ReturnStatus.SHIPPING }, "user-1");

            // expect(result).toBeDefined();
            expect(prisma.outletInventory.update).toHaveBeenCalled();
            expect(prisma.stockMovement.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    movement_type: MovementType.RETURN_OUT
                })
            }));
        });

        it("should handles RECEIVED status: adding to warehouse and COMPLETED", async () => {
            // const mockShippingReturn = { ...mockReturn, status: ReturnStatus.SHIPPING };
            // (prisma.stockReturn.findUnique as any).mockResolvedValueOnce(mockShippingReturn);
            (prisma.productInventory.findFirst as any).mockResolvedValueOnce({
                id: 1,
                quantity: 100
            });
            // (prisma.stockReturn.update as any).mockResolvedValue({ ...mockShippingReturn, status: ReturnStatus.COMPLETED });

            const result = await ReturnService.updateStatus(1, { status: ReturnStatus.RECEIVED }, "user-1");

            expect(result).toBeDefined();
            expect(prisma.productInventory.update).toHaveBeenCalled();
            expect(prisma.stockReturn.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    status: ReturnStatus.COMPLETED
                })
            }));
        });

        it("should handles CANCELLED status: reverting stock when in SHIPPING", async () => {
            // const mockShippingReturn = { ...mockReturn, status: ReturnStatus.SHIPPING };
            // (prisma.stockReturn.findUnique as any).mockResolvedValueOnce(mockShippingReturn);
            (prisma.outletInventory.findUnique as any).mockResolvedValueOnce({
                id: 1,
                quantity: 5
            });
            // (prisma.stockReturn.update as any).mockResolvedValue({ ...mockShippingReturn, status: ReturnStatus.CANCELLED });

            const result = await ReturnService.updateStatus(1, { status: ReturnStatus.CANCELLED }, "user-1");

            expect(result).toBeDefined();
            expect(prisma.outletInventory.update).toHaveBeenCalled(); // Should add back to outlet
            expect(prisma.stockMovement.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    movement_type: MovementType.RETURN_IN
                })
            }));
        });
