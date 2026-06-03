import prisma from "../../../../config/prisma.js";
import { GENDER, Prisma, STATUS, WarehouseType } from "../../../../generated/prisma/client.js";
import { GetPagination } from "../../../../lib/utils/pagination.js";
import { QueryStockDTO, ResponseStockDTO, RequestUpsertStockDTO } from "./stock.schema.js";
import ExcelJS from "exceljs";

const SORT_COLUMN_MAP: { [key: string]: Prisma.Sql | undefined } = {
    created_at: Prisma.sql`p.created_at`,
    updated_at: Prisma.sql`p.updated_at`,
    name: Prisma.sql`p.name`,
    code: Prisma.sql`p.code`,
    size: Prisma.sql`ps.size`,
    type: Prisma.sql`pt.name`,
    amount: Prisma.sql`amount`,
};

type StockListRow = {
    id: number;
    code: string;
    name: string;
    type: string;
    size: number | string | Prisma.Decimal;
    gender: GENDER;
    uom: string;
    amount: number | string | Prisma.Decimal;
    stocks: Record<string, number | string | Prisma.Decimal>;
};

type StockExportRow = {
    code: string;
    name: string;
    type: string;
    size: number | string | Prisma.Decimal;
    gender: GENDER;
    uom: string;
    amount: number | string | Prisma.Decimal;
    warehouse_name: string | null;
};

export class StockService {
    private static async getLatestPeriod() {
        const latestProduct = await prisma.productInventory.findFirst({
            orderBy: [{ year: "desc" }, { month: "desc" }],
            select: { month: true, year: true },
        });

        if (!latestProduct) {
            return { month: new Date().getMonth() + 1, year: new Date().getFullYear() };
        }

        return latestProduct;
    }

    private static buildOrderBy(sortBy: string, sortOrder: string): Prisma.Sql {
        const direction = sortOrder.toLowerCase() === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
        const column = SORT_COLUMN_MAP[sortBy] ?? Prisma.sql`p.created_at`;
        return Prisma.sql`ORDER BY ${column} ${direction}`;
    }

    private static buildConditions(query: QueryStockDTO): Prisma.Sql[] {
        const { gender, search, type_id } = query;
        const conditions: Prisma.Sql[] = [];

        if (type_id) conditions.push(Prisma.sql`p.type_id = ${type_id}`);
        if (gender !== undefined) {
            conditions.push(Prisma.sql`p.gender = CAST(${gender} AS "GENDER")`);
        }
        if (search) {
            const pattern = `%${search}%`;
            conditions.push(
                Prisma.sql`(p.name ILIKE ${pattern} OR p.code ILIKE ${pattern})`,
            );
        }
        return conditions;
    }

    static async listProductStock(query: QueryStockDTO): Promise<{
        data: Array<ResponseStockDTO>;
        len: number;
        month: number;
        year: number;
    }> {
        let {
            page = 1,
            take = 50,
            sortBy = "created_at",
            sortOrder = "desc",
            month,
            year,
        } = query;

        if (!month || !year) {
            const latest = await this.getLatestPeriod();
            month = month ?? latest.month;
            year = year ?? latest.year;
        }

        const { skip, take: limit } = GetPagination(page, take);
        const conditions = this.buildConditions(query);
        const whereClause =
            conditions.length > 0
                ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
                : Prisma.empty;
        const orderByClause = this.buildOrderBy(sortBy, sortOrder);

        const [countResult, productsResult] = await Promise.all([
            prisma.$queryRaw<{ total: bigint }[]>`
                SELECT COUNT(*)::bigint AS total
                FROM products p
                ${whereClause}
            `,
            prisma.$queryRaw<StockListRow[]>`
                SELECT
                    p.id,
                    p.code,
                    p.name,
                    COALESCE(pt.name, 'Unknown') AS type,
                    COALESCE(ps.size, 0) AS size,
                    p.gender::text AS gender,
                    COALESCE(u.name, 'Unknown') AS uom,
                    COALESCE(SUM(pi.quantity), 0) AS amount,
                    COALESCE(
                        JSONB_OBJECT_AGG(w.name, pi.quantity) FILTER (WHERE w.name IS NOT NULL),
                        '{}'::JSONB
                    ) AS stocks
                FROM products p
                LEFT JOIN product_types pt ON p.type_id = pt.id
                LEFT JOIN unit_of_materials u ON p.unit_id = u.id
                LEFT JOIN product_size ps ON p.size_id = ps.id
                LEFT JOIN (
                    SELECT product_id, warehouse_id, SUM(quantity) as quantity
                    FROM product_inventories
                    WHERE month = ${month} AND year = ${year}
                    GROUP BY product_id, warehouse_id
                ) pi ON p.id = pi.product_id
                LEFT JOIN warehouses w ON pi.warehouse_id = w.id
                ${whereClause}
                GROUP BY p.id, pt.name, u.name, ps.size
                ${orderByClause}
                LIMIT ${limit} OFFSET ${skip}
            `,
        ]);

        const len = Number(countResult[0]?.total ?? 0);

        return {
            len,
            month: month as number,
            year: year as number,
            // reason: ResponseStockDTO doesn't have "stocks" field but downstream consumers (frontend) expect it.
            data: productsResult.map((p) => ({
                id: Number(p.id),
                code: p.code,
                name: p.name,
                type: p.type,
                size: Number(p.size),
                gender: p.gender,
                uom: p.uom,
                amount: Number(p.amount),
                stocks: p.stocks || {},
            })) as unknown as ResponseStockDTO[],
        };
    }

