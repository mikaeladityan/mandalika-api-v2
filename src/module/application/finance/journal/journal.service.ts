import prisma from "../../../../config/prisma.js";
import { Prisma } from "../../../../generated/prisma/client.js";
import { QueryJournalDTO, CreateJournalDTO } from "./journal.schema.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { GetPagination } from "../../../../lib/utils/pagination.js";
import { generateJournalNumber } from "../../../../lib/utils/generate-number.js";

export class FinanceJournalService {
    static async list(query: QueryJournalDTO) {
        const { page, take, search, status, source, date_from, date_to, month, year, sortBy = "journal_date", order = "desc" } = query;
        const { skip, take: limit } = GetPagination(page, take);

        const where: any = {};
        if (search) {
            where.OR = [
                { journal_number: { contains: search, mode: "insensitive" } },
                { source: { contains: search, mode: "insensitive" } },
                { desc: { contains: search, mode: "insensitive" } },
            ];
        }
        if (status) where.status = status;
        if (source) where.source = { contains: source, mode: "insensitive" };

        if (date_from || date_to) {
            where.journal_date = {};
            if (date_from) where.journal_date.gte = date_from;
            if (date_to) where.journal_date.lte = date_to;
        } else if (month) {
            where.journal_date = {
                gte: new Date(year ?? new Date().getFullYear(), month - 1, 1),
                lt: new Date(year ?? new Date().getFullYear(), month, 1),
            };
        } else if (year) {
            where.journal_date = {
                gte: new Date(year, 0, 1),
                lt: new Date(year + 1, 0, 1),
            };
        }

        const [data, total] = await Promise.all([
            prisma.journalEntry.findMany({
                where,
                skip,
                take: limit,
                orderBy: { [sortBy]: order },
            }),
            prisma.journalEntry.count({ where }),
        ]);

        return { data, total };
    }

    static async detail(id: number) {
        return await prisma.journalEntry.findUniqueOrThrow({ where: { id } });
    }

    static async create(dto: CreateJournalDTO, userId: string) {
        const journalNo = await generateJournalNumber(prisma);

        return await prisma.journalEntry.create({
            data: {
                journal_number: journalNo,
                journal_date: dto.journal_date,
                source: dto.source,
                desc: dto.desc,
                debit: dto.debit,
                credit: dto.credit,
                notes: dto.notes ?? null,
                status: "DRAFT",
                created_by: userId,
            },
        });
    }

    static async post(id: number, userId: string) {
        const entry = await prisma.journalEntry.findUniqueOrThrow({ where: { id } });

        if (entry.status === "POSTED") {
            throw new ApiError(400, "Journal entry is already posted.");
        }

        return await prisma.journalEntry.update({
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
            journal_date: Date;
            source: string;
            desc: string;
            debit: number;
            credit: number;
            created_by: string;
        },
        tx: Prisma.TransactionClient,
    ) {
        const journalNo = await generateJournalNumber(tx);
        return await tx.journalEntry.create({
            data: {
                journal_number: journalNo,
                journal_date: data.journal_date,
                source: data.source,
                desc: data.desc,
                debit: data.debit,
                credit: data.credit,
                status: "POSTED",
                posted_at: new Date(),
                created_by: data.created_by,
            },
        });
    }
}
