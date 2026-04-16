import prisma from "../../../../../config/prisma.js";
import { Prisma } from "../../../../../generated/prisma/client.js";
import { TransferStatus } from "../../../../../generated/prisma/enums.js";
import { GetPagination } from "../../../../../lib/utils/pagination.js";
import { EXPORT_ROW_LIMIT, PRODUCT_INCLUDE } from "../../inventory.constants.js";
import { QueryDiscrepancyDTO } from "./discrepancy.schema.js";

export class DiscrepancyService {
    static async list(query: QueryDiscrepancyDTO) {
        const { page = 1, take = 25, search } = query;
        const { skip, take: limit } = GetPagination(Number(page), Number(take));

        const conditions: Prisma.StockTransferItemWhereInput[] = [
            {
                OR: [
                    { quantity_missing:  { gt: 0 } },
                    { quantity_rejected: { gt: 0 } },
                ],
            },
            {
                transfer: {
                    status: {
                        in: [
                            TransferStatus.COMPLETED,
                            TransferStatus.PARTIAL,
                            TransferStatus.MISSING,
                            TransferStatus.REJECTED,
                        ],
                    },
                },
            },
        ];

        if (search) {
            conditions.push({
                OR: [
                    { transfer: { transfer_number: { contains: search, mode: "insensitive" } } },
                    { product:  { name: { contains: search, mode: "insensitive" } } },
                    { product:  { code: { contains: search, mode: "insensitive" } } },
                ],
            });
        }

        const where: Prisma.StockTransferItemWhereInput = {
            AND: conditions,
        };

        const [data, len] = await Promise.all([
            prisma.stockTransferItem.findMany({
                where,
                skip,
                take: limit,
                orderBy: { transfer: { created_at: "desc" } },
                include: {
                    product: PRODUCT_INCLUDE,
                    transfer: {
                        include: { from_warehouse: true, to_warehouse: true, to_outlet: true },
                    },
                },
            }),
            prisma.stockTransferItem.count({ where }),
        ]);

        return { data, len };
    }

    static async export(query: QueryDiscrepancyDTO) {
        const { data } = await this.list({ ...query, take: EXPORT_ROW_LIMIT, page: 1 });
        return data;
    }
}
