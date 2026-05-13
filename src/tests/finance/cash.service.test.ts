import { describe, it, expect, vi, beforeEach } from "vitest";
import { FinanceCashService } from "../../module/application/finance/cash/cash.service.js";
import prisma from "../../config/prisma.js";
import { ApiError } from "../../lib/errors/api.error.js";

const mockEntry = {
    id: 1,
    cash_number: "CB-20260513-001",
    cash_date: new Date("2026-05-13"),
    type: "PAYMENT",
    source: "Vendor Payment",
    reference: "AP-20260513-001",
    amount: 500000,
    payment_method: "TRANSFER",
    bank_account: "BCA-001",
    status: "DRAFT",
    posted_at: null,
    notes: null,
    created_by: "user-123",
    updated_by: null,
    created_at: new Date("2026-05-13"),
    updated_at: new Date("2026-05-13"),
};

describe("FinanceCashService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("list", () => {
        it("should return paginated data", async () => {
            // @ts-ignore
            prisma.cashEntry = {
                findMany: vi.fn().mockResolvedValue([mockEntry]),
                count: vi.fn().mockResolvedValue(1),
            };

            const result = await FinanceCashService.list({ page: 1, take: 10, order: "desc", sortBy: "cash_date" });

            expect(result.data).toHaveLength(1);
            expect(result.total).toBe(1);
        });

        it("should apply type and status filters", async () => {
            const mockFindMany = vi.fn().mockResolvedValue([]);
            const mockCount = vi.fn().mockResolvedValue(0);
            // @ts-ignore
            prisma.cashEntry = { findMany: mockFindMany, count: mockCount };

            await FinanceCashService.list({ page: 1, take: 10, type: "PAYMENT", status: "DRAFT", order: "desc", sortBy: "cash_date" });

            expect(mockFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ type: "PAYMENT", status: "DRAFT" }),
                }),
            );
        });

        it("should apply date_from / date_to range", async () => {
            const mockFindMany = vi.fn().mockResolvedValue([]);
            const mockCount = vi.fn().mockResolvedValue(0);
            // @ts-ignore
            prisma.cashEntry = { findMany: mockFindMany, count: mockCount };

            const dateFrom = new Date("2026-05-01");
            const dateTo = new Date("2026-05-31");
            await FinanceCashService.list({ page: 1, take: 10, date_from: dateFrom, date_to: dateTo, order: "desc", sortBy: "cash_date" });

            expect(mockFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ cash_date: { gte: dateFrom, lte: dateTo } }),
                }),
            );
        });
    });

    describe("create", () => {
        it("should create cash entry with DRAFT status", async () => {
            const mockCreated = { ...mockEntry, id: 2 };
            // @ts-ignore
            prisma.cashEntry = {
                create: vi.fn().mockResolvedValue(mockCreated),
                count: vi.fn().mockResolvedValue(0),
            };

            const result = await FinanceCashService.create(
                {
                    cash_date: new Date("2026-05-13"),
                    type: "PAYMENT",
                    source: "Vendor Payment",
                    amount: 500000,
                    payment_method: "TRANSFER",
                },
                "user-123",
            );

            expect(result).toEqual(mockCreated);
            // @ts-ignore
            expect(prisma.cashEntry.create).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ status: "DRAFT" }) }),
            );
        });

        it("should throw if amount is zero or negative (Zod validation)", async () => {
            // Zod schema validation — negative amount rejected at schema level
            const { CreateCashSchema } = await import("../../module/application/finance/cash/cash.schema.js");
            expect(() => CreateCashSchema.parse({ cash_date: new Date(), type: "PAYMENT", source: "x", amount: 0 })).toThrow();
            expect(() => CreateCashSchema.parse({ cash_date: new Date(), type: "PAYMENT", source: "x", amount: -1 })).toThrow();
        });
    });

    describe("post", () => {
        it("should transition DRAFT to POSTED", async () => {
            const mockUpdated = { ...mockEntry, status: "POSTED", posted_at: new Date() };
            // @ts-ignore
            prisma.cashEntry = {
                findUniqueOrThrow: vi.fn().mockResolvedValue(mockEntry),
                update: vi.fn().mockResolvedValue(mockUpdated),
            };

            const result = await FinanceCashService.post(1, "user-123");

            expect(result.status).toBe("POSTED");
            // @ts-ignore
            expect(prisma.cashEntry.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ status: "POSTED" }) }),
            );
        });

        it("should throw if already POSTED", async () => {
            // @ts-ignore
            prisma.cashEntry = {
                findUniqueOrThrow: vi.fn().mockResolvedValue({ ...mockEntry, status: "POSTED" }),
            };

            await expect(FinanceCashService.post(1, "user-123")).rejects.toThrow(ApiError);
        });
    });
});
