import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReturnService } from "../../../module/application/inventory-v2/return/return.service.js";
import { ReturnStatus, TransferLocationType, MovementType, MovementRefType } from "../../../generated/prisma/enums.js";
import prisma from "../../../config/prisma.js";
import { RequestReturnDTO } from "../../../module/application/inventory-v2/return/return.schema.js";

describe("ReturnService", () => {
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

        it("should handles SHIPPING status: deducting from outlet stock", async () => {
            (prisma.stockReturn.findUnique as any).mockResolvedValueOnce(mockReturn);
            (prisma.outletInventory.findUnique as any).mockResolvedValueOnce({
                id: 1,
                quantity: 10
            });

            const result = await ReturnService.updateStatus(1, { status: ReturnStatus.SHIPPING }, "user-1");

            expect(result).toBeDefined();
            expect(prisma.outletInventory.update).toHaveBeenCalled();
            expect(prisma.stockMovement.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    movement_type: MovementType.RETURN_OUT
                })
            }));
        });

        it("should handles RECEIVED status: adding to warehouse and COMPLETED", async () => {
            const mockShippingReturn = { ...mockReturn, status: ReturnStatus.SHIPPING };
            (prisma.stockReturn.findUnique as any).mockResolvedValueOnce(mockShippingReturn);
            (prisma.productInventory.findFirst as any).mockResolvedValueOnce({
                id: 1,
                quantity: 100
            });

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
            const mockShippingReturn = { ...mockReturn, status: ReturnStatus.SHIPPING };
            (prisma.stockReturn.findUnique as any).mockResolvedValueOnce(mockShippingReturn);
            (prisma.outletInventory.findUnique as any).mockResolvedValueOnce({
                id: 1,
                quantity: 5
            });

            const result = await ReturnService.updateStatus(1, { status: ReturnStatus.CANCELLED }, "user-1");

            expect(result).toBeDefined();
            expect(prisma.outletInventory.update).toHaveBeenCalled(); // Should add back to outlet
            expect(prisma.stockMovement.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    movement_type: MovementType.RETURN_IN
                })
            }));
        });
    });
});
