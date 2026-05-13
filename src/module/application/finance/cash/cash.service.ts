import prisma from "../../../../config/prisma.js";
import { Prisma } from "../../../../generated/prisma/client.js";
import { QueryCashDTO, CreateCashDTO } from "./cash.schema.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { GetPagination } from "../../../../lib/utils/pagination.js";
import { generateCashNumber } from "../../../../lib/utils/generate-number.js";

export class FinanceCashService {
    static async list(query: QueryCashDTO) {
        const { page, take, search, type, status, payment_method, date_from, date_to, month, year, sortBy = "cash_date", order = "desc" } = query;
        const { skip, take: limit } = GetPagination(page, take);

        const where: any = {};
        if (search) {
            where.OR = [
                { cash_number: { contains: search, mode: "insensitive" } },
                { source: { contains: search, mode: "insensitive" } },
                { reference: { contains: search, mode: "insensitive" } },
            ];
        }
        if (type) where.type = type;
        if (status) where.status = status;
        if (payment_method) where.payment_method = payment_method;

        if (date_from || date_to) {
            where.cash_date = {};
            if (date_from) where.cash_date.gte = date_from;
            if (date_to) where.cash_date.lte = date_to;
        } else if (month) {
            where.cash_date = {
                gte: new Date(year ?? new Date().getFullYear(), month - 1, 1),
                lt: new Date(year ?? new Date().getFullYear(), month, 1),
            };
        } else if (year) {
            where.cash_date = {
                gte: new Date(year, 0, 1),
                lt: new Date(year + 1, 0, 1),
            };
        }

        const [data, total] = await Promise.all([
            prisma.cashEntry.findMany({
                where,
                skip,
                take: limit,
                orderBy: { [sortBy]: order },
            }),
            prisma.cashEntry.count({ where }),
        ]);

        return { data, total };
    }

    static async detail(id: number) {
        return await prisma.cashEntry.findUniqueOrThrow({ where: { id } });
    }

    static async create(dto: CreateCashDTO, userId: string) {
        const cashNo = await generateCashNumber(prisma);

        return await prisma.cashEntry.create({
            data: {
                cash_number: cashNo,
                cash_date: dto.cash_date,
                type: dto.type,
                source: dto.source,
                reference: dto.reference ?? null,
                amount: dto.amount,
                payment_method: dto.payment_method ?? null,
                bank_account: dto.bank_account ?? null,
                notes: dto.notes ?? null,
                status: "DRAFT",
                created_by: userId,
            },
        });
    }

    static async post(id: number, userId: string) {
        const entry = await prisma.cashEntry.findUniqueOrThrow({ where: { id } });

        if (entry.status === "POSTED") {
            throw new ApiError(400, "Cash entry is already posted.");
        }

        return await prisma.cashEntry.update({
            where: { id },
            data: {
                status: "POSTED",
                posted_at: new Date(),
                updated_by: userId,
            },
        });
    }

    static async createAutoEntry(
        data: {
            cash_date: Date;
            type: "RECEIPT" | "PAYMENT" | "CREDIT";
            source: string;
            reference: string;
            amount: number;
            payment_method: "TRANSFER" | "CASH" | "GIRO";
            bank_account?: string | null;
            created_by: string;
        },
        tx: Prisma.TransactionClient,
    ) {
        const cashNo = await generateCashNumber(tx);
        return await tx.cashEntry.create({
            data: {
                cash_number: cashNo,
                cash_date: data.cash_date,
                type: data.type,
                source: data.source,
                reference: data.reference,
                amount: data.amount,
                payment_method: data.payment_method,
                bank_account: data.bank_account ?? null,
                status: "POSTED",
                posted_at: new Date(),
                created_by: data.created_by,
            },
        });
    }
}
