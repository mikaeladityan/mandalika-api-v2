import { Prisma } from "../../../generated/prisma/client.js";
import { WarehouseType } from "../../../generated/prisma/enums.js";
import prisma from "../../../config/prisma.js";
import { ApiError } from "../../../lib/errors/api.error.js";
import { GetPagination } from "../../../lib/utils/pagination.js";
import { QueryOutletDTO, RequestOutletDTO, UpdateOutletDTO } from "./outlet.schema.js";

export class OutletService {
    private static async validateFinishGoodsWarehouse(warehouse_id: number) {
        const warehouse = await prisma.warehouse.findUnique({
            where: { id: warehouse_id, deleted_at: null },
        });
        if (!warehouse) throw new ApiError(404, "Gudang tidak ditemukan");
        if (warehouse.type !== WarehouseType.FINISH_GOODS)
            throw new ApiError(422, "Outlet hanya dapat terhubung dengan gudang bertipe Barang Jadi (Finish Goods)");
    }

    static async create(body: RequestOutletDTO) {
        const existing = await prisma.outlet.findUnique({ where: { code: body.code } });
        if (existing) throw new ApiError(409, `Kode outlet "${body.code}" sudah digunakan`);

        if (body.warehouse_id) await OutletService.validateFinishGoodsWarehouse(body.warehouse_id);

        return await prisma.outlet.create({
            data: {
                name: body.name,
                code: body.code,
                phone: body.phone ?? null,
                warehouse_id: body.warehouse_id ?? null,
                address: body.address ? { create: body.address } : undefined,
            },
            include: { address: true, warehouse: { select: { id: true, name: true, type: true } } },
        });
    }

    static async update(id: number, body: UpdateOutletDTO) {
        const outlet = await prisma.outlet.findUnique({ where: { id, deleted_at: null } });
        if (!outlet) throw new ApiError(404, "Outlet tidak ditemukan");

        if (body.code && body.code !== outlet.code) {
            const existing = await prisma.outlet.findUnique({ where: { code: body.code } });
            if (existing) throw new ApiError(409, `Kode outlet "${body.code}" sudah digunakan`);
        }

        if (body.warehouse_id) await OutletService.validateFinishGoodsWarehouse(body.warehouse_id);

        return await prisma.outlet.update({
            where: { id },
            data: {
                name: body.name,
                code: body.code,
                phone: body.phone,
                warehouse_id: body.warehouse_id,
                address: body.address
                    ? {
                          upsert: {
                              create: body.address,
                              update: body.address,
                          },
                      }
                    : undefined,
            },
            include: { address: true, warehouse: { select: { id: true, name: true, type: true } } },
        });
    }

    static async toggleStatus(id: number) {
        const outlet = await prisma.outlet.findUnique({ where: { id, deleted_at: null } });
        if (!outlet) throw new ApiError(404, "Outlet tidak ditemukan");

        return await prisma.outlet.update({
            where: { id },
            data: { is_active: !outlet.is_active },
            select: { id: true, name: true, code: true, is_active: true },
        });
    }

    static async delete(id: number) {
        const outlet = await prisma.outlet.findUnique({ where: { id, deleted_at: null } });
        if (!outlet) throw new ApiError(404, "Outlet tidak ditemukan");

        return await prisma.outlet.update({
            where: { id },
            data: { deleted_at: new Date() },
            select: { id: true, name: true, code: true },
        });
    }

    static async list(query: QueryOutletDTO) {
        const {
            page = 1,
            take = 25,
            search,
            is_active,
            warehouse_id,
            sortBy = "updated_at",
            sortOrder = "asc",
        } = query;
        const { skip, take: limit } = GetPagination(page, take);

        const where: Prisma.OutletWhereInput = {
            deleted_at: null,
            ...(is_active !== undefined && { is_active: is_active === "true" }),
            ...(warehouse_id && { warehouse_id }),
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
                include: {
                    address: true,
                    warehouse: { select: { id: true, name: true, type: true } },
                    _count: { select: { inventories: true } },
                },
                orderBy: { [sortBy]: sortOrder },
                skip,
                take: limit,
            }),
            prisma.outlet.count({ where }),
        ]);

        return { data, len };
    }

    static async detail(id: number) {
        const outlet = await prisma.outlet.findUnique({
            where: { id, deleted_at: null },
            include: {
                address: true,
                warehouse: { select: { id: true, name: true, type: true } },
                _count: { select: { inventories: true } },
            },
        });
        if (!outlet) throw new ApiError(404, "Outlet tidak ditemukan");
        return outlet;
    }

    static async clean() {
        const count = await prisma.outlet.count({
            where: {
                is_active: false,
                deleted_at: { not: null },
            },
        });

        if (count < 1) throw new ApiError(400, "Data outlet yang non aktif tidak ditemukan");

        await prisma.outlet.deleteMany({
            where: {
                is_active: false,
                deleted_at: { not: null },
            },
        });

        return { message: "Data outlet yang non aktif berhasil dihapus" };
    }
}
