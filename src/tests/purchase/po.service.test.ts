import { describe, it, expect, vi, beforeEach } from "vitest";
import { POService } from "../../module/application/purchase/po/po.service.js";
import prisma from "../../config/prisma.js";
import { ApiError } from "../../lib/errors/api.error.js";
import { SUPPLIER_OBSCURE_REGEX } from "../../lib/utils/supplier-obscure.js";

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

            expect(result.data).toHaveLength(1);
            expect(result.total).toBe(1);
            expect(mockFindMany).toHaveBeenCalledOnce();
            expect(result.data[0].supplier_name).toMatch(SUPPLIER_OBSCURE_REGEX);
            expect(result.data[0].supplier_name).toHaveLength(7);
        });

        it("masks supplier identity in list response (anonymous code only)", async () => {
            const mockFindMany = vi.fn().mockResolvedValue([
                { ...mockPODraft, supplier_id: 42, supplier_name: "PT Real Vendor", supplier_code: "pt-real-vendor", supplier: { id: 42, name: "PT Real Vendor", country: "ID" } },
                { ...mockPODraft, id: 2, supplier_id: 1000, supplier_name: "PT Other Vendor", supplier_code: "pt-other-vendor", supplier: { id: 1000, name: "PT Other Vendor", country: "ID" } },
            ]);
            const mockCount = vi.fn().mockResolvedValue(2);
            // @ts-ignore
            prisma.purchaseOrder = { findMany: mockFindMany, count: mockCount };

            const { data } = await POService.list({
                page: 1, take: 10, sortBy: "po_date", order: "desc",
            } as any);

            for (const row of data) {
                expect(row.supplier_name).toMatch(SUPPLIER_OBSCURE_REGEX);
                expect(row.supplier_name).toHaveLength(7);
                expect(row.supplier_name).not.toBe("PT Real Vendor");
                expect(row.supplier_name).not.toBe("PT Other Vendor");
                if (row.supplier) {
                    expect(row.supplier.name).toMatch(SUPPLIER_OBSCURE_REGEX);
                    expect(row.supplier.name).toHaveLength(7);
                }
            }
            expect(data[0].supplier_name).toBe("SUP-042");
            expect(data[1].supplier_name).toBe("SUP1000");

            for (const row of data) {
                expect(row.supplier_code).toBeNull();
            }
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
                purchaseOrder: { create: mockCreate, count: vi.fn().mockResolvedValue(0) }
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

            expect(result.supplier_name).toMatch(SUPPLIER_OBSCURE_REGEX);
            expect(result.supplier_name).toHaveLength(7);
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
            const mockPOApproved = { ...mockPODraft, status: "APPROVED", payment_terms: [] };
            const mockPOOrdered = { ...mockPODraft, status: "ORDERED" };
            const mockFindUniqueOrThrow = vi.fn().mockResolvedValue(mockPOApproved);
            const mockUpdate = vi.fn().mockResolvedValue(mockPOOrdered);
            const mockUpsert = vi.fn().mockResolvedValue({});

            // @ts-ignore
            prisma.purchaseOrder = { findUniqueOrThrow: mockFindUniqueOrThrow };
            // @ts-ignore
            prisma.$transaction = vi.fn().mockImplementation(async (cb) => cb({
                purchaseOrder: { update: mockUpdate, count: vi.fn().mockResolvedValue(0) },
                purchaseTracking: { upsert: mockUpsert },
                accountPayable: { create: vi.fn().mockResolvedValue({}), count: vi.fn().mockResolvedValue(0) },
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