    static async listWarehouses() {
        return prisma.warehouse.findMany({
            where: {
                type: WarehouseType.FINISH_GOODS,
                deleted_at: null,
            },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
        });
    }

    static async listProducts() {
        return prisma.product.findMany({
            where: { deleted_at: null, status: STATUS.ACTIVE },
            select: { id: true, name: true, code: true },
            orderBy: { name: "asc" },
        });
    }

    static async upsertStock(body: RequestUpsertStockDTO) {
        const { product_id, warehouse_id, quantity, month, year } = body;

        return prisma.productInventory.upsert({
            where: {
                product_id_warehouse_id_date_month_year: {
                    product_id,
                    warehouse_id,
                    date: 1,
                    month,
                    year,
                },
            },
            update: { quantity, updated_at: new Date() },
            create: { product_id, warehouse_id, date: 1, quantity, month, year },
        });
    }

    static async exportStock(query: QueryStockDTO) {
        let { warehouse_id, month, year } = query;

        if (!month || !year) {
            const latest = await this.getLatestPeriod();
            month = month ?? latest.month;
            year = year ?? latest.year;
        }

        const conditions = this.buildConditions(query);
        const whereClause =
            conditions.length > 0
                ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
                : Prisma.empty;

        const warehouseFilter = warehouse_id
            ? Prisma.sql`AND pi_sub.warehouse_id = ${warehouse_id}`
            : Prisma.empty;

        const rows = await prisma.$queryRaw<StockExportRow[]>`
            SELECT
                p.code,
                p.name,
                COALESCE(pt.name, 'Unknown')  AS type,
                COALESCE(ps.size, 0)          AS size,
                p.gender::text                AS gender,
                COALESCE(u.name, 'Unknown')   AS uom,
                COALESCE(SUM(pi.quantity), 0) AS amount,
                w.name                        AS warehouse_name
            FROM products p
            LEFT JOIN product_types pt ON p.type_id = pt.id
            LEFT JOIN unit_of_materials u  ON p.unit_id = u.id
            LEFT JOIN product_size ps      ON p.size_id = ps.id
            LEFT JOIN (
                SELECT product_id, warehouse_id, SUM(quantity) AS quantity
                FROM product_inventories pi_sub
                WHERE pi_sub.month = ${month} AND pi_sub.year = ${year} ${warehouseFilter}
                GROUP BY product_id, warehouse_id
            ) pi ON p.id = pi.product_id
            LEFT JOIN warehouses w ON pi.warehouse_id = w.id
            ${whereClause}
            GROUP BY p.id, pt.name, u.name, ps.size, w.name
            ORDER BY p.name ASC
        `;

        const warehouseLabel = rows[0]?.warehouse_name ?? "Semua Gudang";
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet(`Stok ${warehouseLabel}`);

        sheet.columns = [
            { header: "No",           key: "no",     width: 5  },
            { header: "Kode",         key: "code",   width: 15 },
            { header: "Nama Produk",  key: "name",   width: 40 },
            { header: "Tipe",         key: "type",   width: 20 },
            { header: "Ukuran",       key: "size",   width: 10 },
            { header: "Gender",       key: "gender", width: 12 },
            { header: "UOM",          key: "uom",    width: 10 },
            { header: "Stok",         key: "amount", width: 12 },
        ];

        rows.forEach((row, index) => {
            sheet.addRow({
                no:     index + 1,
                code:   row.code,
                name:   row.name,
                type:   row.type,
                size:   Number(row.size),
                gender: row.gender,
                uom:    row.uom,
                amount: Number(row.amount),
            });
        });

        sheet.getRow(1).font      = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
        sheet.getRow(1).height    = 25;
        sheet.getRow(1).fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0070C0" } };
        sheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };

        return await workbook.csv.writeBuffer();
    }
}
