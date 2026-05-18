import prisma from "../../../../config/prisma.js";
import { Prisma } from "../../../../generated/prisma/client.js";
import { STATUS } from "../../../../generated/prisma/enums.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { normalizeSlug } from "../../../../lib/index.js";
import { GetPagination } from "../../../../lib/utils/pagination.js";
import { FGLookupDTO, QueryFGDTO, RequestFGDTO, ResponseFGDTO } from "./fg.schema.js";
import ExcelJS from "exceljs";

const EXPORT_MAX_ROWS = 50_000;

// Subset delegate untuk slug-based lookup table (productType, unit) — atomic upsert.
type UpsertSlugDelegate = {
    upsert: (args: {
        where: { slug: string };
        update: Record<string, never>;
        create: { name: string; slug: string };
        select: { id: true };
    }) => Promise<{ id: number }>;
};

type FGDetailPayload = Prisma.ProductGetPayload<{
    include: {
        product_type: true;
        unit: true;
        size: true;
        product_inventories: { include: { warehouse: true } };
        recipes: {
            include: {
                raw_materials: {
                    include: {
                        unit_raw_material: true;
                        supplier_materials: true;
                    };
                };
            };
        };
    };
}>;

export type FGDetailResponse = Omit<
    FGDetailPayload,
    "z_value" | "distribution_percentage" | "safety_percentage" | "size" | "unit" | "product_type"
> & {
    z_value: number;
    distribution_percentage: number;
    safety_percentage: number;
    size: string;
    unit: string | null;
    product_type: string | null;
};

export class FGService {
    // --- Helper Methods ---

    private static async getOrCreate(
        model: UpsertSlugDelegate,
        name: string | number,
    ): Promise<number> {
        if (typeof name !== "string") return name;

        const formattedName = name.trim();
        const slug = normalizeSlug(formattedName);

        const result = await model.upsert({
            where: { slug },
            update: {},
            create: { name: formattedName, slug },
            select: { id: true },
        });
        return result.id;
    }

    private static async getOrCreateSize(
        tx: Prisma.TransactionClient,
        size: number,
    ): Promise<number> {
        const result = await tx.productSize.upsert({
            where: { size },
            update: {},
            create: { size },
            select: { id: true },
        });
        return result.id;
    }

    // --- Core Methods ---

