import prisma from "../../../../config/prisma.js";
import { Prisma } from "../../../../generated/prisma/client.js";
import { QueryAPDTO, PayAPDTO } from "./ap.schema.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { GetPagination } from "../../../../lib/utils/pagination.js";
import { POTrackingPaymentStatus } from "../../../../generated/prisma/enums.js";
import { generateAPNumber, generateCashNumber, generateJournalNumber } from "../../../../lib/utils/generate-number.js";

export class FinanceAPService {
    static async list(query: QueryAPDTO) {
        const { page, take, search, status, ap_type, supplier_id, po_id, receipt_id, month, year, sortBy = "due_date", order = "asc" } = query;
        const { skip, take: limit } = GetPagination(page, take);

        const where: any = {};
        if (search) {
            where.OR = [
                { ap_number: { contains: search, mode: "insensitive" } },
                { supplier_name: { contains: search, mode: "insensitive" } },
                { invoice_number: { contains: search, mode: "insensitive" } },
            ];
        }
        if (status) where.status = status;
        if (ap_type) where.ap_type = ap_type;
        if (supplier_id) where.supplier_id = supplier_id;
        if (po_id) where.po_id = po_id;
        if (receipt_id) where.receipt_id = receipt_id;

        if (month) {
            where.created_at = {
                gte: new Date(year ?? new Date().getFullYear(), month - 1, 1),
                lt: new Date(year ?? new Date().getFullYear(), month, 1),
            };
        } else if (year) {
            where.created_at = {
                gte: new Date(year, 0, 1),
                lt: new Date(year + 1, 0, 1),
            };
        }

        const [data, total] = await Promise.all([
            prisma.accountPayable.findMany({
                where,
                skip,
                take: limit,
                orderBy: { [sortBy]: order },
                include: {
                    po: { select: { id: true, po_number: true, po_type: true } },
                    receipt: { select: { id: true, receipt_number: true } },
                    payment_term: { select: { id: true, term_seq: true, percentage: true, due_days: true } },
                    supplier: { select: { id: true, name: true } },
                },
            }),
            prisma.accountPayable.count({ where }),
        ]);

        return { data, total };
    }

    static async detail(id: number) {
        return await prisma.accountPayable.findUniqueOrThrow({
            where: { id },
            include: {
                po: {
                    include: {
                        payment_terms: true,
                        tracking: { select: { payment_status: true, dp_paid_date: true, final_paid_date: true } },
                    },
                },
                receipt: {
                    select: {
                        id: true,
                        receipt_number: true,
                        receipt_date: true,
                        total_amount: true,
                    },
                },
                payment_term: { select: { id: true, term_seq: true, percentage: true, due_days: true, notes: true } },
                supplier: { select: { id: true, name: true, country: true } },
            },
        });
    }

