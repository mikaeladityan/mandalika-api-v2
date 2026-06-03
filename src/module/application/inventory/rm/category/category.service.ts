import prisma from "../../../../../config/prisma.js";
import { Prisma } from "../../../../../generated/prisma/client.js";
import { ApiError } from "../../../../../lib/errors/api.error.js";
import { normalizeSlug } from "../../../../../lib/index.js";
import { GetPagination } from "../../../../../lib/utils/pagination.js";
import {
    ChangeStatusRawMatCategoryDTO,
    QueryRawMatCategoryDTO,
    RequestRawMatCategoryDTO,
    ResponseRawMatCategoryDTO,
    UpdateRawMatCategoryDTO,
} from "./category.schema.js";

const CATEGORY_SELECT = {
    id: true,
    name: true,
    slug: true,
    status: true,
    created_at: true,
    updated_at: true,
} satisfies Prisma.RawMatCategoriesSelect;

export class RawMatCategoryService {
    static async create(payload: RequestRawMatCategoryDTO): Promise<ResponseRawMatCategoryDTO> {
        try {
            return await prisma.rawMatCategories.create({
                data: {
                    name: payload.name.trim(),
                    slug: normalizeSlug(payload.name),
                    status: payload.status ?? "ACTIVE",
                },
                select: CATEGORY_SELECT,
            });
        } catch (e) {
            this.rethrowPrismaError(e);
        }
    }

    static async update(
        id: number,
        payload: UpdateRawMatCategoryDTO,
    ): Promise<ResponseRawMatCategoryDTO> {
        try {
            return await prisma.rawMatCategories.update({
                where: { id },
                data: {
                    ...(payload.name !== undefined && {
                        name: payload.name.trim(),
                        slug: normalizeSlug(payload.name),
                    }),
                    ...(payload.status !== undefined && { status: payload.status }),
                },
                select: CATEGORY_SELECT,
            });
        } catch (e) {
            this.rethrowPrismaError(e);
        }
    }

    static async changeStatus(
        id: number,
        status: ChangeStatusRawMatCategoryDTO["status"],
    ): Promise<ResponseRawMatCategoryDTO> {
        try {
            return await prisma.rawMatCategories.update({
                where: { id },
                data: { status },
                select: CATEGORY_SELECT,
            });
        } catch (e) {
            this.rethrowPrismaError(e);
        }
    }

    static async detail(id: number): Promise<ResponseRawMatCategoryDTO> {
        const category = await prisma.rawMatCategories.findUnique({
            where: { id },
            select: CATEGORY_SELECT,
        });
        if (!category) throw new ApiError(404, "Category tidak ditemukan");
        return category;
    }

    static async list(
        query: QueryRawMatCategoryDTO,
    ): Promise<{ data: ResponseRawMatCategoryDTO[]; len: number }> {
        const { page, take, search, status, sortBy, sortOrder } = query;
        const { skip, take: limit } = GetPagination(page, take);

        const where: Prisma.RawMatCategoriesWhereInput = {
            ...(status && { status }),
            ...(search && {
                OR: [
                    { name: { contains: search, mode: "insensitive" } },
                    { slug: { contains: search, mode: "insensitive" } },
                ],
            }),
        };

        const orderBy: Prisma.RawMatCategoriesOrderByWithRelationInput = { [sortBy]: sortOrder };

        const [data, len] = await Promise.all([
            prisma.rawMatCategories.findMany({
                where,
                skip,
                take: limit,
                orderBy,
                select: CATEGORY_SELECT,
            }),
            prisma.rawMatCategories.count({ where }),
        ]);

        return { data, len };
    }

    static async delete(id: number): Promise<{ deleted: number }> {
        const usedCount = await prisma.rawMaterial.count({ where: { raw_mat_categories_id: id } });
        if (usedCount > 0) {
            throw new ApiError(400, "Category masih digunakan oleh beberapa Raw Material");
        }

        try {
            await prisma.rawMatCategories.delete({ where: { id } });
            return { deleted: 1 };
        } catch (e) {
            this.rethrowPrismaError(e);
        }
    }

    private static rethrowPrismaError(e: unknown): never {
        if (e instanceof Prisma.PrismaClientKnownRequestError) {
            if (e.code === "P2002") {
                throw new ApiError(400, "Category dengan nama tersebut sudah tersedia");
            }
            if (e.code === "P2025") {
                throw new ApiError(404, "Category tidak ditemukan");
            }
        }
        throw e;
    }
}
