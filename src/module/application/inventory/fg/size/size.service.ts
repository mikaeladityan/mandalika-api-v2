import prisma from "../../../../../config/prisma.js";
import { Prisma } from "../../../../../generated/prisma/client.js";
import { ApiError } from "../../../../../lib/errors/api.error.js";
import { GetPagination } from "../../../../../lib/utils/pagination.js";
import {
    QueryFGSizeDTO,
    RequestFGSizeDTO,
    ResponseFGSizeDTO,
} from "./size.schema.js";

export class FGSizeService {
    static async create(body: RequestFGSizeDTO): Promise<ResponseFGSizeDTO> {
        try {
            return await prisma.productSize.create({ data: { size: body.size } });
        } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
                throw new ApiError(400, `Ukuran ${body.size} sudah tersedia`);
            }
            throw e;
        }
    }

    static async list(
        query: QueryFGSizeDTO,
    ): Promise<{ data: ResponseFGSizeDTO[]; len: number }> {
        const { search, page, take } = query;
        const { skip, take: limit } = GetPagination(page, take);

        const where = search !== undefined ? { size: search } : undefined;

        const [data, len] = await Promise.all([
            prisma.productSize.findMany({
                where,
                orderBy: { size: "asc" },
                skip,
                take: limit,
            }),
            prisma.productSize.count({ where }),
        ]);

        return { data, len };
    }

    static async update(
        id: number,
        body: Partial<RequestFGSizeDTO>,
    ): Promise<ResponseFGSizeDTO> {
        if (body.size === undefined) {
            const current = await prisma.productSize.findUnique({ where: { id } });
            if (!current) throw new ApiError(404, "Ukuran tidak ditemukan");
            return current;
        }

        try {
            return await prisma.productSize.update({
                where: { id },
                data: { size: body.size },
            });
        } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError) {
                if (e.code === "P2025") throw new ApiError(404, "Ukuran tidak ditemukan");
                if (e.code === "P2002")
                    throw new ApiError(400, `Ukuran ${body.size} sudah digunakan`);
            }
            throw e;
        }
    }

    static async delete(id: number): Promise<void> {
        const existing = await prisma.productSize.findUnique({
            where: { id },
            select: { _count: { select: { products: true } } },
        });

        if (!existing) throw new ApiError(404, "Ukuran tidak ditemukan");

        if (existing._count.products > 0) {
            throw new ApiError(
                400,
                "Ukuran tidak dapat dihapus karena masih digunakan oleh produk",
            );
        }

        await prisma.productSize.delete({ where: { id } });
    }
}
