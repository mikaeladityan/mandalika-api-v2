import { Prisma } from "../../../../../generated/prisma/client.js";
import prisma from "../../../../../config/prisma.js";
import { GetPagination } from "../../../../../lib/utils/pagination.js";
import { QueryStockCardDTO, ResponseStockCardDTO } from "./stock-card.schema.js";

/** Batas maksimum baris untuk export agar tidak OOM */
const EXPORT_LIMIT = 5000;

export class StockCardService {
    /**
     * Build reusable WHERE + ORDER clause dari query params.
     */
    private static buildQuery(query: QueryStockCardDTO): {
        conditions: Prisma.Sql[];
        orderBy:    string;
    } {
        const {
            search,
            entity_type,
            entity_id,
            location_type,
            location_id,
            movement_type,
            reference_type,
            reference_id,
            date_from,
            date_to,
            created_by,
            sortBy    = "created_at",
            sortOrder = "desc",
        } = query;

        const conditions: Prisma.Sql[] = [];

        if (entity_type)    conditions.push(Prisma.sql`sm.entity_type    = ${entity_type}::text::"MovementEntityType"`);
        if (entity_id)      conditions.push(Prisma.sql`sm.entity_id      = ${entity_id}`);
        if (location_type)  conditions.push(Prisma.sql`sm.location_type  = ${location_type}::text::"MovementLocationType"`);
        if (location_id)    conditions.push(Prisma.sql`sm.location_id    = ${location_id}`);
        if (movement_type)  conditions.push(Prisma.sql`sm.movement_type  = ${movement_type}::text::"MovementType"`);
        if (reference_type) conditions.push(Prisma.sql`sm.reference_type = ${reference_type}::text::"MovementRefType"`);
        if (reference_id)   conditions.push(Prisma.sql`sm.reference_id   = ${reference_id}`);
        if (created_by)     conditions.push(Prisma.sql`sm.created_by ILIKE ${"%" + created_by + "%"}`);

        if (search) {
            const pattern = `%${search}%`;
            conditions.push(Prisma.sql`(p.name ILIKE ${pattern} OR p.code ILIKE ${pattern} OR rm.name ILIKE ${pattern} OR rm.barcode ILIKE ${pattern})`);
        }
        if (date_from) {
            conditions.push(Prisma.sql`sm.created_at >= ${new Date(date_from)}`);
        }
        if (date_to) {
            // include the full end-day
            const end = new Date(date_to);
            end.setHours(23, 59, 59, 999);
            conditions.push(Prisma.sql`sm.created_at <= ${end}`);
        }

        const validSort: Record<string, string> = {
            created_at: "sm.created_at",
            quantity:   "sm.quantity",
        };
        const col = validSort[sortBy] ?? "sm.created_at";
        const dir = sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";

        return { conditions, orderBy: `${col} ${dir}` };
    }

    private static baseSelect = Prisma.sql`
        sm.id,
        sm.entity_type::text           AS entity_type,
        sm.entity_id,
        COALESCE(p.code, '')           AS product_code,
        COALESCE(p.name, rm.name)      AS product_name,
        COALESCE(rm.barcode, p.code)   AS barcode,
        COALESCE(pt.name, rmc.name)    AS category,
        ps.size::text                  AS size,
        sm.location_type::text         AS location_type,
        sm.location_id,
        CASE
            WHEN sm.location_type::text = 'WAREHOUSE' THEN w.name
            WHEN sm.location_type::text = 'OUTLET'    THEN o.name
            ELSE NULL
        END                            AS location_name,
        sm.movement_type::text         AS movement_type,
        sm.quantity::numeric           AS quantity,
        sm.qty_before::numeric         AS qty_before,
        sm.qty_after::numeric          AS qty_after,
        sm.reference_id,
        sm.reference_type::text        AS reference_type,
        CASE
            WHEN sm.reference_type::text = 'STOCK_TRANSFER' THEN st.transfer_number
            WHEN sm.reference_type::text = 'STOCK_RETURN'   THEN sr.return_number
            WHEN sm.reference_type::text = 'GOODS_RECEIPT'  THEN gr.gr_number
            ELSE NULL
        END                            AS reference_code,
        sm.created_by,
        sm.created_at
    `;

