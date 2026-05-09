import prisma from "../../../../config/prisma.js";
import { QueryAPDTO, UpdateAPPaymentDTO } from "./ap.schema.js";
import { GetPagination } from "../../../../lib/utils/pagination.js";
import { ApiError } from "../../../../lib/errors/api.error.js";

export class APService {
    static async list(query: QueryAPDTO) {
        const { page, take, search, status, supplier_id, po_id, receipt_id, month, year, sortBy = "due_date", order = "asc" } = query;
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
                supplier: { select: { id: true, name: true, country: true } },
            },
        });
    }

    static async updatePayment(id: number, body: UpdateAPPaymentDTO) {
        const ap = await prisma.accountPayable.findUniqueOrThrow({ where: { id } });

        if (ap.status === "PAID") {
            throw new ApiError(400, "AP is already fully paid.");
        }

        const newPaidAmount = Number(ap.paid_amount) + body.paid_amount;
        const newRemainingAmount = Math.max(0, Number(ap.amount) - newPaidAmount);

        // Auto-determine status if not provided
        let newStatus = body.status;
        if (!newStatus) {
            if (newRemainingAmount <= 0.001) {
                newStatus = "PAID";
            } else if (Number(ap.paid_amount) === 0 && body.paid_amount > 0) {
                newStatus = "DP_PAID";
            } else {
                newStatus = "PARTIALLY_PAID";
            }
        }

        const updated = await prisma.accountPayable.update({
            where: { id },
            data: {
                paid_amount: newPaidAmount,
                remaining_amount: newRemainingAmount,
                status: newStatus,
                invoice_number: body.invoice_number !== undefined ? body.invoice_number : undefined,
                invoice_date: body.invoice_date !== undefined ? body.invoice_date : undefined,
                due_date: body.due_date !== undefined ? body.due_date : undefined,
                notes: body.notes !== undefined ? body.notes : undefined,
            },
        });

        // Sync payment status to PurchaseTracking
        if (ap.po_id) {
            const trackingPaymentStatus = newStatus === "PAID" ? "PAID"
                : newStatus === "PARTIALLY_PAID" ? "PARTIALLY_PAID"
                : newStatus === "DP_PAID" ? "DP_PAID"
                : "UNPAID";

            await prisma.purchaseTracking.updateMany({
                where: { po_id: ap.po_id },
                data: { payment_status: trackingPaymentStatus },
            });
        }

        return updated;
    }
}
