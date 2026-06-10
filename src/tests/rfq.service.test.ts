import { describe, it, expect, vi, beforeEach } from "vitest";
import { RFQService } from "../module/application/purchase/rfq/rfq.service.js";
import prisma from "../config/prisma.js";
import { ApiError } from "../lib/errors/api.error.js";
import { SUPPLIER_OBSCURE_REGEX } from "../lib/utils/supplier-obscure.js";

const mockUser = { id: "user-123", name: "Test User" };

const mockRFQDraft = {
    id: 1,
    rfq_number: "RFQ-20260422-1234",
    rfq_date: new Date("2026-04-22"),
    supplier_id: null,
    supplier_name: "Vendor A",
    supplier_code: null,
    status: "DRAFT",
    notes: null,
    created_by: "user-123",
    created_at: new Date("2026-04-22"),
    updated_at: new Date("2026-04-22"),
};

describe("RFQService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("list", () => {
        it("should return paginated data", async () => {
            const mockData = [mockRFQDraft];
            const mockFindMany = vi.fn().mockResolvedValue(mockData);
            const mockCount = vi.fn().mockResolvedValue(1);

            // @ts-ignore
            prisma.purchaseRFQ = {
                findMany: mockFindMany,
                count: mockCount,
            };

            const result = await RFQService.list({
                page: 1,
                take: 10,
                order: "desc",
            });

            expect(result.total).toBe(1);
            expect(result.data).toHaveLength(1);
            expect(result.data[0].supplier_name).toMatch(SUPPLIER_OBSCURE_REGEX);
            expect(result.data[0].supplier_name).toHaveLength(7);
            expect(mockFindMany).toHaveBeenCalledOnce();
        });

        it("should apply status filter when provided", async () => {
            const mockFindMany = vi.fn().mockResolvedValue([]);
            const mockCount = vi.fn().mockResolvedValue(0);

            // @ts-ignore
            prisma.purchaseRFQ = {
                findMany: mockFindMany,
                count: mockCount,
            };

            await RFQService.list({ page: 1, take: 10, status: "SUBMITTED", order: "desc" });

            const calledWith = mockFindMany.mock.calls[0]?.[0];
            expect(calledWith?.where?.status).toBe("SUBMITTED");
        });

        it("masks supplier identity in list response (anonymous code only)", async () => {
            const mockFindMany = vi.fn().mockResolvedValue([
                { ...mockRFQDraft, supplier_id: 42, supplier_name: "PT Real Vendor" },
                { ...mockRFQDraft, id: 2, supplier_id: 1000, supplier_name: "PT Other Vendor" },
            ]);
            const mockCount = vi.fn().mockResolvedValue(2);
            // @ts-ignore
            prisma.purchaseRFQ = { findMany: mockFindMany, count: mockCount };

            const { data } = await RFQService.list({
                page: 1, take: 10, sortBy: "rfq_date", order: "desc",
            } as any);

            for (const row of data) {
                expect(row.supplier_name).toMatch(SUPPLIER_OBSCURE_REGEX);
                expect(row.supplier_name).toHaveLength(7);
                expect(row.supplier_name).not.toBe("PT Real Vendor");
                expect(row.supplier_name).not.toBe("PT Other Vendor");
            }
            expect(data[0].supplier_name).toBe("SUP-042");
            expect(data[1].supplier_name).toBe("SUP1000");
        });
    });

    describe("create", () => {
        it("should create an RFQ successfully", async () => {
            const mockCreated = { ...mockRFQDraft, items: [] };
            const mockFindFirst = vi.fn().mockResolvedValue(null);
            const mockCreate = vi.fn().mockResolvedValue(mockCreated);
            const mockSupplierFind = vi.fn().mockResolvedValue(null);
            const mockSupplierCreate = vi.fn().mockResolvedValue({ id: 1, name: "Vendor A" });
            const mockSupplierMaterialFind = vi.fn().mockResolvedValue(null);
            const mockSupplierMaterialCreate = vi.fn().mockResolvedValue({});

            const mockTransaction = vi.fn(async (callback) => {
                const txMock = {
                    purchaseRFQItem: { findFirst: mockFindFirst },
                    purchaseRFQ: { create: mockCreate },
                    supplier: { findUnique: mockSupplierFind, create: mockSupplierCreate },
                    supplierMaterial: {
                        findUnique: mockSupplierMaterialFind,
                        create: mockSupplierMaterialCreate,
                        update: vi.fn().mockResolvedValue({})
                    },
                };
                return await callback(txMock);
            });

            // @ts-ignore
            prisma.$transaction = mockTransaction;
            // @ts-ignore
            prisma.purchaseRFQItem = { findFirst: mockFindFirst };

            const result = await RFQService.create({
                rfq_number: "RFQ-001",
                supplier_name: "Vendor A",
                is_new_supplier: false,
                supplier_source: "LOCAL",
                items: [{ item_code: "RM001", item_name: "RM 1", uom: "kg", qty_requested: 50, unit_price: 1000 }],
            }, mockUser.id);

            expect(result.supplier_name).toMatch(SUPPLIER_OBSCURE_REGEX);
            expect(result.supplier_name).toHaveLength(7);
            expect(mockCreate).toHaveBeenCalledOnce();
        });

        it("should throw if purchase_draft_id is already linked", async () => {
            const mockFindFirst = vi.fn().mockResolvedValue({ id: 99, purchase_draft_id: 5 });

            // @ts-ignore
            prisma.purchaseRFQItem = { findFirst: mockFindFirst };

            await expect(
                RFQService.create({
                    rfq_number: "RFQ-002",
                    supplier_name: "Vendor A",
                    is_new_supplier: false,
                    supplier_source: "LOCAL",
                    items: [{ item_code: "RM001", item_name: "RM 1", uom: "kg", qty_requested: 50, purchase_draft_id: 5, unit_price: 1000 }],
                }, mockUser.id)
            ).rejects.toThrow(ApiError);
        });
    });

    describe("updateStatus", () => {
        it("should transition DRAFT -> SUBMITTED successfully", async () => {
            const mockUpdated = { ...mockRFQDraft, status: "SUBMITTED" };
            const mockFindUniqueOrThrow = vi.fn().mockResolvedValue(mockRFQDraft);
            const mockUpdate = vi.fn().mockResolvedValue(mockUpdated);

            // @ts-ignore
            prisma.purchaseRFQ = {
                findUniqueOrThrow: mockFindUniqueOrThrow,
                update: mockUpdate,
            };

            const result = await RFQService.updateStatus(1, { status: "SUBMITTED" }, mockUser.id);

            expect(result.status).toBe("SUBMITTED");
            expect(result.supplier_name).toMatch(SUPPLIER_OBSCURE_REGEX);
            expect(result.supplier_name).toHaveLength(7);
            expect(mockUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 1 },
                    data: expect.objectContaining({ status: "SUBMITTED", updated_by: mockUser.id }),
                })
            );
        });

        it("should set approved fields when transition to APPROVED", async () => {
            const submittedRFQ = { ...mockRFQDraft, status: "REVIEWED" };
            const mockFindUniqueOrThrow = vi.fn().mockResolvedValue(submittedRFQ);
            const mockUpdate = vi.fn().mockResolvedValue({ ...submittedRFQ, status: "APPROVED" });

            // @ts-ignore
            prisma.purchaseRFQ = {
                findUniqueOrThrow: mockFindUniqueOrThrow,
                update: mockUpdate,
            };

            await RFQService.updateStatus(1, { status: "APPROVED" }, mockUser.id);

            const updateArg = mockUpdate.mock.calls[0]?.[0];
            expect(updateArg?.data?.approved_by).toBe(mockUser.id);
            expect(updateArg?.data?.approved_at).toBeDefined();
        });

        it("should throw on invalid transition DRAFT -> APPROVED", async () => {
            const mockFindUniqueOrThrow = vi.fn().mockResolvedValue(mockRFQDraft);

            // @ts-ignore
            prisma.purchaseRFQ = {
                findUniqueOrThrow: mockFindUniqueOrThrow,
            };

            await expect(
                RFQService.updateStatus(1, { status: "APPROVED" }, mockUser.id)
            ).rejects.toThrow(ApiError);
        });
    });

    describe("destroy", () => {
        it("should delete a DRAFT RFQ successfully", async () => {
            const mockFindUniqueOrThrow = vi.fn().mockResolvedValue(mockRFQDraft);
            const mockDelete = vi.fn().mockResolvedValue(mockRFQDraft);

            // @ts-ignore
            prisma.purchaseRFQ = {
                findUniqueOrThrow: mockFindUniqueOrThrow,
                delete: mockDelete,
            };

            const result = await RFQService.destroy(1);

            expect(mockDelete).toHaveBeenCalledWith({ where: { id: 1 } });
            expect(result.supplier_name).toMatch(SUPPLIER_OBSCURE_REGEX);
            expect(result.supplier_name).toHaveLength(7);
        });

        it("should throw when trying to delete a non-DRAFT RFQ", async () => {
            const submittedRFQ = { ...mockRFQDraft, status: "SUBMITTED" };
            const mockFindUniqueOrThrow = vi.fn().mockResolvedValue(submittedRFQ);

            // @ts-ignore
            prisma.purchaseRFQ = {
                findUniqueOrThrow: mockFindUniqueOrThrow,
            };

            await expect(RFQService.destroy(1)).rejects.toThrow(ApiError);
        });
    });
});
