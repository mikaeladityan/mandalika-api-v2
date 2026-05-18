import prisma from "../../../../../config/prisma.js";
import { Prisma } from "../../../../../generated/prisma/client.js";
import { ApiError } from "../../../../../lib/errors/api.error.js";
import { normalizeSlug } from "../../../../../lib/index.js";
import { GetPagination } from "../../../../../lib/utils/pagination.js";
import {
    QueryFGTypeDTO,
    RequestFGTypeDTO,
    ResponseFGTypeDTO,
} from "./type.schema.js";

export class FGTypeService {
    static async create(body: RequestFGTypeDTO): Promise<ResponseFGTypeDTO> {
        const name = body.name;
        const slug = normalizeSlug(name);

        try {
            return await prisma.productType.create({ data: { name, slug } });
        } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
                throw new ApiError(400, `Tipe "${name}" sudah tersedia`);
            }
            throw e;
        }
    }

    static async list(
        query: QueryFGTypeDTO,
    ): Promise<{ data: ResponseFGTypeDTO[]; len: number }> {
        const { search, page, take } = query;
        const { skip, take: limit } = GetPagination(page, take);

        const where = search
            ? { name: { contains: search, mode: "insensitive" as const } }
            : undefined;

        const [data, len] = await Promise.all([
            prisma.productType.findMany({
                where,
                orderBy: { name: "asc" },
                skip,
                take: limit,
            }),
            prisma.productType.count({ where }),
        ]);

        return { data, len };
    }

    static async update(
        id: number,
        body: Partial<RequestFGTypeDTO>,
    ): Promise<ResponseFGTypeDTO> {
        if (body.name === undefined) {
            const current = await prisma.productType.findUnique({ where: { id } });
            if (!current) throw new ApiError(404, "Tipe produk tidak ditemukan");
            return current;
        }

        const name = body.name;
        const slug = normalizeSlug(name);

        try {
            return await prisma.productType.update({
                where: { id },
                data: { name, slug },
            });
        } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError) {
                if (e.code === "P2025")
                    throw new ApiError(404, "Tipe produk tidak ditemukan");
                if (e.code === "P2002")
                    throw new ApiError(400, `Tipe "${name}" sudah digunakan`);
            }
            throw e;
        }
    }

    static async delete(id: number): Promise<void> {
        const existing = await prisma.productType.findUnique({
            where: { id },
            select: { _count: { select: { products: true } } },
        });

        if (!existing) throw new ApiError(404, "Tipe produk tidak ditemukan");

        if (existing._count.products > 0) {
            throw new ApiError(
                400,
                "Tipe produk tidak dapat dihapus karena masih digunakan oleh produk",
            );
        }

        await prisma.productType.delete({ where: { id } });
    }
}