    static async recordPayment(id: number, dto: PayAPDTO, userId: string) {
        const ap = await prisma.accountPayable.findUniqueOrThrow({ where: { id } });

        if (ap.status === "PAID") {
            throw new ApiError(400, "AP is already fully paid.");
        }

        const newPaidAmount = Number(ap.paid_amount) + dto.paid_amount;
        if (newPaidAmount > Number(ap.amount) + 0.001) {
            throw new ApiError(400, `Payment amount (${newPaidAmount.toFixed(2)}) exceeds AP total (${Number(ap.amount).toFixed(2)}).`);
        }

        const newBalance = Math.max(0, Number(ap.amount) - newPaidAmount);

        let newStatus: "UNPAID" | "DP_PAID" | "PARTIALLY_PAID" | "PAID";
        if (newBalance <= 0.001) {
            newStatus = "PAID";
        } else if (Number(ap.paid_amount) === 0 && dto.paid_amount > 0) {
            newStatus = "DP_PAID";
        } else {
            newStatus = "PARTIALLY_PAID";
        }

        return await prisma.$transaction(async (tx) => {
            const updated = await tx.accountPayable.update({
                where: { id },
                data: {
                    paid_amount: newPaidAmount,
                    balance: newBalance,
                    status: newStatus,
                    last_paid_date: new Date(dto.payment_date),
                    last_payment_method: dto.payment_method,
                    invoice_number: dto.invoice_number ?? undefined,
                    invoice_date: dto.invoice_date ?? undefined,
                    due_date: dto.due_date ?? undefined,
                    notes: dto.notes ?? undefined,
                    updated_by: userId,
                },
            });

            const cashNo = await generateCashNumber(tx);
            await tx.cashEntry.create({
                data: {
                    cash_number: cashNo,
                    cash_date: new Date(dto.payment_date),
                    type: "PAYMENT",
                    source: "Vendor Payment",
                    reference: ap.ap_number,
                    amount: dto.paid_amount,
                    payment_method: dto.payment_method,
                    bank_account: dto.bank_account ?? null,
                    status: "POSTED",
                    posted_at: new Date(),
                    created_by: userId,
                },
            });

            const journalNo = await generateJournalNumber(tx);
            await tx.journalEntry.create({
                data: {
                    journal_number: journalNo,
                    journal_date: new Date(dto.payment_date),
                    source: ap.ap_number,
                    desc: `Pembayaran vendor ${ap.supplier_name}`,
                    debit: dto.paid_amount,
                    credit: dto.paid_amount,
                    status: "POSTED",
                    posted_at: new Date(),
                    created_by: userId,
                },
            });

            if (ap.po_id) {
                const allAPs = await tx.accountPayable.findMany({
                    where: { po_id: ap.po_id },
                    select: { status: true },
                });

                let trackingStatus: POTrackingPaymentStatus;
                if (allAPs.every((a) => a.status === "PAID")) {
                    trackingStatus = "PAID";
                } else if (allAPs.some((a) => a.status === "PAID" || a.status === "PARTIALLY_PAID")) {
                    trackingStatus = "PARTIALLY_PAID";
                } else if (allAPs.some((a) => a.status === "DP_PAID")) {
                    trackingStatus = "DP_PAID";
                } else {
                    trackingStatus = "UNPAID";
                }

                await tx.purchaseTracking.updateMany({
                    where: { po_id: ap.po_id },
                    data: { payment_status: trackingStatus },
                });
            }

            return updated;
        });
    }

    static async createFromReceipt(
        receiptId: number,
        userId: string,
        tx?: Prisma.TransactionClient,
    ): Promise<void> {
        const db = tx ?? prisma;

        const receipt = await db.purchaseReceipt.findUniqueOrThrow({
            where: { id: receiptId },
            include: {
                items: true,
                po: {
                    select: { id: true, supplier_id: true, supplier_name: true },
                },
            },
        });

        const itemsByPo = new Map<number, typeof receipt.items>();
        for (const item of receipt.items) {
            if (!itemsByPo.has(item.po_id)) itemsByPo.set(item.po_id, []);
            itemsByPo.get(item.po_id)!.push(item);
        }

        for (const [poId, poItems] of itemsByPo) {
            const existing = await db.accountPayable.findFirst({
                where: { receipt_id: receiptId, po_id: poId },
                select: { id: true },
            });
            if (existing) continue;

            const po = receipt.po?.id === poId
                ? receipt.po
                : await db.purchaseOrder.findUnique({
                    where: { id: poId },
                    select: { id: true, supplier_id: true, supplier_name: true },
                });

            if (!po) throw new ApiError(400, `PO ${poId} not found.`);

            const amount = poItems.reduce((sum, i) => sum + Number(i.amount), 0);
            const apNumber = await generateAPNumber(db as any);

            await db.accountPayable.create({
                data: {
                    ap_number: apNumber,
                    po_id: poId,
                    receipt_id: receiptId,
                    ap_type: "GOODS_RECEIPT",
                    supplier_id: po.supplier_id ?? null,
                    supplier_name: po.supplier_name,
                    amount,
                    balance: amount,
                    status: "UNPAID",
                    created_by: userId,
                },
            });
        }
    }
}
