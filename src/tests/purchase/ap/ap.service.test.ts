import { describe, it, expect, vi, beforeEach } from "vitest";
import { APService } from "../../../module/application/purchase/ap/ap.service.js";
import prisma from "../../../config/prisma.js";
import { ApiError } from "../../../lib/errors/api.error.js";

const mockAP = {
    id: 1,
    ap_number: "AP-20260509-1234",
    po_id: 1,
    receipt_id: 1,
    supplier_id: 1,
    supplier_name: "PT Supplier ABC",
    invoice_number: null,
    invoice_date: null,
    due_date: null,
    amount: 1000000,
    paid_amount: 0,
    remaining_amount: 1000000,
    status: "UNPAID",
    notes: null,
    created_by: "user-test",
    created_at: new Date(),
    updated_at: new Date(),
};

describe("APService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("list", () => {
        it("should return paginated AP records", async () => {
            // @ts-ignore
            prisma.accountPayable = {
                findMany: vi.fn().mockResolvedValue([mockAP]),
                count: vi.fn().mockResolvedValue(1),
            };

            const result = await APService.list({ page: 1, take: 10, order: "asc" });

            expect(result.data).toHaveLength(1);
            expect(result.total).toBe(1);
        });

        it("should filter by status", async () => {
            const mockFindMany = vi.fn().mockResolvedValue([]);
            const mockCount = vi.fn().mockResolvedValue(0);
            // @ts-ignore
            prisma.accountPayable = { findMany: mockFindMany, count: mockCount };

            await APService.list({ page: 1, take: 10, order: "asc", status: "UNPAID" });

            expect(mockFindMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: expect.objectContaining({ status: "UNPAID" }) }),
            );
        });
    });

    describe("updatePayment", () => {
        it("should throw if AP is already PAID", async () => {
            // @ts-ignore
            prisma.accountPayable = {
                findUniqueOrThrow: vi.fn().mockResolvedValue({ ...mockAP, status: "PAID" }),
            };

            await expect(APService.updatePayment(1, { paid_amount: 100000 })).rejects.toThrow(ApiError);
        });

        it("should set status to DP_PAID on first partial payment", async () => {
            const mockUpdate = vi.fn().mockResolvedValue({ ...mockAP, status: "DP_PAID", paid_amount: 300000, remaining_amount: 700000 });
            // @ts-ignore
            prisma.accountPayable = {
                findUniqueOrThrow: vi.fn().mockResolvedValue(mockAP),
                update: mockUpdate,
            };
            // @ts-ignore
            prisma.purchaseTracking = {
                updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            };

            const result = await APService.updatePayment(1, { paid_amount: 300000 });

            expect(mockUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ status: "DP_PAID" }),
                }),
            );
        });

        it("should set status to PAID when fully paid", async () => {
            const mockUpdate = vi.fn().mockResolvedValue({ ...mockAP, status: "PAID", paid_amount: 1000000, remaining_amount: 0 });
            // @ts-ignore
            prisma.accountPayable = {
                findUniqueOrThrow: vi.fn().mockResolvedValue(mockAP),
                update: mockUpdate,
            };
            // @ts-ignore
            prisma.purchaseTracking = {
                updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            };

            const result = await APService.updatePayment(1, { paid_amount: 1000000 });

            expect(mockUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ status: "PAID" }),
                }),
            );
        });

        it("should set status to PARTIALLY_PAID for second payment", async () => {
            const partiallyPaidAP = { ...mockAP, paid_amount: 300000, remaining_amount: 700000, status: "DP_PAID" };
            const mockUpdate = vi.fn().mockResolvedValue({ ...partiallyPaidAP, status: "PARTIALLY_PAID", paid_amount: 600000, remaining_amount: 400000 });
            // @ts-ignore
            prisma.accountPayable = {
                findUniqueOrThrow: vi.fn().mockResolvedValue(partiallyPaidAP),
                update: mockUpdate,
            };
            // @ts-ignore
            prisma.purchaseTracking = {
                updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            };

            await APService.updatePayment(1, { paid_amount: 300000 });

            expect(mockUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ status: "PARTIALLY_PAID" }),
                }),
            );
        });

        it("should sync payment_status to PurchaseTracking", async () => {
            const mockUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
            const mockUpdate = vi.fn().mockResolvedValue({ ...mockAP, status: "PAID", paid_amount: 1000000, remaining_amount: 0 });
            // @ts-ignore
            prisma.accountPayable = {
                findUniqueOrThrow: vi.fn().mockResolvedValue(mockAP),
                update: mockUpdate,
            };
            // @ts-ignore
            prisma.purchaseTracking = { updateMany: mockUpdateMany };

            await APService.updatePayment(1, { paid_amount: 1000000 });

            expect(mockUpdateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { po_id: 1 },
                    data: { payment_status: "PAID" },
                }),
            );
        });
    });
});
