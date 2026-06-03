import { Prisma } from "../../../../generated/prisma/client.js";
import prisma from "../../../../config/prisma.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { normalizeSlug } from "../../../../lib/index.js";
import { RequestUnitDTO, QueryUnitDTO, ResponseUnitDTO, UpdateUnitDTO } from "./unit.schema.js";
import { GetPagination } from "../../../../lib/utils/pagination.js";

export class UnitService {
    static async create(body: RequestUnitDTO): Promise<ResponseUnitDTO> {
        const name = body.name.trim();
        const slug = normalizeSlug(name);

        try {
            return await prisma.unit.create({ data: { name, slug } });
        } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
                throw new ApiError(400, `Satuan "${name}" sudah tersedia`);
            }
            throw e;
        }
    }

    static async list(query: QueryUnitDTO): Promise<{ data: ResponseUnitDTO[]; len: number }> {
        const { search, page = 1, take = 25 } = query;
        const { skip, take: limit } = GetPagination(page, take);

        const where = search
            ? { name: { contains: search, mode: "insensitive" as const } }
            : undefined;

        const [data, len] = await Promise.all([
            prisma.unit.findMany({
                where,
                orderBy: { name: "asc" },
                skip,
                take: limit,
            }),
            prisma.unit.count({ where }),
        ]);

        return { data, len };
    }

    static async update(id: number, body: UpdateUnitDTO): Promise<ResponseUnitDTO> {
        const name = body.name?.trim();
        const data = name !== undefined ? { name, slug: normalizeSlug(name) } : {};

        try {
            return await prisma.unit.update({ where: { id }, data });
        } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError) {
                if (e.code === "P2025") throw new ApiError(404, "Satuan tidak ditemukan");
                if (e.code === "P2002") {
                    throw new ApiError(400, `Satuan "${name ?? ""}" sudah digunakan`);
                }
            }
            throw e;
        }
    }

    static async delete(id: number): Promise<void> {
        try {
            await prisma.unit.delete({ where: { id } });
        } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError) {
                if (e.code === "P2025") throw new ApiError(404, "Satuan tidak ditemukan");
                if (e.code === "P2003") {
                    throw new ApiError(
                        409,
                        "Satuan tidak dapat dihapus karena masih digunakan oleh produk",
                    );
                }
            }
            throw e;
        }
    }
}
