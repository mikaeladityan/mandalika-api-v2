import prisma from "../../../../config/prisma.js";
import { Prisma, Supplier } from "../../../../generated/prisma/client.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { normalizeSlug } from "../../../../lib/index.js";
import { GetPagination } from "../../../../lib/utils/pagination.js";
import { QuerySupplierDTO, RequestSupplierDTO, ResponseSupplierDTO } from "./supplier.schema.js";

const SORT_MAP: Record<string, string> = {
    country: "country",
    name: "name",
    updated_at: "updated_at",
    created_at: "created_at",
};

export class SupplierService {
    static async create(data: RequestSupplierDTO): Promise<ResponseSupplierDTO> {
        if (data.phone) {
            const exists = await prisma.supplier.findUnique({ where: { phone: data.phone } });
            if (exists) throw new ApiError(400, "Nomor telepon supplier sudah digunakan");
        }

        return prisma.supplier.create({
            data: {
                name: data.name,
                slug: normalizeSlug(data.name),
                addresses: data.addresses,
                country: data.country,
                phone: data.phone || null,
                source: data.source as any,
            },
        });
    }

    static async update(
        id: number,
        payload: Partial<RequestSupplierDTO>,
    ): Promise<ResponseSupplierDTO> {
        const supplier = await this.findSupplier(id);
        if (!supplier) throw new ApiError(404, "Supplier tidak ditemukan");

        if (payload.phone) {
            const phoneExists = await prisma.supplier.findFirst({
                where: { phone: payload.phone, id: { not: id } },
            });
            if (phoneExists) throw new ApiError(400, "Nomor telepon supplier sudah digunakan");
        }

        return prisma.supplier.update({
            where: { id },
            data: {
                ...(payload.name !== undefined && {
                    name: payload.name,
                    slug: normalizeSlug(payload.name),
                }),
                ...(payload.addresses !== undefined && { addresses: payload.addresses }),
                ...(payload.country !== undefined && { country: payload.country }),
                ...(payload.phone !== undefined && { phone: payload.phone || null }),
                ...(payload.source !== undefined && { source: payload.source as any }),
            },
        });
    }

    static async detail(id: number): Promise<ResponseSupplierDTO> {
        const rows = await prisma.$queryRaw<ResponseSupplierDTO[]>(Prisma.sql`
            SELECT id, name, addresses, country, phone, source, created_at, updated_at
            FROM suppliers
            WHERE id = ${id}
            LIMIT 1
        `);

        if (!rows.length) throw new ApiError(404, "Supplier tidak ditemukan");

        return rows[0] as ResponseSupplierDTO;
    }

    static async delete(id: number) {
        const supplier = await this.findSupplier(id);
        if (!supplier) throw new ApiError(404, "Supplier tidak ditemukan");

        const usedCount = await prisma.supplierMaterial.count({ where: { supplier_id: id } });
        if (usedCount > 0)
            throw new ApiError(400, "Supplier masih digunakan oleh beberapa Raw Material");

        return prisma.supplier.delete({ where: { id } });
    }

    static async bulkDelete(ids: number[]) {
        const suppliers = await prisma.supplier.findMany({
            where: { id: { in: ids } },
            include: { _count: { select: { supplier_materials: true } } },
        });

        if (suppliers.length !== ids.length) {
            throw new ApiError(404, "Beberapa supplier tidak ditemukan");
        }

        const usedSuppliers = suppliers.filter((s) => (s as any)._count.supplier_materials > 0);
        if (usedSuppliers.length > 0) {
            const names = usedSuppliers.map((s) => s.name).join(", ");
            throw new ApiError(
                400,
                `Beberapa supplier (${names}) masih digunakan oleh Raw Material`,
            );
        }

        return prisma.supplier.deleteMany({ where: { id: { in: ids } } });
    }

    static async list({
        page = 1,
        take = 10,
        sortBy = "updated_at",
        sortOrder = "desc",
        search,
    }: QuerySupplierDTO): Promise<{ data: any[]; len: number }> {
        const { skip, take: limit } = GetPagination(page, take);

        const where: any = search
            ? {
                OR: [
                    { name: { contains: search, mode: "insensitive" } },
                    { phone: { contains: search, mode: "insensitive" } },
                    { country: { contains: search, mode: "insensitive" } },
                ],
            }
            : {};

        const [data, total] = await Promise.all([
            prisma.supplier.findMany({
                where,
                skip,
                take: limit,
                orderBy: { [sortBy]: sortOrder as any },
                include: {
                    supplier_materials: {
                        include: {
                            raw_material: {
                                include: {
                                    unit_raw_material: true,
                                },
                            },
                        },
                    },
                },
            }),
            prisma.supplier.count({ where }),
        ]);

        return { len: total, data };
    }

    private static async findSupplier(id: number): Promise<Supplier | null> {
        return prisma.supplier.findUnique({ where: { id } });
    }
}
