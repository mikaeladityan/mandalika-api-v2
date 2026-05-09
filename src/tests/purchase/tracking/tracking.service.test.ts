import { describe, it, expect, vi, beforeEach } from "vitest";
import { TrackingService } from "../../../module/application/purchase/tracking/tracking.service.js";
import prisma from "../../../config/prisma.js";
import { ApiError } from "../../../lib/errors/api.error.js";

const userId = "user-test";

const mockTracking = {
    id: 1,
    po_id: 1,
    order_status: "ORDERED",
    payment_status: "UNPAID",
    eta_date: null,
    ship_date: null,
    arrive_date: null,
    dp_paid_date: null,
    dp_paid_pct: null,
    final_paid_date: null,
    tracking_number: null,
    notes: null,
    updated_by: null,
    created_at: new Date(),
    updated_at: new Date(),
    po: { id: 1, po_number: "PO-001", po_date: new Date(), po_type: "LOCAL", supplier_name: "PT A", supplier_id: 1, total_estimated: 1000000, status: "ORDERED" },
};

const mockPO = {
    id: 1,
    po_number: "PO-001",
    status: "ORDERED",
    supplier_id: 1,
    supplier_name: "PT A",
};

describe("TrackingService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("list", () => {
        it("should return paginated tracking records", async () => {
            // @ts-ignore
            prisma.purchaseTracking = {
                findMany: vi.fn().mockResolvedValue([mockTracking]),
                count: vi.fn().mockResolvedValue(1),
            };

            const result = await TrackingService.list({ page: 1, take: 10, order: "desc" });

            expect(result.data).toHaveLength(1);
            expect(result.total).toBe(1);
        });

        it("should filter by order_status", async () => {
            const mockFindMany = vi.fn().mockResolvedValue([]);
            const mockCount = vi.fn().mockResolvedValue(0);
            // @ts-ignore
            prisma.purchaseTracking = { findMany: mockFindMany, count: mockCount };

            await TrackingService.list({ page: 1, take: 10, order: "desc", order_status: "SHIPPED" });

            expect(mockFindMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: expect.objectContaining({ order_status: "SHIPPED" }) }),
            );
        });
    });

    describe("detail", () => {
        it("should throw 404 if tracking not found", async () => {
            // @ts-ignore
            prisma.purchaseTracking = {
                findUnique: vi.fn().mockResolvedValue(null),
            };

            await expect(TrackingService.detail(999)).rejects.toThrow(ApiError);
        });

        it("should return tracking detail", async () => {
            // @ts-ignore
            prisma.purchaseTracking = {
                findUnique: vi.fn().mockResolvedValue(mockTracking),
            };

            const result = await TrackingService.detail(1);
            expect(result).toEqual(mockTracking);
        });
    });

    describe("update", () => {
        it("should throw if PO is not ORDERED or CLOSED", async () => {
            // @ts-ignore
            prisma.purchaseOrder = {
                findUniqueOrThrow: vi.fn().mockResolvedValue({ ...mockPO, status: "DRAFT" }),
            };

            await expect(
                TrackingService.update(1, { order_status: "SHIPPED" }, userId)
            ).rejects.toThrow(ApiError);
        });

        it("should upsert tracking for ORDERED PO", async () => {
            const mockUpsert = vi.fn().mockResolvedValue({ ...mockTracking, order_status: "SHIPPED" });
            // @ts-ignore
            prisma.purchaseOrder = {
                findUniqueOrThrow: vi.fn().mockResolvedValue(mockPO),
            };
            // @ts-ignore
            prisma.purchaseTracking = { upsert: mockUpsert };

            const result = await TrackingService.update(1, { order_status: "SHIPPED" }, userId);

            expect(mockUpsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { po_id: 1 },
                    update: expect.objectContaining({ order_status: "SHIPPED" }),
                }),
            );
        });
    });
});
