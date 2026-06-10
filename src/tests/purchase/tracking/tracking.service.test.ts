import { describe, it, expect, vi, beforeEach } from "vitest";
import { TrackingService } from "../../../module/application/purchase/tracking/tracking.service.js";
import prisma from "../../../config/prisma.js";
import { ApiError } from "../../../lib/errors/api.error.js";
import { SUPPLIER_OBSCURE_REGEX } from "../../../lib/utils/supplier-obscure.js";

const userId = "user-test";

const mockTrackingRow = {
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
};

const mockPOWithTracking = {
    id: 1,
    po_number: "PO-001",
    po_date: new Date(),
    po_type: "LOCAL",
    supplier_name: "PT A",
    supplier_id: 1,
    supplier_code: "pt-a",
    total_estimated: 1000000,
    status: "ORDERED",
    created_at: new Date(),
    updated_at: new Date(),
    tracking: mockTrackingRow,
    supplier: { id: 1, name: "PT A", country: "ID" },
};

// mockTracking used in detail tests — full PurchaseTracking include shape
const mockTrackingDetail = {
    ...mockTrackingRow,
    po: {
        id: 1,
        po_number: "PO-001",
        po_date: new Date(),
        po_type: "LOCAL",
        supplier_name: "PT A",
        supplier_id: 1,
        supplier_code: "pt-a",
        total_estimated: 1000000,
        status: "ORDERED",
        created_at: new Date(),
        updated_at: new Date(),
        supplier: { id: 1, name: "PT A" },
        warehouse: { id: 1, name: "WH-01", code: "WH01" },
        items: [],
        payment_terms: [],
    },
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
            const mockFindMany = vi.fn().mockResolvedValue([mockPOWithTracking]);
            const mockCount = vi.fn().mockResolvedValue(1);
            // @ts-ignore
            prisma.purchaseOrder = { findMany: mockFindMany, count: mockCount };

            const result = await TrackingService.list({ page: 1, take: 10, order: "desc" });

            expect(result.data).toHaveLength(1);
            expect(result.total).toBe(1);
        });

        it("should filter by order_status", async () => {
            const mockFindMany = vi.fn().mockResolvedValue([]);
            const mockCount = vi.fn().mockResolvedValue(0);
            // @ts-ignore
            prisma.purchaseOrder = { findMany: mockFindMany, count: mockCount };

            await TrackingService.list({ page: 1, take: 10, order: "desc", order_status: "SHIPPED" });

            expect(mockFindMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: expect.objectContaining({ tracking: expect.objectContaining({ order_status: "SHIPPED" }) }) }),
            );
        });

        it("masks supplier identity in list response (po.supplier_name and supplier.name obscured)", async () => {
            const mockFindMany = vi.fn().mockResolvedValue([
                {
                    id: 100, supplier_id: 42, supplier_name: "PT Real Vendor", supplier_code: "pt-real-vendor",
                    tracking: { id: 1, po_id: 100, order_status: "ORDERED", payment_status: "UNPAID", eta_date: null, ship_date: null, arrive_date: null, dp_paid_date: null, dp_paid_pct: null, final_paid_date: null, tracking_number: null, notes: null, updated_by: null, created_at: new Date(), updated_at: new Date() },
                    supplier: { id: 42, name: "PT Real Vendor", country: "ID" },
                    created_at: new Date(), updated_at: new Date(),
                },
                {
                    id: 101, supplier_id: 1000, supplier_name: "PT Other Vendor", supplier_code: "pt-other-vendor",
                    tracking: null,
                    supplier: { id: 1000, name: "PT Other Vendor", country: "ID" },
                    created_at: new Date(), updated_at: new Date(),
                },
            ]);
            const mockCount = vi.fn().mockResolvedValue(2);
            // @ts-ignore
            prisma.purchaseOrder = { findMany: mockFindMany, count: mockCount };

            const { data } = await TrackingService.list({
                page: 1, take: 10, sortBy: "created_at", order: "desc",
            } as any);

            for (const row of data) {
                expect(row.po.supplier_name).toMatch(SUPPLIER_OBSCURE_REGEX);
                expect(row.po.supplier_name).toHaveLength(7);
                expect(row.po.supplier_code).toBeNull();
                expect(row.po.supplier!.name).toMatch(SUPPLIER_OBSCURE_REGEX);
                expect(row.po.supplier!.name).toHaveLength(7);
            }
            expect(data[0]!.po.supplier_name).toBe("SUP-042");
            expect(data[1]!.po.supplier_name).toBe("SUP1000");
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

        it("should return tracking detail with obscured supplier identity", async () => {
            // @ts-ignore
            prisma.purchaseTracking = {
                findUnique: vi.fn().mockResolvedValue(mockTrackingDetail),
            };

            const result = await TrackingService.detail(1);
            expect(result.po.supplier_name).toMatch(SUPPLIER_OBSCURE_REGEX);
            expect(result.po.supplier_name).toHaveLength(7);
            expect(result.po.supplier_code).toBeNull();
            expect(result.po.supplier!.name).toMatch(SUPPLIER_OBSCURE_REGEX);
            expect(result.po.supplier!.name).toHaveLength(7);
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
            const mockUpsert = vi.fn().mockResolvedValue({ ...mockTrackingRow, order_status: "SHIPPED" });
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
