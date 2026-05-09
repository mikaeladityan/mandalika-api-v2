import { describe, it, expect, vi, beforeEach } from "vitest";
import { VendorReturnService } from "../../../module/application/purchase/vendor-return/vendor-return.service.js";
import prisma from "../../../config/prisma.js";
import { ApiError } from "../../../lib/errors/api.error.js";

const userId = "user-test";

const mockReceiptItem = {
    id: 100,
    receipt_id: 1,
    po_id: 1,
    po_item_id: 10,
    raw_material_id: 5,
    item_code: "RM001",
    item_name: "Kain Katun",
    uom: "meter",
    qty_received: 50,
    unit_price: 20000,
    amount: 1000000,
    notes: null,
    created_at: new Date(),
};

const mockReceipt = {
    id: 1,
    receipt_number: "RCV-RM-20260509-1234",
    receipt_date: new Date(),
    po_id: null,
    warehouse_id: 3,
    status: "POSTED",
    total_qty: 50,
    total_amount: 1000000,
    notes: null,
    posted_at: new Date(),
    created_by: userId,
    updated_by: null,
    approved_by: null,
    created_at: new Date(),
    updated_at: new Date(),
    items: [mockReceiptItem],
};

const mockVendorReturn = {
    id: 1,
    return_number: "RTN-20260509-1234",
    return_date: new Date(),
    receipt_id: 1,
    warehouse_id: 3,
    status: "DRAFT",
    reason: "Barang rusak",
    notes: null,
    posted_at: null,
    created_by: userId,
    updated_by: null,
    created_at: new Date(),
    updated_at: new Date(),
    items: [
        {
            id: 200,
            return_id: 1,
            receipt_item_id: 100,
            raw_material_id: 5,
            item_code: "RM001",
            item_name: "Kain Katun",
            uom: "meter",
            qty_returned: 10,
            unit_price: 20000,
            amount: 200000,
            reason: "Barang rusak",
            created_at: new Date(),
        },
    ],
    warehouse: { id: 3 },
};

