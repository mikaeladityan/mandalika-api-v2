import prisma from "../../../../config/prisma.js";
import { Prisma } from "../../../../generated/prisma/client.js";
import { STATUS } from "../../../../generated/prisma/enums.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import { GetPagination } from "../../../../lib/utils/pagination.js";
import { getOrCreateSlug } from "../../../../lib/utils/upsert-slug.js";
import { getOrCreateSize } from "../../../../lib/utils/upsert-size.js";
import {
    FGLatestPeriodDTO,
    FGOutletStockDTO,
    FGRecipeItemDTO,
    FGWarehouseStockDTO,
    QueryFGDTO,
    RequestFGDTO,
    ResponseFGDetailDTO,
    ResponseFGDTO,
} from "./fg.schema.js";
import { FG_IMPORT_HEADERS } from "./import/import.schema.js";
import ExcelJS from "exceljs";

const EXPORT_MAX_ROWS = 50_000;

const SIZE_UNIT = "ML";

const formatSize = (size: number | null | undefined): string =>
    size != null ? `${size} ${SIZE_UNIT}` : "";

type ListFilters = Pick<QueryFGDTO, "type_id" | "size_id" | "gender" | "status" | "search">;

function buildProductWhere(query: ListFilters): Prisma.ProductWhereInput {
    const { type_id, size_id, gender, status, search } = query;
    return {
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
}

function buildProductOrderBy(
    sortBy: QueryFGDTO["sortBy"],
    sortOrder: QueryFGDTO["sortOrder"],
): Prisma.ProductOrderByWithRelationInput {
    const map: Record<string, Prisma.ProductOrderByWithRelationInput> = {
        code: { code: sortOrder },
        name: { name: sortOrder },
        gender: { gender: sortOrder },
        updated_at: { updated_at: sortOrder },
        created_at: { created_at: sortOrder },
        type: { product_type: { name: sortOrder } },
        size: { size: { size: sortOrder } },
    };
    return (sortBy && map[sortBy]) ?? { updated_at: "desc" };
}

// Kolom CSV export — header roundtrip wajib identik dengan key Zod di import.schema.ts (dev-flow §1.I).
// `roundtrip: true` = kolom yang juga dipakai untuk re-import; `false` = display-only.
const EXPORT_COLUMNS: ReadonlyArray<{
    header: string;
    key: string;
    width: number;
    id: string;
    roundtrip: boolean;
}> = [
    { header: "No", key: "no", width: 5, id: "no", roundtrip: false },
    { header: FG_IMPORT_HEADERS.code, key: "code", width: 15, id: "code", roundtrip: true },
    { header: FG_IMPORT_HEADERS.name, key: "name", width: 40, id: "name", roundtrip: true },
    { header: FG_IMPORT_HEADERS.type, key: "type", width: 20, id: "type", roundtrip: true },
    { header: FG_IMPORT_HEADERS.gender, key: "gender", width: 12, id: "gender", roundtrip: true },
    { header: FG_IMPORT_HEADERS.size, key: "size", width: 10, id: "size", roundtrip: true },
    {
        header: FG_IMPORT_HEADERS.distribution,
        key: "distribution",
        width: 12,
        id: "distribution_percentage",
        roundtrip: true,
    },
    {
        header: FG_IMPORT_HEADERS.safety,
        key: "safety",
        width: 12,
        id: "safety_percentage",
        roundtrip: true,
    },
    { header: "Lead Time", key: "lead_time", width: 12, id: "lead_time", roundtrip: false },
    { header: "Nilai Z", key: "z_value", width: 10, id: "z_value", roundtrip: false },
    { header: "Status", key: "status", width: 15, id: "status", roundtrip: false },
];

// --- Typed selects untuk detail() — relasi terkait disempitkan ke field yang dipakai DTO.
const DETAIL_PRODUCT_INCLUDE = {
    product_type: true,
    size: true,
} satisfies Prisma.ProductInclude;

const DETAIL_RECIPE_SELECT = {
    id: true,
    quantity: true,
    version: true,
    is_active: true,
    raw_materials: {
        select: {
            id: true,
            name: true,
            unit_raw_material: { select: { name: true } },
            supplier_materials: {
                where: { is_preferred: true },
                take: 1,
                select: { unit_price: true },
            },
        },
    },
} satisfies Prisma.RecipesSelect;

const DETAIL_WAREHOUSE_STOCK_SELECT = {
    quantity: true,
    min_stock: true,
    warehouse: { select: { id: true, name: true, code: true, type: true } },
} satisfies Prisma.ProductInventorySelect;

const DETAIL_OUTLET_STOCK_SELECT = {
    quantity: true,
    min_stock: true,
    outlet: { select: { id: true, name: true, code: true, type: true } },
} satisfies Prisma.OutletInventorySelect;

type DetailProduct = Prisma.ProductGetPayload<{ include: typeof DETAIL_PRODUCT_INCLUDE }>;
type DetailRecipeRow = Prisma.RecipesGetPayload<{ select: typeof DETAIL_RECIPE_SELECT }>;
type DetailWarehouseStockRow = Prisma.ProductInventoryGetPayload<{
    select: typeof DETAIL_WAREHOUSE_STOCK_SELECT;
}>;
type DetailOutletStockRow = Prisma.OutletInventoryGetPayload<{
    select: typeof DETAIL_OUTLET_STOCK_SELECT;
}>;

export class FGService {
    static async create(body: RequestFGDTO) {
        const { code, product_type, size, ...reqBody } = body;

        try {
            return await prisma.$transaction(async (tx) => {
                const [type_id, size_id] = await Promise.all([
                    product_type ? getOrCreateSlug(tx.productType, product_type) : null,
                    size ? getOrCreateSize(tx, size) : null,
                ]);

                const result = await tx.product.create({
                    data: { ...reqBody, code, type_id, size_id },
                    include: { product_type: true, size: true },
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
                throw new ApiError(400, `Produk dengan kode: ${code} telah tersedia`);
            }
            throw e;
        }
    }

    static async update(id: number, body: Partial<RequestFGDTO>) {
        const product = await prisma.product.findUnique({
            where: { id },
            select: { id: true, code: true, type_id: true, size_id: true },
        });
        if (!product) throw new ApiError(404, "Produk tidak ditemukan");

        const { code, product_type, size, ...reqBody } = body;

        try {
            return await prisma.$transaction(async (tx) => {
                const [type_id, size_id] = await Promise.all([
                    product_type ? getOrCreateSlug(tx.productType, product_type) : product.type_id,
                    size ? getOrCreateSize(tx, size) : product.size_id,
                ]);

                const result = await tx.product.update({
                    where: { id },
                    data: { ...reqBody, code: code ?? product.code, type_id, size_id },
                    include: { product_type: true, size: true },
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
        if (!existing) throw new ApiError(404, `Produk dengan ID ${id} tidak ditemukan`);

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
        const where = buildProductWhere(query);

        const total = await prisma.product.count({ where });
        if (total > EXPORT_MAX_ROWS) {
            throw new ApiError(
                400,
                `Data terlalu besar (${total} baris). Gunakan filter untuk membatasi maksimal ${EXPORT_MAX_ROWS} baris.`,
            );
        }

        const products = await prisma.product.findMany({
            where,
            include: { product_type: true, size: true },
            orderBy: buildProductOrderBy(query.sortBy, query.sortOrder),
            take: EXPORT_MAX_ROWS,
        });

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Data Produk");

        const visibleCols = query.visibleColumns ? query.visibleColumns.split(",") : [];
        const hasVisibility = visibleCols.length > 0;

        const filteredColumns = hasVisibility
            ? EXPORT_COLUMNS.filter((col) => col.id === "no" || visibleCols.includes(col.id))
            : EXPORT_COLUMNS;

        sheet.columns = filteredColumns.map(({ header, key, width }) => ({ header, key, width }));

        products.forEach((p, index) => {
            sheet.addRow({
                no: index + 1,
                code: p.code ?? "",
                name: p.name,
                type: p.product_type?.name ?? "",
                gender: p.gender,
                size: p.size?.size ?? "",
                distribution: Number(p.distribution_percentage),
                safety: Number(p.safety_percentage),
                lead_time: p.lead_time,
                z_value: Number(p.z_value),
                status: p.status,
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
            if (products.length === 0)
                throw new ApiError(400, "Tidak ada produk yang akan dihapus");

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
        const { page = 1, take = 10 } = query;
        const { skip, take: limit } = GetPagination(page, take);

        const where = buildProductWhere(query);
        const orderBy = buildProductOrderBy(query.sortBy, query.sortOrder);

        const [products, len] = await Promise.all([
            prisma.product.findMany({
                where,
                include: { product_type: true, size: true },
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
            size: formatSize(p.size?.size),
            product_type: p.product_type?.name ?? null,
        }));

        return { data, len };
    }

    static async detail(id: number): Promise<ResponseFGDetailDTO> {
        // Empat query paralel: produk, period stok terbaru, recipes aktif, stok outlet aktif.
        // Stok per warehouse menyusul setelah period terbaru diketahui (dependent query).
        const [product, latestPeriod, recipeRows, outletStockRows] = await Promise.all([
            prisma.product.findUnique({ where: { id }, include: DETAIL_PRODUCT_INCLUDE }),
            this.findLatestStockPeriod(id),
            prisma.recipes.findMany({
                where: { product_id: id, is_active: true },
                orderBy: { id: "asc" },
                select: DETAIL_RECIPE_SELECT,
            }),
            prisma.outletInventory.findMany({
                where: { product_id: id, outlet: { deleted_at: null } },
                orderBy: { outlet_id: "asc" },
                select: DETAIL_OUTLET_STOCK_SELECT,
            }),
        ]);

        if (!product) throw new ApiError(404, "Produk tidak ditemukan");

        const warehouseStockRows = latestPeriod
            ? await prisma.productInventory.findMany({
                  where: { product_id: id, ...latestPeriod },
                  orderBy: { warehouse_id: "asc" },
                  select: DETAIL_WAREHOUSE_STOCK_SELECT,
              })
            : [];

        return {
            ...this.toFGBaseDTO(product),
            recipes: recipeRows.map((row) => this.toRecipeDTO(row)),
            stock: {
                latest_period: latestPeriod,
                warehouse_stocks: warehouseStockRows.map((row) => this.toWarehouseStockDTO(row)),
                outlet_stocks: outletStockRows.map((row) => this.toOutletStockDTO(row)),
            },
        };
    }

    // --- Detail helpers (top-down: detail() above, helpers below) ---

    private static async findLatestStockPeriod(productId: number): Promise<FGLatestPeriodDTO | null> {
        return prisma.productInventory.findFirst({
            where: { product_id: productId },
            orderBy: [{ year: "desc" }, { month: "desc" }, { date: "desc" }],
            select: { year: true, month: true, date: true },
        });
    }

    private static toFGBaseDTO(product: DetailProduct): ResponseFGDTO {
        return {
            ...product,
            z_value: Number(product.z_value),
            distribution_percentage: Number(product.distribution_percentage),
            safety_percentage: Number(product.safety_percentage),
            size: formatSize(product.size?.size),
            product_type: product.product_type?.name ?? null,
        };
    }

    private static toRecipeDTO(row: DetailRecipeRow): FGRecipeItemDTO {
        const preferred = row.raw_materials.supplier_materials[0];
        return {
            id: row.id,
            quantity: Number(row.quantity),
            version: row.version,
            is_active: row.is_active,
            raw_material: {
                id: row.raw_materials.id,
                name: row.raw_materials.name,
                unit: row.raw_materials.unit_raw_material?.name ?? null,
                preferred_unit_price: preferred ? Number(preferred.unit_price) : null,
            },
        };
    }

    private static toWarehouseStockDTO(row: DetailWarehouseStockRow): FGWarehouseStockDTO {
        return {
            quantity: Number(row.quantity),
            min_stock: row.min_stock != null ? Number(row.min_stock) : null,
            warehouse: {
                id: row.warehouse.id,
                name: row.warehouse.name,
                code: row.warehouse.code,
                type: row.warehouse.type,
            },
        };
    }

    private static toOutletStockDTO(row: DetailOutletStockRow): FGOutletStockDTO {
        return {
            quantity: Number(row.quantity),
            min_stock: row.min_stock != null ? Number(row.min_stock) : null,
            outlet: {
                id: row.outlet.id,
                name: row.outlet.name,
                code: row.outlet.code,
                type: row.outlet.type,
            },
        };
    }
}
