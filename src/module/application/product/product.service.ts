import { GENDER, Prisma, STATUS } from "../../../generated/prisma/client.js";
import { QueryProductDTO, RequestProductDTO, ResponseProductDTO } from "./product.schema.js";
import { PRODUCT_IMPORT_HEADERS } from "./import/import.schema.js";
import prisma from "../../../config/prisma.js";
import { ApiError } from "../../../lib/errors/api.error.js";
import { GetPagination } from "../../../lib/utils/pagination.js";
import { normalizeSlug } from "../../../lib/index.js";
import ExcelJS from "exceljs";

type UpsertBySlugDelegate = {
    upsert: (args: {
        where: { slug: string };
        update: Record<string, never>;
        create: { name: string; slug: string };
        select: { id: true };
    }) => Promise<{ id: number }>;
};

type ProductListRow = {
    id: number;
    name: string;
    code: string;
    unit_id: number | null;
    type_id: number | null;
    size_id: number | null;
    gender: GENDER;
    status: STATUS;
    description: string | null;
    z_value: Prisma.Decimal;
    lead_time: number;
    review_period: number;
    distribution_percentage: Prisma.Decimal | null;
    safety_percentage: Prisma.Decimal | null;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
    product_type: { id: number | null; name: string | null; slug: string | null };
    unit: { id: number | null; name: string | null; slug: string | null };
    size: { id: number | null; size: number | null };
    group_sort_priority: Prisma.Decimal | number | null;
};

const EXPORT_MAX_ROWS = 50_000;
const CLEAN_TX_TIMEOUT_MS = 60_000;
const CLEAN_TX_MAX_WAIT_MS = 5_000;

type WithDecimalFields = {
    z_value: Prisma.Decimal | number;
    distribution_percentage: Prisma.Decimal | number | null;
    safety_percentage: Prisma.Decimal | number | null;
};

const SORT_COLUMN_MAP: { [key: string]: Prisma.Sql | undefined } = {
    code: Prisma.sql`p.code`,
    name: Prisma.sql`p.name`,
    updated_at: Prisma.sql`p.updated_at`,
    created_at: Prisma.sql`p.created_at`,
    gender: Prisma.sql`p.gender`,
    lead_time: Prisma.sql`p.lead_time`,
    type: Prisma.sql`pt.name`,
    size: Prisma.sql`ps.size`,
    distribution_percentage: Prisma.sql`p.distribution_percentage`,
    safety_percentage: Prisma.sql`p.safety_percentage`,
};

const FORECAST_DEFAULT_ORDER = Prisma.sql`
    CASE WHEN pt.name ILIKE '%Display%' THEN 1 ELSE 0 END ASC,
    group_sort_priority DESC,
    p.name ASC,
    CASE
        WHEN pt.name ILIKE '%EDP%' OR pt.name ILIKE '%Parfum%' OR pt.name ILIKE '%Perfume%' THEN 1
        WHEN pt.name ILIKE '%Atomizer%' THEN 2
        ELSE 3
    END ASC,
    ps.size DESC NULLS LAST,
    CASE
        WHEN pt.name ILIKE '%EDP%' THEN 1
        WHEN pt.name ILIKE '%Parfum%' OR pt.name ILIKE '%Perfume%' THEN 2
        ELSE 3
    END ASC,
    p.id ASC
`;

const PRODUCT_DETAIL_INCLUDE = {
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
} satisfies Prisma.ProductInclude;