    static async create(body: RequestFGDTO) {
        const { code, product_type, unit, size, ...reqBody } = body;

        try {
            return await prisma.$transaction(async (tx) => {
                const [type_id, unit_id, size_id] = await Promise.all([
                    product_type ? this.getOrCreate(tx.productType, product_type) : null,
                    unit ? this.getOrCreate(tx.unit, unit) : null,
                    size ? this.getOrCreateSize(tx, size) : null,
                ]);

                const result = await tx.product.create({
                    data: { ...reqBody, code, type_id, unit_id, size_id },
                    include: { product_type: true, unit: true, size: true },
                });

                return {
                    ...result,
                    z_value: Number(result.z_value),
                    distribution_percentage: Number(result.distribution_percentage),
                    safety_percentage: Number(result.safety_percentage),
                };
            });
        } catch (e) {
            // Tangkap P2002 (bukan pre-check) supaya atomic dari race condition concurrent create.
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
                throw new ApiError(400, `Produk dengan kode: ${code} telah tersedia`);
            }
            throw e;
        }
    }

    static async update(id: number, body: Partial<RequestFGDTO>) {
        const product = await prisma.product.findUnique({
            where: { id },
            select: { id: true, code: true, type_id: true, unit_id: true, size_id: true },
        });
        if (!product) throw new ApiError(404, "Produk tidak ditemukan");

        const { code, unit, product_type, size, ...reqBody } = body;

        try {
            return await prisma.$transaction(async (tx) => {
                const [type_id, unit_id, size_id] = await Promise.all([
                    product_type ? this.getOrCreate(tx.productType, product_type) : product.type_id,
                    unit ? this.getOrCreate(tx.unit, unit) : product.unit_id,
                    size ? this.getOrCreateSize(tx, size) : product.size_id,
                ]);

                const result = await tx.product.update({
                    where: { id },
                    data: { ...reqBody, code: code ?? product.code, type_id, unit_id, size_id },
                    include: { product_type: true, unit: true, size: true },
                });

                return {
                    ...result,
                    z_value: Number(result.z_value),
                    distribution_percentage: Number(result.distribution_percentage),
                    safety_percentage: Number(result.safety_percentage),
                };
            });
        } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
                throw new ApiError(400, "Kode Produk telah digunakan");
            }
            throw e;
        }
    }

    static async status(id: number, status: STATUS) {
        const existing = await prisma.product.findUnique({ where: { id }, select: { id: true } });
        if (!existing) throw new ApiError(404, `Produk dengan kode ${id} tidak ditemukan`);

        await prisma.product.update({
            where: { id },
            data: { deleted_at: status === STATUS.DELETE ? new Date() : null, status },
        });
    }

    static async bulkStatus(ids: number[], status: STATUS) {
        if (!ids?.length) throw new ApiError(400, "Tidak ada produk yang dipilih");

        const { count } = await prisma.product.updateMany({
            where: { id: { in: ids } },
            data: { deleted_at: status === STATUS.DELETE ? new Date() : null, status },
        });

        if (count === 0) throw new ApiError(404, "Tidak ada produk yang cocok dengan id terpilih");
        return { affected: count };
    }

    static async export(query: QueryFGDTO) {
        const { data, len } = await this.list({ ...query, take: EXPORT_MAX_ROWS, page: 1 });
        if (len > EXPORT_MAX_ROWS) {
            throw new ApiError(
                400,
                `Data terlalu besar (${len} baris). Gunakan filter untuk membatasi maksimal ${EXPORT_MAX_ROWS} baris.`,
            );
        }

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Data Produk");

        const visibleCols = query.visibleColumns ? query.visibleColumns.split(",") : [];
        const hasVisibility = visibleCols.length > 0;

        const allColumns = [
            { header: "No", key: "no", width: 5, id: "no" },
            { header: "Kode", key: "code", width: 15, id: "code" },
            { header: "Nama Produk", key: "name", width: 40, id: "name" },
            { header: "Tipe", key: "type", width: 20, id: "type" },
            { header: "Size", key: "size", width: 10, id: "size" },
            { header: "Unit", key: "unit", width: 10, id: "unit" },
            { header: "Gender", key: "gender", width: 15, id: "gender" },
            { header: "Lead Time", key: "lead_time", width: 12, id: "lead_time" },
            { header: "Nilai Z", key: "z_value", width: 10, id: "z_value" },
            { header: "Distribusi %", key: "distribution", width: 15, id: "distribution_percentage" },
            { header: "Safety %", key: "safety", width: 15, id: "safety_percentage" },
            { header: "Status", key: "status", width: 15, id: "status" },
        ];

        const filteredColumns = hasVisibility
            ? allColumns.filter((col) => col.id === "no" || visibleCols.includes(col.id))
            : allColumns;

        sheet.columns = filteredColumns.map(({ header, key, width }) => ({ header, key, width }));

        data.forEach((item, index) => {
            sheet.addRow({
                no: index + 1,
                code: item.code || "-",
                name: item.name,
                type: item.product_type ?? "-",
                size: item.size || "-",
                unit: item.unit ?? "-",
                gender: item.gender,
                lead_time: item.lead_time,
                z_value: item.z_value,
                distribution: item.distribution_percentage,
                safety: item.safety_percentage,
                status: item.status,
            });
        });

        sheet.getRow(1).font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
        sheet.getRow(1).height = 25;
        sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0070C0" } };
        sheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };

        return await workbook.csv.writeBuffer();
    }

    static async clean() {
        return await prisma.$transaction(async (tx) => {
            const products = await tx.product.findMany({
                where: { deleted_at: { not: null }, status: STATUS.DELETE },
                select: { id: true },
            });
            if (products.length === 0) throw new ApiError(400, "Tidak ada produk yang akan dihapus");

            const ids = products.map((p) => p.id);

            // ProductionOrder FK = RESTRICT — cek dulu supaya tx tidak abort di tengah cascade.
            const productionRefs = await tx.productionOrder.count({
                where: { product_id: { in: ids } },
            });
            if (productionRefs > 0) {
                throw new ApiError(
                    409,
                    "Produk masih terkait dengan Production Order. Hapus permanen ditolak.",
                );
            }

            await tx.productionOrderWaste.deleteMany({ where: { product_id: { in: ids } } });
            await tx.productionOrderOutput.deleteMany({ where: { product_id: { in: ids } } });
            await tx.outletInventory.deleteMany({ where: { product_id: { in: ids } } });
            await tx.productInventory.deleteMany({ where: { product_id: { in: ids } } });
            await tx.productIssuance.deleteMany({ where: { product_id: { in: ids } } });
            await tx.recipes.deleteMany({ where: { product_id: { in: ids } } });
            await tx.safetyStock.deleteMany({ where: { product_id: { in: ids } } });
            await tx.stockTransferItem.deleteMany({ where: { product_id: { in: ids } } });
            await tx.goodsReceiptItem.deleteMany({ where: { product_id: { in: ids } } });
            await tx.stockReturnItem.deleteMany({ where: { product_id: { in: ids } } });

            const { count } = await tx.product.deleteMany({ where: { id: { in: ids } } });
            return { deleted: count };
        });
    }

    static async list(query: QueryFGDTO): Promise<{ data: ResponseFGDTO[]; len: number }> {
        const {
            page = 1,
            take = 10,
            sortBy = "updated_at",
            sortOrder = "desc",
            gender,
            search,
            status,
            type_id,
            size_id,
        } = query;
        const { skip, take: limit } = GetPagination(page, take);

        const where: Prisma.ProductWhereInput = {
            ...(type_id && { type_id }),
            ...(size_id && { size_id }),
            ...(gender && { gender }),
            ...(status ? { status } : { status: { not: STATUS.DELETE } }),
            ...(search && {
                OR: [
                    { name: { contains: search, mode: "insensitive" } },
                    { code: { contains: search, mode: "insensitive" } },
                    { product_type: { name: { contains: search, mode: "insensitive" } } },
                ],
            }),
        };

        const orderByMap: Record<string, Prisma.ProductOrderByWithRelationInput> = {
            code: { code: sortOrder },
            name: { name: sortOrder },
            gender: { gender: sortOrder },
            updated_at: { updated_at: sortOrder },
            created_at: { created_at: sortOrder },
            type: { product_type: { name: sortOrder } },
            size: { size: { size: sortOrder } },
        };
        const orderBy = orderByMap[sortBy] ?? { updated_at: "desc" };

        const [products, len] = await Promise.all([
            prisma.product.findMany({
                where,
                include: { product_type: true, unit: true, size: true },
                orderBy,
                skip,
                take: limit,
            }),
            prisma.product.count({ where }),
        ]);

        const data: ResponseFGDTO[] = products.map((p) => ({
            ...p,
            z_value: Number(p.z_value),
            distribution_percentage: Number(p.distribution_percentage),
            safety_percentage: Number(p.safety_percentage),
            size: `${p.size?.size ?? ""}${p.unit?.name ?? ""}`,
            unit: p.unit?.name ?? null,
            product_type: p.product_type?.name ?? null,
        }));

        return { data, len };
    }

    static async lookup(): Promise<FGLookupDTO[]> {
        const products = await prisma.product.findMany({
            where: { status: { not: STATUS.DELETE } },
            select: {
                id: true,
                code: true,
                name: true,
                gender: true,
                size: { select: { size: true } },
                unit: { select: { name: true } },
                product_type: { select: { name: true } },
            },
            orderBy: { name: "asc" },
        });

        return products.map((p) => ({
            id: p.id,
            code: p.code,
            name: p.name,
            gender: p.gender,
            size: `${p.size?.size ?? ""}${p.unit?.name ?? ""}`,
            unit: p.unit?.name ?? null,
            product_type: p.product_type?.name ?? null,
        }));
    }

    static async detail(id: number): Promise<FGDetailResponse> {
        const product = await prisma.product.findUnique({
            where: { id },
            include: {
                product_type: true,
                unit: true,
                size: true,
                product_inventories: { include: { warehouse: true } },
                recipes: {
                    where: { is_active: true },
                    include: {
                        raw_materials: {
                            include: {
                                unit_raw_material: true,
                                supplier_materials: { where: { is_preferred: true }, take: 1 },
                            },
                        },
                    },
                },
            },
        });

        if (!product) throw new ApiError(404, "Produk tidak ditemukan");

        return {
            ...product,
            z_value: Number(product.z_value),
            distribution_percentage: Number(product.distribution_percentage),
            safety_percentage: Number(product.safety_percentage),
            size: `${product.size?.size ?? ""}${product.unit?.name ?? ""}`,
            unit: product.unit?.name ?? null,
            product_type: product.product_type?.name ?? null,
        };
    }
}
