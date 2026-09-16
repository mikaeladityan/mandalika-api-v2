import { rawMaterialStockCtes } from "./rawmat-stock-sql.js";
import prisma from "../../../../config/prisma.js";
import { Prisma } from "../../../../generated/prisma/client.js";
import { GetPagination } from "../../../../lib/utils/pagination.js";
import {
    QueryRawMaterialStockDTO,
    RequestUpsertRawMaterialStockDTO,
    ResponseRawMaterialStockDTO,
} from "./rawmat.stock.schema.js";

export class RawMaterialStockService {
    private static async getLatestPeriod() {
        const latest = await prisma.rawMaterialInventory.findFirst({
            orderBy: [{ year: "desc" }, { month: "desc" }],
            select: { month: true, year: true },
        });

        if (!latest) {
            return { month: new Date().getMonth() + 1, year: new Date().getFullYear() };
        }

        return latest;
    }

    static async listRawMaterials() {
        return prisma.rawMaterial.findMany({
            where: {
                deleted_at: null,
            },
            select: {
                id: true,
                name: true,
                barcode: true,
            },
            orderBy: {
                name: "asc",
            },
        });
    }

    /**
     * Day-of-month of the snapshot the stock views actually read for this period.
     * They rank rows with `ORDER BY date DESC, updated_at DESC, id DESC` and take
     * the first one (see rawMaterialStockCtes), so a manual entry written to any
     * other `date` stays invisible behind an imported snapshot. When the period has
     * no row yet, today's day-of-month matches what the CSV import writes.
     */
    private static async getTargetDate(
        raw_material_id: number,
        warehouse_id: number,
        month: number,
        year: number,
    ) {
        const current = await prisma.rawMaterialInventory.findFirst({
            where: { raw_material_id, warehouse_id, month, year },
            orderBy: [{ date: "desc" }, { updated_at: "desc" }, { id: "desc" }],
            select: { date: true },
        });

        return current?.date ?? new Date().getUTCDate();
    }

    static async upsertStock(data: RequestUpsertRawMaterialStockDTO) {
        const date = await this.getTargetDate(
            data.raw_material_id,
            data.warehouse_id,
            data.month,
            data.year,
        );

        return prisma.rawMaterialInventory.upsert({
            where: {
                raw_material_id_warehouse_id_date_month_year: {
                    raw_material_id: data.raw_material_id,
                    warehouse_id: data.warehouse_id,
                    date,
                    month: data.month,
                    year: data.year,
                },
            },
            update: {
                quantity: data.quantity,
                ...(data.min_stock !== undefined && { min_stock: data.min_stock }),
            },
            create: {
                raw_material_id: data.raw_material_id,
                warehouse_id: data.warehouse_id,
                quantity: data.quantity,
                min_stock: data.min_stock ?? null,
                date,
                month: data.month,
                year: data.year,
            },
        });
    }

