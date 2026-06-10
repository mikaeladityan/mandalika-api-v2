import { describe, it, expect, vi, beforeEach } from "vitest";
import { FinanceAPService } from "../../module/application/finance/ap/ap.service.js";
import prisma from "../../config/prisma.js";
import { ApiError } from "../../lib/errors/api.error.js";
import { SUPPLIER_OBSCURE_REGEX } from "../../lib/utils/supplier-obscure.js";

const mockAP = {
    id: 1,
    ap_number: "AP-20260513-001",
    po_id: 1,
    receipt_id: 1,
    supplier_id: 1,
    supplier_name: "PT Supplier ABC",
    ap_type: "GOODS_RECEIPT",
    invoice_number: null,
    invoice_date: null,
    due_date: null,
    amount: 1000000,
    paid_amount: 0,
    balance: 1000000,
    status: "UNPAID",
    last_paid_date: null,
    last_payment_method: null,
    notes: null,
    created_by: "user-123",
    updated_by: null,
    created_at: new Date("2026-05-13"),
    updated_at: new Date("2026-05-13"),
};

describe("FinanceAPService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("list", () => {
        it("should return paginated data", async () => {
            const mockData = [mockAP];
            // @ts-ignore
            prisma.accountPayable = {
                findMany: vi.fn().mockResolvedValue(mockData),
                count: vi.fn().mockResolvedValue(1),
            };

            const result = await FinanceAPService.list({ page: 1, take: 10, order: "asc" });

            expect(result.total).toBe(1);
            expect(result.data).toHaveLength(1);
            expect(result.data[0].supplier_name).toMatch(SUPPLIER_OBSCURE_REGEX);
            expect(result.data[0].supplier_name).toHaveLength(7);
            expect(result.data[0].supplier_name).not.toBe("PT Supplier ABC");
        });

        it("should apply status filter", async () => {
            const mockFindMany = vi.fn().mockResolvedValue([]);
            const mockCount = vi.fn().mockResolvedValue(0);
            // @ts-ignore
            prisma.accountPayable = { findMany: mockFindMany, count: mockCount };

            await FinanceAPService.list({ page: 1, take: 10, status: "UNPAID", order: "asc" });

            expect(mockFindMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: expect.objectContaining({ status: "UNPAID" }) }),
            );
        });

        it("should apply search across ap_number, supplier_name, invoice_number", async () => {
            const mockFindMany = vi.fn().mockResolvedValue([]);
            const mockCount = vi.fn().mockResolvedValue(0);
            // @ts-ignore
            prisma.accountPayable = { findMany: mockFindMany, count: mockCount };

            await FinanceAPService.list({ page: 1, take: 10, search: "ABC", order: "asc" });

            expect(mockFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ OR: expect.arrayContaining([expect.objectContaining({ supplier_name: expect.anything() })]) }),
                }),
            );
        });

        it("masks supplier identity in list response", async () => {
            const mockFindMany = vi.fn().mockResolvedValue([
                {
                    ...mockAP,
                    id: 1, supplier_id: 42, supplier_name: "PT Real Vendor",
                    supplier: { id: 42, name: "PT Real Vendor" },
                    po: null, receipt: null, payment_term: null,
                },
                {
                    ...mockAP,
                    id: 2, supplier_id: 1000, supplier_name: "PT Other Vendor",
                    supplier: { id: 1000, name: "PT Other Vendor" },
                    po: null, receipt: null, payment_term: null,
                },
            ]);
            const mockCount = vi.fn().mockResolvedValue(2);
            // @ts-ignore
            prisma.accountPayable = { findMany: mockFindMany, count: mockCount };

            const { data } = await FinanceAPService.list({
                page: 1, take: 10, sortBy: "due_date", order: "asc",
            } as any);

            for (const row of data) {
                expect(row.supplier_name).toMatch(SUPPLIER_OBSCURE_REGEX);
                expect(row.supplier_name).toHaveLength(7);
                expect(row.supplier_name).not.toBe("PT Real Vendor");
                expect(row.supplier_name).not.toBe("PT Other Vendor");
                if (row.supplier) {
                    expect(row.supplier.name).toMatch(SUPPLIER_OBSCURE_REGEX);
                }
            }
            expect(data[0].supplier_name).toBe("SUP-042");
            expect(data[1].supplier_name).toBe("SUP1000");
        });
    });

    describe("detail", () => {
        it("should return AP detail", async () => {
            // @ts-ignore
            prisma.accountPayable = { findUniqueOrThrow: vi.fn().mockResolvedValue(mockAP) };

            const result = await FinanceAPService.detail(1);
            expect(result.supplier_name).toMatch(SUPPLIER_OBSCURE_REGEX);
            expect(result.supplier_name).toHaveLength(7);
            expect(result.supplier_name).not.toBe("PT Supplier ABC");
        });

        it("should throw if AP not found", async () => {
            // @ts-ignore
            prisma.accountPayable = {
                findUniqueOrThrow: vi.fn().mockRejectedValue(new Error("Not found")),
            };

            await expect(FinanceAPService.detail(999)).rejects.toThrow();
        });
    });

    describe("recordPayment", () => {
        const dto = {
            paid_amount: 500000,
            payment_date: "2026-05-13",
            payment_method: "TRANSFER" as const,
            bank_account: "BCA-001",
            invoice_number: "INV-001",
            invoice_date: new Date("2026-05-10"),
            due_date: new Date("2026-05-20"),
            notes: null,
        };

        it("should throw if AP already PAID", async () => {
            // @ts-ignore
            prisma.accountPayable = {
                findUniqueOrThrow: vi.fn().mockResolvedValue({ ...mockAP, status: "PAID" }),
            };

            await expect(FinanceAPService.recordPayment(1, dto, "user-123")).rejects.toThrow(ApiError);
        });

        it("should throw if payment exceeds balance", async () => {
            // @ts-ignore
            prisma.accountPayable = {
                findUniqueOrThrow: vi.fn().mockResolvedValue({ ...mockAP, amount: 1000000, paid_amount: 0 }),
            };

            await expect(
                FinanceAPService.recordPayment(1, { ...dto, paid_amount: 2000000 }, "user-123"),
            ).rejects.toThrow(ApiError);
        });

        it("should update AP, create CashEntry, create JournalEntry, sync PurchaseTracking", async () => {
            // @ts-ignore
            prisma.accountPayable = {
                findUniqueOrThrow: vi.fn().mockResolvedValue(mockAP),
            };

            const mockUpdated = { ...mockAP, paid_amount: 500000, balance: 500000, status: "DP_PAID" };
            const mockTx = {
                accountPayable: {
                    update: vi.fn().mockResolvedValue(mockUpdated),
                    findMany: vi.fn().mockResolvedValue([{ status: "DP_PAID" }]),
                },
                cashEntry: { create: vi.fn().mockResolvedValue({ id: 1 }) },
                journalEntry: { create: vi.fn().mockResolvedValue({ id: 1 }) },
                purchaseTracking: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
            };

            // @ts-ignore
            prisma.$transaction = vi.fn().mockImplementation(async (cb) => cb(mockTx));

            // Mock number generators
            vi.mock("../../lib/utils/generate-number.js", () => ({
                generateCashNumber: vi.fn().mockResolvedValue("CB-20260513-001"),
                generateJournalNumber: vi.fn().mockResolvedValue("JV-20260513-001"),
                generateAPNumber: vi.fn().mockResolvedValue("AP-20260513-001"),
            }));

            const result = await FinanceAPService.recordPayment(1, dto, "user-123");

            expect(prisma.$transaction).toHaveBeenCalledOnce();
            expect(mockTx.accountPayable.update).toHaveBeenCalledOnce();
            expect(mockTx.cashEntry.create).toHaveBeenCalledOnce();
            expect(mockTx.journalEntry.create).toHaveBeenCalledOnce();
            expect(mockTx.purchaseTracking.updateMany).toHaveBeenCalledOnce();
            expect(result.supplier_name).toMatch(SUPPLIER_OBSCURE_REGEX);
            expect(result.supplier_name).toHaveLength(7);
            expect(result.supplier_name).not.toBe("PT Supplier ABC");
            expect(result.status).toBe("DP_PAID");
        });

        it("should set status PAID when balance reaches zero", async () => {
            // @ts-ignore
            prisma.accountPayable = {
                findUniqueOrThrow: vi.fn().mockResolvedValue(mockAP),
            };

            const mockUpdated = { ...mockAP, paid_amount: 1000000, balance: 0, status: "PAID" };
            const mockTx = {
                accountPayable: {
                    update: vi.fn().mockResolvedValue(mockUpdated),
                    findMany: vi.fn().mockResolvedValue([{ status: "PAID" }]),
                },
                cashEntry: { create: vi.fn().mockResolvedValue({ id: 1 }) },
                journalEntry: { create: vi.fn().mockResolvedValue({ id: 1 }) },
                purchaseTracking: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
            };
            // @ts-ignore
            prisma.$transaction = vi.fn().mockImplementation(async (cb) => cb(mockTx));

            await FinanceAPService.recordPayment(1, { ...dto, paid_amount: 1000000 }, "user-123");

            expect(mockTx.accountPayable.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ status: "PAID" }) }),
            );
        });
    });

    describe("createFromReceipt", () => {
        it("should create AP for each PO group in receipt", async () => {
            const mockReceipt = {
                id: 1,
                items: [
                    { id: 1, po_id: 10, amount: 500000, raw_material_id: null },
                    { id: 2, po_id: 10, amount: 300000, raw_material_id: null },
                ],
                po: { id: 10, supplier_id: 1, supplier_name: "PT Vendor" },
            };

            const mockDb = {
                purchaseReceipt: { findUniqueOrThrow: vi.fn().mockResolvedValue(mockReceipt) },
                accountPayable: {
                    findFirst: vi.fn().mockResolvedValue(null),
                    create: vi.fn().mockResolvedValue({ id: 1 }),
                    count: vi.fn().mockResolvedValue(0),
                },
            };

            await FinanceAPService.createFromReceipt(1, "user-123", mockDb as any);

            expect(mockDb.accountPayable.findFirst).toHaveBeenCalledOnce();
            expect(mockDb.accountPayable.create).toHaveBeenCalledOnce();
            expect(mockDb.accountPayable.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ po_id: 10, amount: 800000, status: "UNPAID" }),
                }),
            );
        });

        it("should skip if AP already exists (idempotency)", async () => {
            const mockReceipt = {
                id: 1,
                items: [{ id: 1, po_id: 10, amount: 500000, raw_material_id: null }],
                po: { id: 10, supplier_id: 1, supplier_name: "PT Vendor" },
            };

            const mockDb = {
                purchaseReceipt: { findUniqueOrThrow: vi.fn().mockResolvedValue(mockReceipt) },
                accountPayable: {
                    findFirst: vi.fn().mockResolvedValue({ id: 99 }),
                    create: vi.fn(),
                },
            };

            await FinanceAPService.createFromReceipt(1, "user-123", mockDb as any);

            expect(mockDb.accountPayable.create).not.toHaveBeenCalled();
        });
    });
});
