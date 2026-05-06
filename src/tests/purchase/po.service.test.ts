import { describe, it, expect, vi, beforeEach } from "vitest";
import { POService } from "../../module/application/purchase/po/po.service.js";
import prisma from "../../config/prisma.js";
import { ApiError } from "../../lib/errors/api.error.js";

const mockUser = { id: "user-123", name: "Test User" };

const mockPODraft = {
    id: 1,
    po_number: "PO-20260501-1234",
    po_date: new Date("2026-05-01"),
    po_type: "LOCAL",
    supplier_id: 1,
    supplier_name: "Vendor A",
    status: "DRAFT",
    currency: "IDR",
    exchange_rate: 1,
    total_estimated: 1000000,
    created_by: "user-123",
    created_at: new Date("2026-05-01"),
    updated_at: new Date("2026-05-01"),
};

describe("POService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("list", () => {
        it("should return paginated data", async () => {
            const mockData = [mockPODraft];
            const mockFindMany = vi.fn().mockResolvedValue(mockData);
            const mockCount = vi.fn().mockResolvedValue(1);

            // @ts-ignore
            prisma.purchaseOrder = {
                findMany: mockFindMany,
                count: mockCount,
            };

            const result = await POService.list({
                page: 1,
                take: 10,
                order: "desc"
            });

            expect(result.data).toEqual(mockData);
            expect(result.total).toBe(1);
            expect(mockFindMany).toHaveBeenCalledOnce();
        });
    });

    describe("create", () => {
        it("should create a PO successfully", async () => {
            const mockCreated = { ...mockPODraft, items: [] };
            const mockCreate = vi.fn().mockResolvedValue(mockCreated);

            const mockSupplier = { id: 1, name: "Vendor A", slug: "VND-A" };
            // @ts-ignore
            prisma.$transaction = vi.fn().mockImplementation(async (cb) => cb({
                supplier: { findUniqueOrThrow: vi.fn().mockResolvedValue(mockSupplier) },
                purchaseOrder: { create: mockCreate }
            }));

            const result = await POService.create({
                po_type: "LOCAL",
                supplier_id: 1,
                total_estimated: 1000000,
                notes: "General notes",
                payment_notes: "Payment notes here",
                items: [{
                    item_code: "RM001", item_name: "RM 1", uom: "kg", qty_ordered: 50, unit_price: 20000, subtotal: 1000000,
                    item_type: "MASTER"
                }],
                currency: "IDR",
                exchange_rate: 1
            }, mockUser.id);

            expect(result).toEqual(mockCreated);
            expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    payment_notes: "Payment notes here"
                })
            }));
        });

        it("should throw if IMPORT PO uses IDR currency", async () => {
            return await expect(
                POService.create({
                    po_type: "IMPORT",
                    currency: "IDR",
                    supplier_id: 2,
                    total_estimated: 100,
                    items: [{
                        item_code: "RM001", item_name: "RM 1", uom: "kg", qty_ordered: 1, unit_price: 100, subtotal: 100,
                        item_type: "MASTER"
                    }],
                    exchange_rate: null
                }, mockUser.id)
            ).rejects.toThrow(ApiError);
        });
    });

    describe("updateStatus", () => {
        it("should transition DRAFT -> SUBMITTED successfully", async () => {
            const mockUpdated = { ...mockPODraft, status: "SUBMITTED" };
            const mockFindUniqueOrThrow = vi.fn().mockResolvedValue(mockPODraft);
            const mockUpdate = vi.fn().mockResolvedValue(mockUpdated);

            // @ts-ignore
            prisma.purchaseOrder = { findUniqueOrThrow: mockFindUniqueOrThrow };
            // @ts-ignore
            prisma.$transaction = vi.fn().mockImplementation(async (cb) => cb({
                purchaseOrder: { update: mockUpdate }
            }));

            const result = await POService.updateStatus(1, { status: "SUBMITTED" }, mockUser.id);

            expect(result.status).toBe("SUBMITTED");
        });

        it("should create PurchaseTracking when status becomes ORDERED", async () => {
            const mockPOApproved = { ...mockPODraft, status: "APPROVED" };
            const mockPOOrdered = { ...mockPODraft, status: "ORDERED" };
            const mockFindUniqueOrThrow = vi.fn().mockResolvedValue(mockPOApproved);
            const mockUpdate = vi.fn().mockResolvedValue(mockPOOrdered);
            const mockUpsert = vi.fn().mockResolvedValue({});

            // @ts-ignore
            prisma.purchaseOrder = { findUniqueOrThrow: mockFindUniqueOrThrow };
            // @ts-ignore
            prisma.$transaction = vi.fn().mockImplementation(async (cb) => cb({
                purchaseOrder: { update: mockUpdate },
                purchaseTracking: { upsert: mockUpsert }
            }));

            const result = await POService.updateStatus(1, { status: "ORDERED" }, mockUser.id);

            expect(result.status).toBe("ORDERED");
            expect(mockUpdate).toHaveBeenCalledOnce();
            expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({
                where: { po_id: 1 },
                create: expect.objectContaining({ order_status: "ORDERED" })
            }));
        });
    });
});
