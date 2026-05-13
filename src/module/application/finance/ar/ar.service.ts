import prisma from "../../../../config/prisma.js";
import { Prisma } from "../../../../generated/prisma/client.js";
import { QueryARDTO, ReceiveARDTO, CreateARDTO } from "./ar.schema.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { GetPagination } from "../../../../lib/utils/pagination.js";
import { generateARNumber, generateCashNumber, generateJournalNumber } from "../../../../lib/utils/generate-number.js";

export class FinanceARService {
    static async list(query: QueryARDTO) {
        const { page, take, search, status, partner_type, partner_id, month, year, sortBy = "due_date", order = "asc" } = query;
        const { skip, take: limit } = GetPagination(page, take);

        const where: any = {};
        if (search) {
            where.OR = [
                { ar_number: { contains: search, mode: "insensitive" } },
                { partner_name: { contains: search, mode: "insensitive" } },
                { source_doc: { contains: search, mode: "insensitive" } },
            ];
        }
        if (status) where.status = status;
        if (partner_type) where.partner_type = partner_type;
        if (partner_id) where.partner_id = partner_id;

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
            prisma.accountReceivable.findMany({
                where,
                skip,
                take: limit,
                orderBy: { [sortBy]: order },
            }),
            prisma.accountReceivable.count({ where }),
        ]);

        return { data, total };
    }

    static async detail(id: number) {
        return await prisma.accountReceivable.findUniqueOrThrow({ where: { id } });
    }

    static async recordReceipt(id: number, dto: ReceiveARDTO, userId: string) {
        const ar = await prisma.accountReceivable.findUniqueOrThrow({ where: { id } });

        if (ar.status === "CLOSED") {
            throw new ApiError(400, "AR is already fully collected.");
        }

        const newReceivedAmount = Number(ar.received_amount) + dto.received_amount;
        if (newReceivedAmount > Number(ar.amount) + 0.001) {
            throw new ApiError(
                400,
                `Receipt amount (${newReceivedAmount.toFixed(2)}) exceeds AR total (${Number(ar.amount).toFixed(2)}).`,
            );
        }

        const newBalance = Math.max(0, Number(ar.amount) - newReceivedAmount);
        const newStatus: "OPEN" | "PARTIAL" | "CLOSED" = newBalance <= 0.001 ? "CLOSED" : "PARTIAL";

        return await prisma.$transaction(async (tx) => {
            const updated = await tx.accountReceivable.update({
                where: { id },
                data: {
                    received_amount: newReceivedAmount,
                    balance: newBalance,
                    status: newStatus,
                    last_receipt_date: new Date(dto.receipt_date),
                    notes: dto.notes ?? undefined,
                    updated_by: userId,
                },
            });

            const cashNo = await generateCashNumber(tx);
            await tx.cashEntry.create({
                data: {
                    cash_number: cashNo,
                    cash_date: new Date(dto.receipt_date),
                    type: "RECEIPT",
                    source: "Customer Receipt",
                    reference: ar.ar_number,
                    amount: dto.received_amount,
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
                    journal_date: new Date(dto.receipt_date),
                    source: ar.ar_number,
                    desc: `Penerimaan piutang ${ar.partner_name}`,
                    debit: dto.received_amount,
                    credit: dto.received_amount,
                    status: "POSTED",
                    posted_at: new Date(),
                    created_by: userId,
                },
            });

            return updated;
        });
    }

    static async create(dto: CreateARDTO, userId: string) {
        const arNumber = await generateARNumber(prisma);

        return await prisma.accountReceivable.create({
            data: {
                ar_number: arNumber,
                partner_type: dto.partner_type,
                partner_id: dto.partner_id ?? null,
                partner_name: dto.partner_name,
                source_doc: dto.source_doc,
                amount: dto.amount,
                balance: dto.amount,
                status: "OPEN",
                due_date: dto.due_date ?? null,
                notes: dto.notes ?? null,
                created_by: userId,
            },
        });
    }

    static async createFromSale(
        _saleId: number,
        _userId: string,
        _tx?: Prisma.TransactionClient,
    ): Promise<void> {
        // Stub — will be implemented when Sales/POS module is built
    }
}
