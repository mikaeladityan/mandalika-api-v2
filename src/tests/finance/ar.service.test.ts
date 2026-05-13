import { describe, it, expect, vi, beforeEach } from "vitest";
import { FinanceARService } from "../../module/application/finance/ar/ar.service.js";
import prisma from "../../config/prisma.js";
import { ApiError } from "../../lib/errors/api.error.js";

const mockAR = {
    id: 1,
    ar_number: "AR-20260513-001",
    partner_type: "CUSTOMER",
    partner_id: null,
    partner_name: "PT Customer XYZ",
    source_doc: "SO-001",
    amount: 2000000,
    received_amount: 0,
    balance: 2000000,
    status: "OPEN",
    due_date: new Date("2026-06-01"),
    last_receipt_date: null,
    notes: null,
    created_by: "user-123",
    updated_by: null,
    created_at: new Date("2026-05-13"),
    updated_at: new Date("2026-05-13"),
};

describe("FinanceARService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("list", () => {
        it("should return paginated data", async () => {
            // @ts-ignore
            prisma.accountReceivable = {
                findMany: vi.fn().mockResolvedValue([mockAR]),
                count: vi.fn().mockResolvedValue(1),
            };

            const result = await FinanceARService.list({ page: 1, take: 10, order: "asc", sortBy: "due_date" });

            expect(result.data).toHaveLength(1);
            expect(result.total).toBe(1);
        });

        it("should apply status filter", async () => {
            const mockFindMany = vi.fn().mockResolvedValue([]);
            const mockCount = vi.fn().mockResolvedValue(0);
            // @ts-ignore
            prisma.accountReceivable = { findMany: mockFindMany, count: mockCount };

            await FinanceARService.list({ page: 1, take: 10, status: "OPEN", order: "asc", sortBy: "due_date" });

            expect(mockFindMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: expect.objectContaining({ status: "OPEN" }) }),
            );
        });
    });

    describe("detail", () => {
        it("should return AR detail", async () => {
            // @ts-ignore
            prisma.accountReceivable = { findUniqueOrThrow: vi.fn().mockResolvedValue(mockAR) };

            const result = await FinanceARService.detail(1);
            expect(result).toEqual(mockAR);
        });
    });

    describe("recordReceipt", () => {
        const dto = {
            received_amount: 1000000,
            receipt_date: "2026-05-13",
            payment_method: "TRANSFER" as const,
            bank_account: "BCA-001",
            notes: null,
        };

        it("should throw if AR already CLOSED", async () => {
            // @ts-ignore
            prisma.accountReceivable = {
                findUniqueOrThrow: vi.fn().mockResolvedValue({ ...mockAR, status: "CLOSED" }),
            };

            await expect(FinanceARService.recordReceipt(1, dto, "user-123")).rejects.toThrow(ApiError);
        });

        it("should throw if receipt exceeds balance", async () => {
            // @ts-ignore
            prisma.accountReceivable = {
                findUniqueOrThrow: vi.fn().mockResolvedValue(mockAR),
            };

            await expect(
                FinanceARService.recordReceipt(1, { ...dto, received_amount: 9999999 }, "user-123"),
            ).rejects.toThrow(ApiError);
        });

        it("should update AR, create CashEntry RECEIPT, create JournalEntry", async () => {
            // @ts-ignore
            prisma.accountReceivable = {
                findUniqueOrThrow: vi.fn().mockResolvedValue(mockAR),
            };

            const mockUpdated = { ...mockAR, received_amount: 1000000, balance: 1000000, status: "PARTIAL" };
            const mockTx = {
                accountReceivable: { update: vi.fn().mockResolvedValue(mockUpdated) },
                cashEntry: { create: vi.fn().mockResolvedValue({ id: 1 }), count: vi.fn().mockResolvedValue(0) },
                journalEntry: { create: vi.fn().mockResolvedValue({ id: 1 }), count: vi.fn().mockResolvedValue(0) },
            };
            // @ts-ignore
            prisma.$transaction = vi.fn().mockImplementation(async (cb) => cb(mockTx));

            const result = await FinanceARService.recordReceipt(1, dto, "user-123");

            expect(mockTx.accountReceivable.update).toHaveBeenCalledOnce();
            expect(mockTx.cashEntry.create).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ type: "RECEIPT" }) }),
            );
            expect(mockTx.journalEntry.create).toHaveBeenCalledOnce();
            expect(result).toEqual(mockUpdated);
        });

        it("should set status CLOSED when balance reaches zero", async () => {
            // @ts-ignore
            prisma.accountReceivable = {
                findUniqueOrThrow: vi.fn().mockResolvedValue(mockAR),
            };

            const mockUpdated = { ...mockAR, received_amount: 2000000, balance: 0, status: "CLOSED" };
            const mockTx = {
                accountReceivable: { update: vi.fn().mockResolvedValue(mockUpdated) },
                cashEntry: { create: vi.fn().mockResolvedValue({ id: 1 }), count: vi.fn().mockResolvedValue(0) },
                journalEntry: { create: vi.fn().mockResolvedValue({ id: 1 }), count: vi.fn().mockResolvedValue(0) },
            };
            // @ts-ignore
            prisma.$transaction = vi.fn().mockImplementation(async (cb) => cb(mockTx));

            await FinanceARService.recordReceipt(1, { ...dto, received_amount: 2000000 }, "user-123");

            expect(mockTx.accountReceivable.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ status: "CLOSED" }) }),
            );
        });
    });

    describe("create", () => {
        it("should create AR with OPEN status", async () => {
            const mockCreated = { ...mockAR, id: 2 };
            // @ts-ignore
            prisma.accountReceivable = {
                create: vi.fn().mockResolvedValue(mockCreated),
                count: vi.fn().mockResolvedValue(0),
            };

            const result = await FinanceARService.create(
                {
                    partner_type: "CUSTOMER",
                    partner_name: "PT Customer XYZ",
                    source_doc: "SO-001",
                    amount: 2000000,
                },
                "user-123",
            );

            expect(result).toEqual(mockCreated);
            // @ts-ignore
            expect(prisma.accountReceivable.create).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ status: "OPEN" }) }),
            );
        });
    });
});
