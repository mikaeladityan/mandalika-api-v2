import { Prisma } from "../../../../generated/prisma/client.js";
import prisma from "../../../../config/prisma.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { RequestSizeDTO, QuerySizeDTO, ResponseSizeDTO, UpdateSizeDTO } from "./size.schema.js";
import { GetPagination } from "../../../../lib/utils/pagination.js";

export class ProductSizeService {
    static async create(body: RequestSizeDTO): Promise<ResponseSizeDTO> {
        try {
            return await prisma.productSize.create({ data: { size: body.size } });
        } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
                throw new ApiError(400, `Ukuran ${body.size} sudah tersedia`);
            }
            throw e;
        }
    }

    static async list(query: QuerySizeDTO): Promise<{ data: ResponseSizeDTO[]; len: number }> {
        const { search, page = 1, take = 25 } = query;
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

    static async update(id: number, body: UpdateSizeDTO): Promise<ResponseSizeDTO> {
        const data = body.size !== undefined ? { size: body.size } : {};

        try {
            return await prisma.productSize.update({ where: { id }, data });
        } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError) {
                if (e.code === "P2025") throw new ApiError(404, "Ukuran tidak ditemukan");
                if (e.code === "P2002") {
                    throw new ApiError(400, `Ukuran ${body.size} sudah digunakan`);
                }
            }
            throw e;
        }
    }

    static async delete(id: number): Promise<void> {
        try {
            await prisma.productSize.delete({ where: { id } });
        } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError) {
                if (e.code === "P2025") throw new ApiError(404, "Ukuran tidak ditemukan");
                if (e.code === "P2003") {
                    throw new ApiError(
                        409,
                        "Ukuran tidak dapat dihapus karena masih digunakan oleh produk",
                    );
                }
            }
            throw e;
        }
    }
}
