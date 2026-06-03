import prisma from "../../../../../config/prisma.js";
import { Prisma } from "../../../../../generated/prisma/client.js";
import { ApiError } from "../../../../../lib/errors/api.error.js";
import { normalizeSlug } from "../../../../../lib/index.js";
import { GetPagination } from "../../../../../lib/utils/pagination.js";
import {
    QueryRawMaterialUnitDTO,
    RequestRawMaterialUnitDTO,
    ResponseRawMaterialUnitDTO,
    UpdateRawMaterialUnitDTO,
} from "./unit.schema.js";

const UNIT_SELECT = {
    id: true,
    name: true,
    slug: true,
} satisfies Prisma.UnitRawMaterialSelect;

export class UnitRawMaterialService {
    static async create(payload: RequestRawMaterialUnitDTO): Promise<ResponseRawMaterialUnitDTO> {
        try {
            return await prisma.unitRawMaterial.create({
                data: {
                    name: payload.name.trim(),
                    slug: normalizeSlug(payload.name),
                },
                select: UNIT_SELECT,
            });
        } catch (e) {
            this.rethrowPrismaError(e);
        }
    }

    static async update(
        id: number,
        payload: UpdateRawMaterialUnitDTO,
    ): Promise<ResponseRawMaterialUnitDTO> {
        if (!payload.name) throw new ApiError(400, "Nama unit wajib diisi");

        try {
            return await prisma.unitRawMaterial.update({
                where: { id },
                data: { name: payload.name.trim(), slug: normalizeSlug(payload.name) },
                select: UNIT_SELECT,
            });
        } catch (e) {
            this.rethrowPrismaError(e);
        }
    }

    static async detail(id: number): Promise<ResponseRawMaterialUnitDTO> {
        const unit = await prisma.unitRawMaterial.findUnique({
            where: { id },
            select: UNIT_SELECT,
        });
        if (!unit) throw new ApiError(404, "Unit tidak ditemukan");
        return unit;
    }

    static async list(
        query: QueryRawMaterialUnitDTO,
    ): Promise<{ data: ResponseRawMaterialUnitDTO[]; len: number }> {
        const { page, take, search, sortBy, sortOrder } = query;
        const { skip, take: limit } = GetPagination(page, take);

        const where: Prisma.UnitRawMaterialWhereInput = search
            ? {
                  OR: [
                      { name: { contains: search, mode: "insensitive" } },
                      { slug: { contains: search, mode: "insensitive" } },
                  ],
              }
            : {};

        const orderBy: Prisma.UnitRawMaterialOrderByWithRelationInput = { [sortBy]: sortOrder };

        const [data, len] = await Promise.all([
            prisma.unitRawMaterial.findMany({
                where,
                skip,
                take: limit,
                orderBy,
                select: UNIT_SELECT,
            }),
            prisma.unitRawMaterial.count({ where }),
        ]);

        return { data, len };
    }

    static async delete(id: number): Promise<{ deleted: number }> {
        const usedCount = await prisma.rawMaterial.count({ where: { unit_id: id } });
        if (usedCount > 0) {
            throw new ApiError(400, "Satuan masih digunakan oleh beberapa Raw Material");
        }

        try {
            await prisma.unitRawMaterial.delete({ where: { id } });
            return { deleted: 1 };
        } catch (e) {
            this.rethrowPrismaError(e);
        }
    }

    private static rethrowPrismaError(e: unknown): never {
        if (e instanceof Prisma.PrismaClientKnownRequestError) {
            if (e.code === "P2002") {
                throw new ApiError(400, "Unit dengan nama tersebut sudah tersedia");
            }
            if (e.code === "P2025") {
                throw new ApiError(404, "Unit tidak ditemukan");
            }
        }
        throw e;
    }
}
