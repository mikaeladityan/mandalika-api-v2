import prisma from "../../../../../config/prisma.js";
import { Prisma } from "../../../../../generated/prisma/client.js";
import { ApiError } from "../../../../../lib/errors/api.error.js";
import { normalizeSlug } from "../../../../../lib/index.js";
import { obscureSupplierName } from "../../../../../lib/utils/supplier-obscure.js";
import { GetPagination } from "../../../../../lib/utils/pagination.js";
import {
    BulkDeleteSupplierDTO,
    QuerySupplierDTO,
    RequestSupplierDTO,
    ResponseSupplierDTO,
} from "./supplier.schema.js";

const SUPPLIER_SELECT = {
    id: true,
    name: true,
    slug: true,
    addresses: true,
    country: true,
    phone: true,
    source: true,
    created_at: true,
    updated_at: true,
} satisfies Prisma.SupplierSelect;

const LIST_INCLUDE = {
    supplier_materials: {
        select: {
            id: true,
            unit_price: true,
            min_buy: true,
            lead_time: true,
            is_preferred: true,
            status: true,
            raw_material: {
                select: {
                    id: true,
                    barcode: true,
                    name: true,
                    unit_raw_material: { select: { id: true, name: true } },
                },
            },
        },
    },
} satisfies Prisma.SupplierInclude;

type SupplierListItem = Prisma.SupplierGetPayload<{ include: typeof LIST_INCLUDE }>;

export class SupplierService {
    static async create(body: RequestSupplierDTO): Promise<ResponseSupplierDTO> {
        try {
            const created = await prisma.supplier.create({
                data: {
                    name: body.name,
                    slug: normalizeSlug(body.name),
                    addresses: body.addresses,
                    country: body.country,
                    phone: body.phone ?? null,
                    source: body.source,
                },
                select: SUPPLIER_SELECT,
            });
            return { ...created, name: obscureSupplierName(created.id) };
        } catch (e) {
            this.rethrowPrismaError(e);
        }
    }

    static async update(
        id: number,
        body: Partial<RequestSupplierDTO>,
    ): Promise<ResponseSupplierDTO> {
        try {
            const updated = await prisma.supplier.update({
                where: { id },
                data: {
                    ...(body.name !== undefined && {
                        name: body.name,
                        slug: normalizeSlug(body.name),
                    }),
                    ...(body.addresses !== undefined && { addresses: body.addresses }),
                    ...(body.country !== undefined && { country: body.country }),
                    ...(body.phone !== undefined && { phone: body.phone ?? null }),
                    ...(body.source !== undefined && { source: body.source }),
                },
                select: SUPPLIER_SELECT,
            });
            return { ...updated, name: obscureSupplierName(updated.id) };
        } catch (e) {
            this.rethrowPrismaError(e);
        }
    }

    static async detail(id: number): Promise<ResponseSupplierDTO> {
        const supplier = await prisma.supplier.findUnique({
            where: { id },
            select: SUPPLIER_SELECT,
        });
        if (!supplier) throw new ApiError(404, "Supplier tidak ditemukan");
        return { ...supplier, name: obscureSupplierName(supplier.id) };
    }

    static async delete(id: number) {
        const usedCount = await prisma.supplierMaterial.count({ where: { supplier_id: id } });
        if (usedCount > 0) {
            throw new ApiError(400, "Supplier masih digunakan oleh beberapa Raw Material");
        }
        try {
            await prisma.supplier.delete({ where: { id } });
            return { deleted: 1 };
        } catch (e) {
            this.rethrowPrismaError(e);
        }
    }

    static async bulkDelete(ids: BulkDeleteSupplierDTO["ids"]) {
        const inUse = await prisma.supplier.findMany({
            where: { id: { in: ids }, supplier_materials: { some: {} } },
            select: { id: true, name: true },
        });
        if (inUse.length) {
            const names = inUse.map((s) => obscureSupplierName(s.id)).join(", ");
            throw new ApiError(
                400,
                `Beberapa supplier (${names}) masih digunakan oleh Raw Material`,
            );
        }

        const { count } = await prisma.supplier.deleteMany({ where: { id: { in: ids } } });
        if (count === 0) {
            throw new ApiError(404, "Tidak ada supplier yang cocok dengan id terpilih");
        }
        return { deleted: count };
    }

    static async list(
        query: QuerySupplierDTO,
    ): Promise<{ data: SupplierListItem[]; len: number }> {
        const { page, take, sortBy, sortOrder, search } = query;
        const { skip, take: limit } = GetPagination(page, take);

        const where: Prisma.SupplierWhereInput = search
            ? {
                  OR: [
                      { name: { contains: search, mode: "insensitive" } },
                      { phone: { contains: search } },
                      { country: { contains: search, mode: "insensitive" } },
                  ],
              }
            : {};

        const orderBy: Prisma.SupplierOrderByWithRelationInput = { [sortBy]: sortOrder };

        const [data, len] = await Promise.all([
            prisma.supplier.findMany({
                where,
                skip,
                take: limit,
                orderBy,
                include: LIST_INCLUDE,
            }),
            prisma.supplier.count({ where }),
        ]);
        const obscured = data.map((row) => ({
            ...row,
            name: obscureSupplierName(row.id),
        }));
        return { data: obscured, len };
    }

    private static rethrowPrismaError(e: unknown): never {
        if (e instanceof Prisma.PrismaClientKnownRequestError) {
            if (e.code === "P2002") {
                const target = (e.meta as { target?: string[] } | undefined)?.target ?? [];
                if (target.includes("phone")) {
                    throw new ApiError(400, "Nomor telepon supplier sudah digunakan");
                }
                if (target.includes("slug")) {
                    throw new ApiError(400, "Nama supplier sudah digunakan");
                }
                throw new ApiError(400, "Data supplier sudah digunakan");
            }
            if (e.code === "P2025") {
                throw new ApiError(404, "Supplier tidak ditemukan");
            }
        }
        throw e;
    }
}