    static async listRawMaterialStock(query: QueryRawMaterialStockDTO): Promise<{
        data: Array<ResponseRawMaterialStockDTO>;
        len: number;
        month: number;
        year: number;
    }> {
        let {
            page = 1,
            take = 50,
            search,
            sortBy = "updated_at",
            sortOrder = "desc",
            category_id,
            supplier_id,
            month,
            year,
        } = query;

        if (!month || !year) {
            const latest = await this.getLatestPeriod();
            month = month ?? latest.month;
            year = year ?? latest.year;
        }

        const { skip, take: limit } = GetPagination(page, take);

        const prdWarehouse = await prisma.warehouse.findFirst({
            where: { code: { contains: "PRD", mode: "insensitive" }, deleted_at: null },
            select: { id: true },
        });
        const prdWhId = prdWarehouse?.id ?? 0;

        const conditions: Prisma.Sql[] = [Prisma.sql`rm.deleted_at IS NULL`];

        if (category_id) {
            conditions.push(Prisma.sql`rm.raw_mat_categories_id = ${category_id}`);
        }

        if (supplier_id) {
            conditions.push(Prisma.sql`EXISTS (
                SELECT 1 FROM supplier_materials sm_filter
                WHERE sm_filter.raw_material_id = rm.id AND sm_filter.supplier_id = ${supplier_id}
            )`);
        }

        if (search) {
            const searchPattern = `%${search}%`;
            conditions.push(
                Prisma.sql`(rm.name ILIKE ${searchPattern} OR rm.barcode ILIKE ${searchPattern})`,
            );
        }

        const whereClause = Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;

        const validSortColumns: Record<string, string> = {
            created_at: "rm.created_at",
            updated_at: "rm.updated_at",
            name: "rm.name",
            barcode: "rm.barcode",
            category: "c.name",
            amount: "amount",
        };

        const sortColumn = validSortColumns[sortBy] || "rm.updated_at";
        const sortDirection = sortOrder.toLowerCase() === "asc" ? "ASC" : "DESC";
        const orderByClause = Prisma.sql`ORDER BY ${Prisma.raw(`${sortColumn} ${sortDirection}`)}`;

        const [countResult, result] = await Promise.all([
            prisma.$queryRaw<{ total: bigint }[]>`
            SELECT COUNT(DISTINCT rm.id)::bigint AS total
            FROM raw_materials rm
            LEFT JOIN raw_mat_categories c ON rm.raw_mat_categories_id = c.id
            ${whereClause}
        `,
            prisma.$queryRaw<Array<Omit<ResponseRawMaterialStockDTO, "amount" | "booked" | "avail"> & {
                amount: Prisma.Decimal; booked: Prisma.Decimal; avail: Prisma.Decimal;
            }>>`
            ${rawMaterialStockCtes(month, year, prdWhId, query.warehouse_id)}
            SELECT
                rm.id, rm.barcode, rm.name,
                COALESCE(c.name, 'Unknown') AS category,
                COALESCE(u.name, 'Unknown') AS uom,
                COALESCE(st.amount, 0) AS amount,
                COALESCE(st.booked, 0) AS booked,
                COALESCE(st.avail, 0) AS avail,
                ss.stock_source,
                COALESCE(sw.warehouses, '[]'::jsonb) AS source_warehouses,
                COALESCE(sd.stocks, '{}'::jsonb) AS stocks,
                COALESCE(sd.details, '{}'::jsonb) AS details
            FROM raw_materials rm
            LEFT JOIN raw_mat_categories c ON rm.raw_mat_categories_id = c.id
            LEFT JOIN unit_raw_materials u ON rm.unit_id = u.id
            JOIN stock_sources ss ON ss.raw_material_id = rm.id
            LEFT JOIN stock_totals st ON st.raw_material_id = rm.id
            LEFT JOIN stock_details sd ON sd.raw_material_id = rm.id
            LEFT JOIN source_warehouses sw ON sw.raw_material_id = rm.id
            ${whereClause}
            ${orderByClause}
            LIMIT ${limit} OFFSET ${skip}
        `,
        ]);

        return {
            len: Number(countResult[0]?.total || 0),
            month: month as number,
            year: year as number,
            data: result.map((p) => ({
                id: p.id,
                barcode: p.barcode,
                stock_source: p.stock_source,
                source_warehouses: p.source_warehouses,
                name: p.name,
                category: p.category,
                uom: p.uom,
                amount: Number(p.amount),
                booked: Number(p.booked),
                avail: Number(p.avail),
                stocks: p.stocks || {},
                details: p.details || {},
            })),
        };
    }

    static async listWarehouses() {
        return prisma.warehouse.findMany({
            where: {
                type: "RAW_MATERIAL",
                deleted_at: null,
            },
            select: {
                id: true,
                name: true,
            },
            orderBy: {
                name: "asc",
            },
        });
    }

    static async export(query: QueryRawMaterialStockDTO) {
        const { data } = await this.listRawMaterialStock({ ...query, take: 1000000, page: 1 });

        const ExcelJS = await import("exceljs");
        const workbook = new ExcelJS.default.Workbook();
        const sheet = workbook.addWorksheet("Raw Material Stocks");

        // Template format: MATERIAL CODE, CURRENT STOCK
        sheet.columns = [
            { header: "MATERIAL CODE", key: "barcode", width: 25 },
            { header: "MATERIAL NAME", key: "name", width: 40 },
            { header: "CATEGORY", key: "category", width: 25 },
            { header: "UNIT", key: "unit", width: 15 },
            { header: "SUMBER STOK", key: "stock_source", width: 15 },
            { header: "GUDANG SUMBER (JUMLAH)", key: "source_warehouses", width: 60 },
            { header: "ON HAND (FISIK)", key: "on_hand", width: 20 },
            { header: "BOOKED (BOOKING)", key: "booked", width: 20 },
            { header: "AVAILABLE (SIAP)", key: "avail", width: 20 },
        ];

        data.forEach((item) => {
            sheet.addRow({
                barcode: item.barcode || "-",
                name: item.name,
                category: item.category || "-",
                unit: item.uom,
                stock_source: item.stock_source,
                source_warehouses: item.source_warehouses.map((w) => `${w.warehouse_name}: ${w.quantity}`).join("; "),
                on_hand: item.amount,
                booked: item.booked,
                avail: item.avail,
            });
        });

        return await workbook.csv.writeBuffer();
    }
}
