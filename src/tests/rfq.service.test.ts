import { describe, it, expect, vi, beforeEach } from "vitest";
import { RFQService } from "../module/application/purchase/rfq/rfq.service.js";
import prisma from "../config/prisma.js";

const mockRFQDraft = {
    id: 1,
    rfq_number: "RFQ-20260422-1234",
    vendor_id: null,
    warehouse_id: null,
    date: new Date("2026-04-22"),
    status: "DRAFT",
    notes: null,
    created_at: new Date("2026-04-22"),
    updated_at: new Date("2026-04-22"),
};

const mockRFQApproved = {
    ...mockRFQDraft,
    id: 2,
    status: "APPROVED",
    items: [
        {
            id: 10,
            rfq_id: 2,
            raw_material_id: 5,
            quantity: 100,
            unit_price: 5000,
            notes: null,
            purchase_draft_id: null,
            raw_material: { id: 5, name: "Material A" },
        },
    ],
};

describe("RFQService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ─── list ────────────────────────────────────────────────────────────────

    describe("list", () => {
        it("should return paginated data", async () => {
            const mockData = [mockRFQDraft];
            const mockFindMany = vi.fn().mockResolvedValue(mockData);
            const mockCount = vi.fn().mockResolvedValue(1);

            // @ts-ignore
            prisma.requestForQuotation = {
                findMany: mockFindMany,
                count: mockCount,
            };

            const result = await RFQService.list({
                page: 1,
                take: 10,
                order: "desc",
            });

            expect(result.data).toEqual(mockData);
            expect(result.total).toBe(1);
            expect(mockFindMany).toHaveBeenCalledOnce();
            expect(mockCount).toHaveBeenCalledOnce();
        });

        it("should apply status filter when provided", async () => {
            const mockFindMany = vi.fn().mockResolvedValue([]);
            const mockCount = vi.fn().mockResolvedValue(0);

            // @ts-ignore
            prisma.requestForQuotation = {
                findMany: mockFindMany,
                count: mockCount,
            };

            await RFQService.list({ page: 1, take: 10, status: "SENT", order: "desc" });

            const calledWith = mockFindMany.mock.calls[0]?.[0];
            expect(calledWith?.where?.status).toBe("SENT");
        });

        it("should apply search filter when provided", async () => {
            const mockFindMany = vi.fn().mockResolvedValue([]);
            const mockCount = vi.fn().mockResolvedValue(0);

            // @ts-ignore
            prisma.requestForQuotation = {
                findMany: mockFindMany,
                count: mockCount,
            };

            await RFQService.list({ page: 1, take: 10, search: "RFQ-2026", order: "desc" });

            const calledWith = mockFindMany.mock.calls[0]?.[0];
            expect(calledWith?.where?.OR).toBeDefined();
            expect(calledWith?.where?.OR?.[0]?.rfq_number?.contains).toBe("RFQ-2026");
        });
    });

    // ─── create ──────────────────────────────────────────────────────────────

    describe("create", () => {
        it("should create an RFQ successfully", async () => {
            const mockCreated = { ...mockRFQDraft, items: [], vendor: null };
            const mockFindFirst = vi.fn().mockResolvedValue(null);
            const mockCreate = vi.fn().mockResolvedValue(mockCreated);

            // @ts-ignore
            prisma.rFQItem = { findFirst: mockFindFirst };
            // @ts-ignore
            prisma.requestForQuotation = { create: mockCreate };

            const result = await RFQService.create({
                items: [{ raw_material_id: 1, quantity: 50 }],
            });

            expect(result).toEqual(mockCreated);
            expect(mockCreate).toHaveBeenCalledOnce();
            const createArg = mockCreate.mock.calls[0]?.[0];
            expect(createArg?.data?.items?.create).toHaveLength(1);
            expect(createArg?.data?.items?.create?.[0]?.raw_material_id).toBe(1);
            expect(createArg?.data?.items?.create?.[0]?.quantity).toBe(50);
        });

        it("should throw an error when purchase_draft_id is already linked", async () => {
            const mockFindFirst = vi.fn().mockResolvedValue({
                id: 99,
                purchase_draft_id: 5,
            });

            // @ts-ignore
            prisma.rFQItem = { findFirst: mockFindFirst };

            await expect(
                RFQService.create({
                    items: [{ raw_material_id: 1, quantity: 50, purchase_draft_id: 5 }],
                })
            ).rejects.toThrow("already linked to an RFQ item");
        });

        it("should skip duplicate draft check when no purchase_draft_ids", async () => {
            const mockFindFirst = vi.fn();
            const mockCreate = vi.fn().mockResolvedValue({ ...mockRFQDraft, items: [] });

            // @ts-ignore
            prisma.rFQItem = { findFirst: mockFindFirst };
            // @ts-ignore
            prisma.requestForQuotation = { create: mockCreate };

            await RFQService.create({
                items: [{ raw_material_id: 2, quantity: 10 }],
            });

            expect(mockFindFirst).not.toHaveBeenCalled();
        });
    });

    // ─── updateStatus ────────────────────────────────────────────────────────

    describe("updateStatus", () => {
        it("should transition DRAFT -> SENT successfully", async () => {
            const mockUpdated = { ...mockRFQDraft, status: "SENT" };
            const mockFindUniqueOrThrow = vi.fn().mockResolvedValue(mockRFQDraft);
            const mockUpdate = vi.fn().mockResolvedValue(mockUpdated);

            // @ts-ignore
            prisma.requestForQuotation = {
                findUniqueOrThrow: mockFindUniqueOrThrow,
                update: mockUpdate,
            };

            const result = await RFQService.updateStatus(1, { status: "SENT" });

            expect(result.status).toBe("SENT");
            expect(mockUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: 1 },
                    data: { status: "SENT" },
                })
            );
        });

        it("should throw on invalid transition DRAFT -> APPROVED", async () => {
            const mockFindUniqueOrThrow = vi.fn().mockResolvedValue(mockRFQDraft);

            // @ts-ignore
            prisma.requestForQuotation = {
                findUniqueOrThrow: mockFindUniqueOrThrow,
            };

            await expect(
                RFQService.updateStatus(1, { status: "APPROVED" })
            ).rejects.toThrow("Cannot transition from DRAFT to APPROVED");
        });

        it("should throw on invalid transition CONVERTED -> SENT", async () => {
            const convertedRFQ = { ...mockRFQDraft, status: "CONVERTED" };
            const mockFindUniqueOrThrow = vi.fn().mockResolvedValue(convertedRFQ);

            // @ts-ignore
            prisma.requestForQuotation = {
                findUniqueOrThrow: mockFindUniqueOrThrow,
            };

            await expect(
                RFQService.updateStatus(1, { status: "SENT" })
            ).rejects.toThrow("Allowed: none");
        });
    });

    // ─── convertToPO ─────────────────────────────────────────────────────────

    describe("convertToPO", () => {
        it("should create open POs and set status to CONVERTED when all items selected", async () => {
            const mockFindUniqueOrThrow = vi.fn().mockResolvedValue(mockRFQApproved);
            const mockTxCreate = vi.fn().mockResolvedValue({ id: 20, raw_material_id: 5, quantity: 100 });
            const mockTxUpdate = vi.fn().mockResolvedValue({ ...mockRFQApproved, status: "CONVERTED" });

            const txMock = {
                rawMaterialOpenPo: { create: mockTxCreate },
                requestForQuotation: { update: mockTxUpdate },
            };
            const mockTransaction = vi.fn().mockImplementation((cb) => cb(txMock));

            // @ts-ignore
            prisma.requestForQuotation = { findUniqueOrThrow: mockFindUniqueOrThrow };
            // @ts-ignore
            prisma.$transaction = mockTransaction;

            const result = await RFQService.convertToPO(2, { item_ids: [10] });

            expect(result.rfq_status).toBe("CONVERTED");
            expect(result.created_pos).toHaveLength(1);
            expect(mockTxCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        raw_material_id: 5,
                        rfq_id: 2,
                        status: "OPEN",
                    }),
                })
            );
        });

        it("should set PARTIAL_CONVERTED when only some items are selected", async () => {
            const rfqWithTwoItems = {
                ...mockRFQApproved,
                items: [
                    ...mockRFQApproved.items,
                    { id: 11, rfq_id: 2, raw_material_id: 6, quantity: 200, unit_price: null, notes: null, purchase_draft_id: null, raw_material: { id: 6, name: "Material B" } },
                ],
            };
            const mockFindUniqueOrThrow = vi.fn().mockResolvedValue(rfqWithTwoItems);
            const mockTxCreate = vi.fn().mockResolvedValue({ id: 21, raw_material_id: 5, quantity: 100 });
            const mockTxUpdate = vi.fn().mockResolvedValue({ ...rfqWithTwoItems, status: "PARTIAL_CONVERTED" });

            const txMock = {
                rawMaterialOpenPo: { create: mockTxCreate },
                requestForQuotation: { update: mockTxUpdate },
            };
            const mockTransaction = vi.fn().mockImplementation((cb) => cb(txMock));

            // @ts-ignore
            prisma.requestForQuotation = { findUniqueOrThrow: mockFindUniqueOrThrow };
            // @ts-ignore
            prisma.$transaction = mockTransaction;

            const result = await RFQService.convertToPO(2, { item_ids: [10] }); // only item 10

            expect(result.rfq_status).toBe("PARTIAL_CONVERTED");
        });

        it("should throw when RFQ status is not APPROVED or PARTIAL_CONVERTED", async () => {
            const draftRFQ = { ...mockRFQApproved, status: "DRAFT", items: mockRFQApproved.items };
            const mockFindUniqueOrThrow = vi.fn().mockResolvedValue(draftRFQ);

            // @ts-ignore
            prisma.requestForQuotation = { findUniqueOrThrow: mockFindUniqueOrThrow };

            await expect(
                RFQService.convertToPO(2, { item_ids: [10] })
            ).rejects.toThrow("RFQ must be APPROVED or PARTIAL_CONVERTED");
        });

        it("should throw when item_ids do not match any RFQ items", async () => {
            const mockFindUniqueOrThrow = vi.fn().mockResolvedValue(mockRFQApproved);

            // @ts-ignore
            prisma.requestForQuotation = { findUniqueOrThrow: mockFindUniqueOrThrow };

            await expect(
                RFQService.convertToPO(2, { item_ids: [999] }) // non-existent item
            ).rejects.toThrow("No valid items found for conversion");
        });
    });

    // ─── destroy ─────────────────────────────────────────────────────────────

    describe("destroy", () => {
        it("should delete a DRAFT RFQ successfully", async () => {
            const mockFindUniqueOrThrow = vi.fn().mockResolvedValue(mockRFQDraft);
            const mockDelete = vi.fn().mockResolvedValue(mockRFQDraft);

            // @ts-ignore
            prisma.requestForQuotation = {
                findUniqueOrThrow: mockFindUniqueOrThrow,
                delete: mockDelete,
            };

            const result = await RFQService.destroy(1);

            expect(mockDelete).toHaveBeenCalledWith({ where: { id: 1 } });
            expect(result).toEqual(mockRFQDraft);
        });

        it("should throw when trying to delete a non-DRAFT RFQ", async () => {
            const sentRFQ = { ...mockRFQDraft, status: "SENT" };
            const mockFindUniqueOrThrow = vi.fn().mockResolvedValue(sentRFQ);

            // @ts-ignore
            prisma.requestForQuotation = {
                findUniqueOrThrow: mockFindUniqueOrThrow,
            };

            await expect(RFQService.destroy(1)).rejects.toThrow(
                "Only DRAFT RFQs can be deleted"
            );
        });

        it("should throw when trying to delete a CONVERTED RFQ", async () => {
            const convertedRFQ = { ...mockRFQDraft, status: "CONVERTED" };
            const mockFindUniqueOrThrow = vi.fn().mockResolvedValue(convertedRFQ);

            // @ts-ignore
            prisma.requestForQuotation = {
                findUniqueOrThrow: mockFindUniqueOrThrow,
            };

            await expect(RFQService.destroy(1)).rejects.toThrow(
                "Only DRAFT RFQs can be deleted"
            );
        });
    });
});
