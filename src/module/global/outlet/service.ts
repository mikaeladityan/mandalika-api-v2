import prisma from "../../../config/prisma.js";
import { Prisma } from "../../../generated/prisma/client.js";
import { GetPagination } from "../../../lib/utils/pagination.js";
import { QueryOutletDTO } from "../../application/outlet/outlet.schema.js";

export class OutletGlobalService {
    static async list(query: QueryOutletDTO) {
        const {
            page = 1,
            take = 25,
            search,
            status,
            type,
            warehouse_id,
            sortBy = "updated_at",
            sortOrder = "asc",
        } = query;
        const { skip, take: limit } = GetPagination(page, take);

        const where: Prisma.OutletWhereInput = {
            deleted_at: status === "active" ? null : { not: null },
            ...(type && { type }),
            ...(warehouse_id && {
                warehouses: { some: { warehouse_id } },
            }),
            ...(search && {
                OR: [
                    { name: { contains: search, mode: "insensitive" } },
                    { code: { contains: search, mode: "insensitive" } },
                ],
            }),
        };

        const [data, len] = await Promise.all([
            prisma.outlet.findMany({
                where,
                select: {
                    code: true,
                    name: true,
                    type: true,
                    inventories: {
                        include: {
                            product: {
                                select: {
                                    id: true,
                                    code: true,
                                    name: true,
                                    unit: true,
                                },
                            },
                        },
                        select: {
                            min_stock: true,
                            quantity: true,
                        }
                    }
                },
                orderBy: { [sortBy]: sortOrder },
                skip,
                take: limit,
            }),
            prisma.outlet.count({ where }),
        ]);

        return { data, len };
    }
}