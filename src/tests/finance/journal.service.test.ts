import { describe, it, expect, vi, beforeEach } from "vitest";
import { FinanceJournalService } from "../../module/application/finance/journal/journal.service.js";
import prisma from "../../config/prisma.js";
import { ApiError } from "../../lib/errors/api.error.js";

const mockEntry = {
    id: 1,
    journal_number: "JV-20260513-001",
    journal_date: new Date("2026-05-13"),
    source: "AP-20260513-001",
    desc: "Pembayaran vendor PT Supplier ABC",
    debit: 500000,
    credit: 500000,
    status: "DRAFT",
    posted_at: null,
    notes: null,
    created_by: "user-123",
    updated_by: null,
    created_at: new Date("2026-05-13"),
    updated_at: new Date("2026-05-13"),
};

describe("FinanceJournalService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("list", () => {
        it("should return paginated data", async () => {
            // @ts-ignore
            prisma.journalEntry = {
                findMany: vi.fn().mockResolvedValue([mockEntry]),
                count: vi.fn().mockResolvedValue(1),
            };

            const result = await FinanceJournalService.list({ page: 1, take: 10, order: "desc", sortBy: "journal_date" });

            expect(result.data).toHaveLength(1);
            expect(result.total).toBe(1);
        });

        it("should apply status filter", async () => {
            const mockFindMany = vi.fn().mockResolvedValue([]);
            const mockCount = vi.fn().mockResolvedValue(0);
            // @ts-ignore
            prisma.journalEntry = { findMany: mockFindMany, count: mockCount };

            await FinanceJournalService.list({ page: 1, take: 10, status: "POSTED", order: "desc", sortBy: "journal_date" });

            expect(mockFindMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: expect.objectContaining({ status: "POSTED" }) }),
            );
        });

        it("should apply date range filter", async () => {
            const mockFindMany = vi.fn().mockResolvedValue([]);
            const mockCount = vi.fn().mockResolvedValue(0);
            // @ts-ignore
            prisma.journalEntry = { findMany: mockFindMany, count: mockCount };

            const dateFrom = new Date("2026-05-01");
            const dateTo = new Date("2026-05-31");
            await FinanceJournalService.list({ page: 1, take: 10, date_from: dateFrom, date_to: dateTo, order: "desc", sortBy: "journal_date" });

            expect(mockFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ journal_date: { gte: dateFrom, lte: dateTo } }),
                }),
            );
        });
    });

    describe("create", () => {
        it("should create journal entry with DRAFT status", async () => {
            const mockCreated = { ...mockEntry, id: 2 };
            // @ts-ignore
            prisma.journalEntry = {
                create: vi.fn().mockResolvedValue(mockCreated),
                count: vi.fn().mockResolvedValue(0),
            };

            const result = await FinanceJournalService.create(
                {
                    journal_date: new Date("2026-05-13"),
                    source: "MANUAL",
                    desc: "Manual journal entry",
                    debit: 500000,
                    credit: 500000,
                },
                "user-123",
            );

            expect(result).toEqual(mockCreated);
            // @ts-ignore
            expect(prisma.journalEntry.create).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ status: "DRAFT" }) }),
            );
        });

        it("should allow debit != credit (no constraint at service level)", async () => {
            const mockCreated = { ...mockEntry, debit: 1000000, credit: 500000 };
            // @ts-ignore
            prisma.journalEntry = {
                create: vi.fn().mockResolvedValue(mockCreated),
                count: vi.fn().mockResolvedValue(0),
            };

            const result = await FinanceJournalService.create(
                { journal_date: new Date(), source: "ADJ", desc: "Adjustment", debit: 1000000, credit: 500000 },
                "user-123",
            );

            expect(result.debit).toBe(1000000);
            expect(result.credit).toBe(500000);
        });
    });

    describe("post", () => {
        it("should transition DRAFT to POSTED", async () => {
            const mockUpdated = { ...mockEntry, status: "POSTED", posted_at: new Date() };
            // @ts-ignore
            prisma.journalEntry = {
                findUniqueOrThrow: vi.fn().mockResolvedValue(mockEntry),
                update: vi.fn().mockResolvedValue(mockUpdated),
            };

            const result = await FinanceJournalService.post(1, "user-123");

            expect(result.status).toBe("POSTED");
            // @ts-ignore
            expect(prisma.journalEntry.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ status: "POSTED" }) }),
            );
        });

        it("should throw if already POSTED", async () => {
            // @ts-ignore
            prisma.journalEntry = {
                findUniqueOrThrow: vi.fn().mockResolvedValue({ ...mockEntry, status: "POSTED" }),
            };

            await expect(FinanceJournalService.post(1, "user-123")).rejects.toThrow(ApiError);
        });
    });
});
