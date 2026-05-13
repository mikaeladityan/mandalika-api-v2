import prisma from "../../../../config/prisma.js";

export class FinanceKpiService {
    static async getSummary() {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

        const [
            ap_open_count,
            ap_open_balance,
            ap_overdue_count,
            ar_open_count,
            ar_open_balance,
            ar_overdue_count,
            cash_in_month,
            cash_out_month,
            journal_posted_month,
        ] = await Promise.all([
            prisma.accountPayable.count({
                where: { status: { not: "PAID" } },
            }),
            prisma.accountPayable.aggregate({
                where: { status: { not: "PAID" } },
                _sum: { balance: true },
            }),
            prisma.accountPayable.count({
                where: { status: { not: "PAID" }, due_date: { lt: now } },
            }),
            prisma.accountReceivable.count({
                where: { status: { not: "CLOSED" } },
            }),
            prisma.accountReceivable.aggregate({
                where: { status: { not: "CLOSED" } },
                _sum: { balance: true },
            }),
            prisma.accountReceivable.count({
                where: { status: { not: "CLOSED" }, due_date: { lt: now } },
            }),
            prisma.cashEntry.aggregate({
                where: { type: "RECEIPT", status: "POSTED", cash_date: { gte: monthStart, lt: monthEnd } },
                _sum: { amount: true },
                _count: true,
            }),
            prisma.cashEntry.aggregate({
                where: { type: "PAYMENT", status: "POSTED", cash_date: { gte: monthStart, lt: monthEnd } },
                _sum: { amount: true },
                _count: true,
            }),
            prisma.journalEntry.count({
                where: { status: "POSTED", journal_date: { gte: monthStart, lt: monthEnd } },
            }),
        ]);

        return {
            ap: {
                open_count: ap_open_count,
                open_balance: Number(ap_open_balance._sum.balance ?? 0),
                overdue_count: ap_overdue_count,
            },
            ar: {
                open_count: ar_open_count,
                open_balance: Number(ar_open_balance._sum.balance ?? 0),
                overdue_count: ar_overdue_count,
            },
            cash_this_month: {
                in_count: cash_in_month._count,
                in_total: Number(cash_in_month._sum.amount ?? 0),
                out_count: cash_out_month._count,
                out_total: Number(cash_out_month._sum.amount ?? 0),
                net: Number(cash_in_month._sum.amount ?? 0) - Number(cash_out_month._sum.amount ?? 0),
            },
            journal_posted_this_month: journal_posted_month,
            period: {
                month: now.getMonth() + 1,
                year: now.getFullYear(),
            },
        };
    }
}