export class ProductService {
    private static async getOrCreate(
        model: UpsertBySlugDelegate,
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

    private static toResponseNumbers<T extends WithDecimalFields>(row: T) {
        return {
            ...row,
            z_value: Number(row.z_value),
            distribution_percentage: Number(row.distribution_percentage ?? 0),
            safety_percentage: Number(row.safety_percentage ?? 0),
        };
    }

    static async create(body: RequestProductDTO) {
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

                return this.toResponseNumbers(result);
            });
        } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
                throw new ApiError(400, `Produk dengan kode: ${code} telah tersedia`);
            }
            throw e;
        }
    }

    static async update(id: number, body: Partial<RequestProductDTO>) {
        const { code, unit, product_type, size, ...reqBody } = body;

        try {
            return await prisma.$transaction(async (tx) => {
                const [type_id, unit_id, size_id] = await Promise.all([
                    product_type ? this.getOrCreate(tx.productType, product_type) : undefined,
                    unit ? this.getOrCreate(tx.unit, unit) : undefined,
                    size ? this.getOrCreateSize(tx, size) : undefined,
                ]);

                const result = await tx.product.update({
                    where: { id },
                    data: {
                        ...reqBody,
                        ...(code !== undefined && { code }),
                        ...(type_id !== undefined && { type_id }),
                        ...(unit_id !== undefined && { unit_id }),
                        ...(size_id !== undefined && { size_id }),
                    },
                    include: { product_type: true, unit: true, size: true },
                });

                return this.toResponseNumbers(result);
            });
        } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError) {
                if (e.code === "P2025") throw new ApiError(404, "Produk tidak ditemukan");
                if (e.code === "P2002") throw new ApiError(400, "Kode Produk telah digunakan");
            }
            throw e;
        }
    }

    static async status(id: number, status: STATUS) {
        try {
            await prisma.product.update({
                where: { id },
                data: { deleted_at: status === "DELETE" ? new Date() : null, status },
            });
        } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
                throw new ApiError(404, `Produk dengan kode ${id} tidak ditemukan`);
            }
            throw e;
        }
    }

    private static buildListWhere(query: QueryProductDTO): Prisma.ProductWhereInput {
        const { gender, search, status, type_id, size_id } = query;
        const where: Prisma.ProductWhereInput = {};
        if (type_id) where.type_id = type_id;
        if (size_id) where.size_id = size_id;
        if (gender) where.gender = gender;
        where.status = status ? status : { not: "DELETE" };
        if (search) {
            where.OR = [
                { name: { contains: search, mode: "insensitive" } },
                { code: { contains: search, mode: "insensitive" } },
                { product_type: { name: { contains: search, mode: "insensitive" } } },
            ];
        }
        return where;
    }

    static async export(query: QueryProductDTO) {
        const total = await prisma.product.count({ where: this.buildListWhere(query) });
        if (total > EXPORT_MAX_ROWS) {
            throw new ApiError(
                400,
                `Data melebihi batas export ${EXPORT_MAX_ROWS.toLocaleString("id-ID")} baris. Persempit filter terlebih dahulu.`,
            );
        }

        const { data } = await this.list({ ...query, take: EXPORT_MAX_ROWS, page: 1 });

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Data Produk");

        const visibleCols = query.visibleColumns ? query.visibleColumns.split(",") : [];
        const hasVisibility = visibleCols.length > 0;

        // Round-trip columns (header = PRODUCT_IMPORT_HEADERS) WAJIB selalu di-export
        // supaya hasil CSV bisa langsung di-import ulang tanpa header missing.
        // Display-only columns (Lead Time / Nilai Z / Status) tunduk pada visibleColumns.
        const allColumns = [
            { header: "No", key: "no", width: 5, id: "no", required: true },
            { header: PRODUCT_IMPORT_HEADERS.code, key: "code", width: 15, id: "code", required: true },
            { header: PRODUCT_IMPORT_HEADERS.name, key: "name", width: 40, id: "name", required: true },
            { header: PRODUCT_IMPORT_HEADERS.type, key: "type", width: 20, id: "type", required: true },
            { header: PRODUCT_IMPORT_HEADERS.size, key: "size", width: 10, id: "size", required: true },
            { header: PRODUCT_IMPORT_HEADERS.unit, key: "unit", width: 10, id: "unit", required: true },
            { header: PRODUCT_IMPORT_HEADERS.gender, key: "gender", width: 15, id: "gender", required: true },
            { header: "Lead Time", key: "lead_time", width: 12, id: "lead_time", required: false },
            { header: "Nilai Z", key: "z_value", width: 10, id: "z_value", required: false },
            { header: PRODUCT_IMPORT_HEADERS.distribution, key: "distribution", width: 15, id: "distribution_percentage", required: true },
            { header: PRODUCT_IMPORT_HEADERS.safety, key: "safety", width: 15, id: "safety_percentage", required: true },
            { header: "Status", key: "status", width: 15, id: "status", required: false },
        ];

        const filteredColumns = hasVisibility
            ? allColumns.filter((col) => col.required || visibleCols.includes(col.id))
            : allColumns;

        sheet.columns = filteredColumns.map(({ header, key, width }) => ({ header, key, width }));

        data.forEach((item, index) => {
            sheet.addRow({
                no: index + 1,
                code: item.code || "-",
                name: item.name,
                type: item.product_type?.name ?? "-",
                size: item.size?.size ?? "-",
                unit: item.unit?.name ?? "-",
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
        sheet.getRow(1).fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF0070C0" },
        };
        sheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };

        return await workbook.csv.writeBuffer();
    }

    static async clean(): Promise<{ deleted: number }> {
        const products = await prisma.product.findMany({
            where: { deleted_at: { not: null } },
            select: { id: true },
        });

        if (products.length === 0) throw new ApiError(400, "Tidak ada produk yang akan dihapus");
        const ids = products.map((p) => p.id);

        await prisma.$transaction(
            async (tx) => {
                await tx.forecast.deleteMany({ where: { product_id: { in: ids } } });
                await tx.outletInventory.deleteMany({ where: { product_id: { in: ids } } });
                await tx.productInventory.deleteMany({ where: { product_id: { in: ids } } });
                await tx.productIssuance.deleteMany({ where: { product_id: { in: ids } } });
                await tx.recipes.deleteMany({ where: { product_id: { in: ids } } });
                await tx.safetyStock.deleteMany({ where: { product_id: { in: ids } } });
                await tx.stockTransferItem.deleteMany({ where: { product_id: { in: ids } } });
                await tx.goodsReceiptItem.deleteMany({ where: { product_id: { in: ids } } });
                await tx.stockReturnItem.deleteMany({ where: { product_id: { in: ids } } });

                await tx.product.deleteMany({ where: { id: { in: ids } } });
            },
            { maxWait: CLEAN_TX_MAX_WAIT_MS, timeout: CLEAN_TX_TIMEOUT_MS },
        );

        return { deleted: ids.length };
    }

    static async list(
        query: QueryProductDTO,
    ): Promise<{ data: ResponseProductDTO[]; len: number }> {
        const {
            page = 1,
            take = 10,
            sortBy = "forecast_default",
            sortOrder = "desc",
            gender,
            search,
            status,
            type_id,
            size_id,
        } = query;
        const { skip, take: limit } = GetPagination(page, take);

        const conditions: Prisma.Sql[] = [];

        if (type_id) conditions.push(Prisma.sql`p.type_id = ${type_id}`);
        if (size_id) conditions.push(Prisma.sql`p.size_id = ${size_id}`);
        if (gender) conditions.push(Prisma.sql`p.gender = ${gender}::"GENDER"`);
        if (status) {
            conditions.push(Prisma.sql`p.status = ${status}::"STATUS"`);
        } else {
            conditions.push(Prisma.sql`p.status != 'DELETE'`);
        }

        if (search) {
            const searchPattern = `%${search}%`;
            conditions.push(
                Prisma.sql`(p.name ILIKE ${searchPattern} OR p.code ILIKE ${searchPattern} OR pt.name ILIKE ${searchPattern})`,
            );
        }

        const whereClause =
            conditions.length > 0
                ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
                : Prisma.empty;

        const direction = sortOrder.toUpperCase() === "ASC" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
        const orderBy: Prisma.Sql = (() => {
            if (sortBy === "forecast_default") return FORECAST_DEFAULT_ORDER;
            const column = SORT_COLUMN_MAP[sortBy];
            if (!column) return Prisma.sql`p.updated_at DESC`;
            return Prisma.sql`${column} ${direction}`;
        })();

        const currentMonth = new Date().getMonth() + 1;
        const currentYear = new Date().getFullYear();

        const dataTask = prisma.$queryRaw<ProductListRow[]>`
            SELECT
                p.*,
                json_build_object('id', pt.id, 'name', pt.name, 'slug', pt.slug) as product_type,
                json_build_object('id', u.id, 'name', u.name, 'slug', u.slug) as unit,
                json_build_object('id', ps.id, 'size', ps.size) as size,
                MAX(COALESCE(f_m1.final_forecast, 0)) OVER(PARTITION BY p.name) as group_sort_priority
            FROM products p
            LEFT JOIN product_types pt ON p.type_id = pt.id
            LEFT JOIN unit_of_materials u ON p.unit_id = u.id
            LEFT JOIN product_size ps ON p.size_id = ps.id
            LEFT JOIN forecasts f_m1 ON f_m1.product_id = p.id AND f_m1.month = ${currentMonth} AND f_m1.year = ${currentYear}
            ${whereClause}
            ORDER BY ${orderBy}
            LIMIT ${limit} OFFSET ${skip}
        `;

        const countTask = prisma.$queryRaw<[{ count: bigint }]>`
            SELECT COUNT(*)::bigint FROM products p
            LEFT JOIN product_types pt ON p.type_id = pt.id
            ${whereClause}
        `;

        const [products, countResult] = await Promise.all([dataTask, countTask]);

        return {
            len: Number(countResult[0].count),
            // reason: raw row carries FK columns + group_sort_priority consumed by frontend; preserve passthrough.
            data: products.map((p) => this.toResponseNumbers(p)) as unknown as ResponseProductDTO[],
        };
    }

    static async detail(id: number): Promise<ResponseProductDTO> {
        const product = await prisma.product.findUnique({
            where: { id },
            include: PRODUCT_DETAIL_INCLUDE,
        });
        if (!product) throw new ApiError(404, "Produk tidak ditemukan");

        return this.toDetailDTO(product);
    }

    private static toDetailDTO(
        product: Prisma.ProductGetPayload<{ include: typeof PRODUCT_DETAIL_INCLUDE }>,
    ): ResponseProductDTO {
        return {
            ...this.toResponseNumbers(product),
            product_inventories: product.product_inventories.map((i) => ({
                id: i.id,
                quantity: Number(i.quantity),
                min_stock: i.min_stock != null ? Number(i.min_stock) : null,
                warehouse: { id: i.warehouse.id, name: i.warehouse.name },
            })),
            recipes: product.recipes.map((r) => ({
                id: r.id,
                quantity: Number(r.quantity),
                version: r.version,
                is_active: r.is_active,
                raw_material: {
                    id: r.raw_materials.id,
                    name: r.raw_materials.name,
                    price: Number(r.raw_materials.supplier_materials[0]?.unit_price ?? 0),
                    unit_raw_material: { name: r.raw_materials.unit_raw_material.name },
                    current_stock: 0,
                },
            })),
        };
    }
}