    private static baseJoins = Prisma.sql`
        FROM stock_movements sm
        LEFT JOIN products   p ON sm.entity_id   = p.id
                                   AND sm.entity_type::text = 'PRODUCT'
        LEFT JOIN raw_materials rm ON sm.entity_id = rm.id
                                   AND sm.entity_type::text = 'RAW_MATERIAL'
        LEFT JOIN product_types pt ON p.type_id = pt.id
        LEFT JOIN product_size  ps ON p.size_id = ps.id
        LEFT JOIN raw_mat_categories rmc ON rm.raw_mat_categories_id = rmc.id
        LEFT JOIN warehouses w ON sm.location_id  = w.id
                                   AND sm.location_type::text = 'WAREHOUSE'
        LEFT JOIN outlets    o ON sm.location_id  = o.id
                                   AND sm.location_type::text = 'OUTLET'
        LEFT JOIN stock_transfers st ON sm.reference_id = st.id AND sm.reference_type::text = 'STOCK_TRANSFER'
        LEFT JOIN stock_returns   sr ON sm.reference_id = sr.id AND sm.reference_type::text = 'STOCK_RETURN'
        LEFT JOIN goods_receipts  gr ON sm.reference_id = gr.id AND sm.reference_type::text = 'GOODS_RECEIPT'
    `;

    /**
     * Paginated list pergerakan stok dengan search product name/code + date filter.
     */
    static async list(query: QueryStockCardDTO): Promise<{
        data: ResponseStockCardDTO[];
        len:  number;
    }> {
        const { page = 1, take = 20 } = query;
        const { skip, take: limit } = GetPagination(Number(page), Number(take));

        if (!query.location_type && !query.location_id) {
            const wh = await prisma.warehouse.findFirst({
                where: { code: "GFG-SBY", deleted_at: null },
                select: { id: true },
            });
            if (wh) {
                query.location_type = "WAREHOUSE";
                query.location_id = wh.id;
            }
        }

        const { conditions, orderBy } = StockCardService.buildQuery(query);

        const whereClause = conditions.length > 0
            ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
            : Prisma.empty;

        const [countResult, rows] = await Promise.all([
            prisma.$queryRaw<{ total: bigint }[]>`
                SELECT COUNT(*)::bigint AS total
                ${StockCardService.baseJoins}
                ${whereClause}
            `,
            prisma.$queryRaw<any[]>`
                SELECT ${StockCardService.baseSelect}
                ${StockCardService.baseJoins}
                ${whereClause}
                ORDER BY ${Prisma.raw(orderBy)}
                LIMIT ${limit} OFFSET ${skip}
            `,
        ]);

        return {
            len:  Number(countResult[0]?.total ?? 0),
            data: rows.map(StockCardService.mapRow),
        };
    }

    /**
     * Export tanpa pagination, maksimum EXPORT_LIMIT baris.
     * Caller bertanggung jawab convert ke CSV/Excel di controller.
     */
    static async export(query: QueryStockCardDTO): Promise<ResponseStockCardDTO[]> {
        if (!query.location_type && !query.location_id) {
            const wh = await prisma.warehouse.findFirst({
                where: { code: "GFG-SBY", deleted_at: null },
                select: { id: true },
            });
            if (wh) {
                query.location_type = "WAREHOUSE";
                query.location_id = wh.id;
            }
        }

        const { conditions, orderBy } = StockCardService.buildQuery(query);

        const whereClause = conditions.length > 0
            ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
            : Prisma.empty;

        const rows = await prisma.$queryRaw<any[]>`
            SELECT ${StockCardService.baseSelect}
            ${StockCardService.baseJoins}
            ${whereClause}
            ORDER BY ${Prisma.raw(orderBy)}
            LIMIT ${EXPORT_LIMIT}
        `;

        return rows.map(StockCardService.mapRow);
    }

    private static mapRow(r: any): ResponseStockCardDTO {
        return {
            id:             Number(r.id),
            entity_type:    r.entity_type,
            entity_id:      Number(r.entity_id),
            product_code:   r.product_code   ?? null,
            product_name:   r.product_name   ?? null,
            barcode:        r.barcode        ?? null,
            category:       r.category       ?? null,
            size:           r.size           ?? null,
            location_type:  r.location_type,
            location_id:    Number(r.location_id),
            location_name:  r.location_name  ?? null,
            movement_type:  r.movement_type,
            quantity:       Number(r.quantity),
            qty_before:     Number(r.qty_before),
            qty_after:      Number(r.qty_after),
            reference_id:   r.reference_id   != null ? Number(r.reference_id)   : null,
            reference_type: r.reference_type ?? null,
            reference_code: r.reference_code ?? null,
            created_by:     r.created_by,
            created_at:     new Date(r.created_at),
        };
    }
}
