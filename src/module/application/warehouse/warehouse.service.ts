import {
    QueryWarehouseDTO,
    RequestWarehouseDTO,
    ResponseWarehouseDTO,
} from "./warehouse.schema.js";
import prisma from "../../../config/prisma.js";
import { ApiError } from "../../../lib/errors/api.error.js";
import { GetPagination } from "../../../lib/utils/pagination.js";
import { STATUS } from "../../../generated/prisma/enums.js";
import { Prisma } from "../../../generated/prisma/client.js";

export class WarehouseService {
    private static async getLatestInventoryPeriod() {
        const latestProduct = await prisma.productInventory.findFirst({
            orderBy: [{ year: "desc" }, { month: "desc" }],
            select: { month: true, year: true },
        });

        if (!latestProduct) {
            return { month: new Date().getMonth() + 1, year: new Date().getFullYear() };
        }

        return latestProduct;
    }

    static async create(body: RequestWarehouseDTO) {
        return await prisma.warehouse.create({
            data: {
                name: body.name,
                type: body.type,
                warehouse_address: {
                    create: body.warehouse_address,
                },
            },
            include: { warehouse_address: true },
        });
    }

    static async update(id: number, body: Partial<RequestWarehouseDTO>) {
        const warehouse = await prisma.warehouse.findUnique({ where: { id, deleted_at: null } });
        if (!warehouse) throw new ApiError(404, "Gudang tidak ditemukan");

        return await prisma.warehouse.update({
            where: { id },
            data: {
                name: body.name,
                type: body.type,
                warehouse_address: body.warehouse_address
                    ? {
                          upsert: {
                              create: body.warehouse_address,
                              update: body.warehouse_address,
                          },
                      }
                    : undefined,
            },
            include: { warehouse_address: true },
        });
    }

    static async list(
        query: QueryWarehouseDTO,
    ): Promise<{ data: ResponseWarehouseDTO[]; len: number }> {
        const {
            page = 1,
            take = 25,
            search,
            sortBy = "updated_at",
            sortOrder = "asc",
            type,
        } = query;
        const { skip, take: limit } = GetPagination(page, take);

        const where: Prisma.WarehouseWhereInput = {
            deleted_at: null,
            ...(type && { type }),
            ...(search && { name: { contains: search, mode: "insensitive" } }),
        };

        const [data, len] = await Promise.all([
            prisma.warehouse.findMany({
                where,
                include: { warehouse_address: true },
                orderBy: { [sortBy]: sortOrder },
                skip,
                take: limit,
            }),
            prisma.warehouse.count({ where }),
        ]);

        return { data: data as unknown as ResponseWarehouseDTO[], len };
    }

    static async detail(id: number): Promise<ResponseWarehouseDTO> {
        const warehouse = await prisma.warehouse.findUnique({
            where: { id, deleted_at: null },
            include: { warehouse_address: true },
        });

        if (!warehouse) throw new ApiError(404, "Gudang tidak ditemukan");

        return warehouse as unknown as ResponseWarehouseDTO;
    }

    static async changeStatus(id: number, status: STATUS) {
        const warehouse = await prisma.warehouse.findUnique({
            where: {
                id,
                deleted_at: status === "DELETE" ? null : { not: null },
            },
        });

        if (!warehouse) throw new ApiError(404, "Data gudang tidak ditemukan");

        return await prisma.warehouse.update({
            where: { id },
            data: {
                deleted_at: status === "DELETE" ? new Date() : null,
            },
        });
    }

    static async deleted(id: number) {
        const warehouse = await prisma.warehouse.findUnique({ where: { id } });
        if (!warehouse) throw new ApiError(404, "Data gudang tidak ditemukan");

        await prisma.$transaction([
            prisma.warehouseAddress.delete({ where: { warehouse_id: id } }),
            prisma.warehouse.delete({ where: { id } }),
        ]);
    }

    static async getStock(warehouse_id: number, product_id: number) {
        const warehouse = await prisma.warehouse.findUnique({
            where: { id: warehouse_id, deleted_at: null },
        });
        
        if (!warehouse) {
            throw new ApiError(404, "Gudang tidak ditemukan");
        }

        const period = await this.getLatestInventoryPeriod();

        const invs = await prisma.productInventory.findMany({
            where: {
                product_id,
                warehouse_id,
                month: period.month,
                year: period.year,
            },
        });

        const quantity = invs.reduce((sum, inv) => {
            const val = Number(inv.quantity || 0);
            return sum + val;
        }, 0);

        return {
            quantity,
            min_stock: invs.length > 0 ? Number(invs[0]?.min_stock || 0) : null,
            location_name: warehouse.name,
        };
    }
}