describe("VendorReturnService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("create", () => {
        it("should throw if receipt is not POSTED", async () => {
            // @ts-ignore
            prisma.purchaseReceipt = {
                findUniqueOrThrow: vi.fn().mockResolvedValue({ ...mockReceipt, status: "DRAFT" }),
            };

            await expect(
                VendorReturnService.create(
                    { receipt_id: 1, warehouse_id: 3, items: [{ receipt_item_id: 100, qty_returned: 10 }] },
                    userId,
                )
            ).rejects.toThrow(ApiError);
        });

        it("should throw if receipt_item_id not in receipt", async () => {
            // @ts-ignore
            prisma.purchaseReceipt = {
                findUniqueOrThrow: vi.fn().mockResolvedValue(mockReceipt),
            };
            // @ts-ignore
            prisma.vendorReturnItem = {
                aggregate: vi.fn().mockResolvedValue({ _sum: { qty_returned: null } }),
            };

            await expect(
                VendorReturnService.create(
                    { receipt_id: 1, warehouse_id: 3, items: [{ receipt_item_id: 999, qty_returned: 10 }] },
                    userId,
                )
            ).rejects.toThrow(ApiError);
        });

        it("should throw if qty_returned exceeds available qty", async () => {
            // @ts-ignore
            prisma.purchaseReceipt = {
                findUniqueOrThrow: vi.fn().mockResolvedValue(mockReceipt),
            };
            // @ts-ignore
            prisma.vendorReturnItem = {
                aggregate: vi.fn().mockResolvedValue({ _sum: { qty_returned: 45 } }),
            };

            await expect(
                VendorReturnService.create(
                    { receipt_id: 1, warehouse_id: 3, items: [{ receipt_item_id: 100, qty_returned: 10 }] },
                    userId,
                )
            ).rejects.toThrow(ApiError);
        });

        it("should create vendor return successfully", async () => {
            const mockCreated = { ...mockVendorReturn };
            // @ts-ignore
            prisma.purchaseReceipt = {
                findUniqueOrThrow: vi.fn().mockResolvedValue(mockReceipt),
            };
            // @ts-ignore
            prisma.vendorReturnItem = {
                aggregate: vi.fn().mockResolvedValue({ _sum: { qty_returned: null } }),
            };
            // @ts-ignore
            prisma.$transaction = vi.fn().mockImplementation(async (cb) => cb({
                vendorReturn: { create: vi.fn().mockResolvedValue(mockCreated) },
            }));

            const result = await VendorReturnService.create(
                { receipt_id: 1, warehouse_id: 3, items: [{ receipt_item_id: 100, qty_returned: 10 }] },
                userId,
            );

            expect(result).toEqual(mockCreated);
        });
    });

    describe("post", () => {
        it("should throw if vendor return is not DRAFT", async () => {
            // @ts-ignore
            prisma.vendorReturn = {
                findUniqueOrThrow: vi.fn().mockResolvedValue({ ...mockVendorReturn, status: "POSTED" }),
            };

            await expect(VendorReturnService.post(1, userId)).rejects.toThrow(ApiError);
        });

        it("should throw if vendor return has no items", async () => {
            // @ts-ignore
            prisma.vendorReturn = {
                findUniqueOrThrow: vi.fn().mockResolvedValue({ ...mockVendorReturn, items: [] }),
            };

            await expect(VendorReturnService.post(1, userId)).rejects.toThrow(ApiError);
        });

        it("should post and run atomic operations", async () => {
            // @ts-ignore
            prisma.vendorReturn = {
                findUniqueOrThrow: vi.fn().mockResolvedValue(mockVendorReturn),
            };

            const mockTx = {
                vendorReturn: {
                    update: vi.fn().mockResolvedValue({ ...mockVendorReturn, status: "POSTED" }),
                    findUniqueOrThrow: vi.fn().mockResolvedValue({ ...mockVendorReturn, status: "POSTED" }),
                },
                rawMaterialInventory: {
                    findUnique: vi.fn().mockResolvedValue({ quantity: 50 }),
                    upsert: vi.fn().mockResolvedValue({ id: 1, quantity: 40 }),
                },
                stockMovement: { create: vi.fn().mockResolvedValue({ id: 1 }) },
                purchaseReceiptItem: {
                    findMany: vi.fn().mockResolvedValue([{ id: 100, po_id: 1 }]),
                },
                accountPayable: {
                    findFirst: vi.fn().mockResolvedValue({
                        id: 1, amount: 1000000, remaining_amount: 1000000, notes: null
                    }),
                    update: vi.fn().mockResolvedValue({}),
                },
            };
            // @ts-ignore
            prisma.$transaction = vi.fn().mockImplementation(async (cb) => cb(mockTx));

            await VendorReturnService.post(1, userId);

            expect(mockTx.vendorReturn.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ status: "POSTED" }) }),
            );
            expect(mockTx.stockMovement.create).toHaveBeenCalledOnce();
        });
    });

    describe("approve", () => {
        it("should throw if return is not POSTED", async () => {
            // @ts-ignore
            prisma.vendorReturn = {
                findUniqueOrThrow: vi.fn().mockResolvedValue({ ...mockVendorReturn, status: "DRAFT" }),
            };

            await expect(VendorReturnService.approve(1, userId)).rejects.toThrow(ApiError);
        });

        it("should approve a POSTED return", async () => {
            // @ts-ignore
            prisma.vendorReturn = {
                findUniqueOrThrow: vi.fn().mockResolvedValue({ ...mockVendorReturn, status: "POSTED" }),
                update: vi.fn().mockResolvedValue({ ...mockVendorReturn, status: "APPROVED" }),
            };

            const result = await VendorReturnService.approve(1, userId);
            expect(result.status).toBe("APPROVED");
        });
    });

    describe("destroy", () => {
        it("should throw if return is not DRAFT", async () => {
            // @ts-ignore
            prisma.vendorReturn = {
                findUniqueOrThrow: vi.fn().mockResolvedValue({ ...mockVendorReturn, status: "POSTED" }),
            };

            await expect(VendorReturnService.destroy(1)).rejects.toThrow(ApiError);
        });

        it("should delete DRAFT return", async () => {
            // @ts-ignore
            prisma.vendorReturn = {
                findUniqueOrThrow: vi.fn().mockResolvedValue(mockVendorReturn),
                delete: vi.fn().mockResolvedValue(mockVendorReturn),
            };

            const result = await VendorReturnService.destroy(1);
            expect(result).toEqual(mockVendorReturn);
        });
    });
});
