import { Prisma } from "../../../../../../generated/prisma/client.js";
import prisma from "../../../../../../config/prisma.js";
import { GetPagination } from "../../../../../../lib/utils/pagination.js";
import { ApiError } from "../../../../../../lib/errors/api.error.js";
import {
    DEFAULT_PAGE,
    DEFAULT_TAKE,
    EXPORT_MAX_ROWS,
    buildDateRangeConditions,
    buildOrderBy,
    combineWhere,
} from "../_shared/movement.helpers.js";
import {
    QueryStockMovementFGDTO,
    ResponseStockMovementFGDTO,
} from "./fg.schema.js";

const DEFAULT_FG_WAREHOUSE_CODE = "GFG-SBY";

const SORT_COLUMN: Record<NonNullable<QueryStockMovementFGDTO["sortBy"]>, string> = {
    created_at: "sm.created_at",
    quantity:   "sm.quantity",
};

type FGRawRow = {
    id:                number;
    entity_id:         number;
    product_code:      string;
    product_name:      string | null;
    category:          string | null;
    size:              string | null;
    gender:            string | null;
    location_type:     string;
    location_id:       number;
    location_name:     string | null;
    movement_type:     string;
    quantity:          Prisma.Decimal;
    qty_before:        Prisma.Decimal;
    qty_after:         Prisma.Decimal;
    reference_id:      number | null;
    reference_type:    string | null;
    reference_code:    string | null;
    reference_subtype: string | null;
    destination_name:  string | null;
    created_by:        string | null;
    created_at:        Date;
};

export class StockMovementFGService {
    static async list(query: QueryStockMovementFGDTO): Promise<{
        data: ResponseStockMovementFGDTO[];
        len:  number;
    }> {
        const resolved = await this.applyDefaultLocation(query);
        const { skip, take } = GetPagination(
            resolved.page ?? DEFAULT_PAGE,
            resolved.take ?? DEFAULT_TAKE,
        );
        const { whereClause, orderBySql } = this.buildClauses(resolved);

        const [countResult, rows] = await Promise.all([
            prisma.$queryRaw<{ total: bigint }[]>`
                SELECT COUNT(*)::bigint AS total
                ${this.BASE_JOINS}
                ${whereClause}
            `,
            prisma.$queryRaw<FGRawRow[]>`
                SELECT ${this.BASE_SELECT}
                ${this.BASE_JOINS}
                ${whereClause}
                ${orderBySql}
                LIMIT ${take} OFFSET ${skip}
            `,
        ]);

        return {
            len:  Number(countResult[0]?.total ?? 0),
            data: rows.map(this.toDTO),
        };
    }

    static async export(query: QueryStockMovementFGDTO): Promise<ResponseStockMovementFGDTO[]> {
        const resolved = await this.applyDefaultLocation(query);
        const { whereClause, orderBySql } = this.buildClauses(resolved);

        const countResult = await prisma.$queryRaw<{ total: bigint }[]>`
            SELECT COUNT(*)::bigint AS total
            ${this.BASE_JOINS}
            ${whereClause}
        `;
        const total = Number(countResult[0]?.total ?? 0);
        if (total > EXPORT_MAX_ROWS) {
            throw new ApiError(
                400,
                `Hasil melebihi batas export (${EXPORT_MAX_ROWS} baris). Persempit filter terlebih dahulu.`,
            );
        }

        const rows = await prisma.$queryRaw<FGRawRow[]>`
            SELECT ${this.BASE_SELECT}
            ${this.BASE_JOINS}
            ${whereClause}
            ${orderBySql}
            LIMIT ${EXPORT_MAX_ROWS}
        `;

        return rows.map(this.toDTO);
    }

    // ── Private helpers ─────────────────────────────────────────────────────

    private static async applyDefaultLocation(
        query: QueryStockMovementFGDTO,
    ): Promise<QueryStockMovementFGDTO> {
        if (query.location_type || query.location_id) return query;

        const wh = await prisma.warehouse.findFirst({
            where:  { code: DEFAULT_FG_WAREHOUSE_CODE, deleted_at: null },
            select: { id: true },
        });
        if (!wh) return query;

        return { ...query, location_type: "WAREHOUSE", location_id: wh.id };
    }

    private static buildClauses(query: QueryStockMovementFGDTO): {
        whereClause: Prisma.Sql;
        orderBySql:  Prisma.Sql;
    } {
        const {
            search,
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

        const conditions: Prisma.Sql[] = [
            Prisma.sql`sm.entity_type = 'PRODUCT'::"MovementEntityType"`,
        ];

        if (entity_id) conditions.push(Prisma.sql`sm.entity_id = ${entity_id}`);
        if (location_type)
            conditions.push(
                Prisma.sql`sm.location_type = ${location_type}::text::"MovementLocationType"`,
            );
        if (location_id) conditions.push(Prisma.sql`sm.location_id = ${location_id}`);
        if (movement_type)
            conditions.push(Prisma.sql`sm.movement_type = ${movement_type}::text::"MovementType"`);
        if (reference_type)
            conditions.push(
                Prisma.sql`sm.reference_type = ${reference_type}::text::"MovementRefType"`,
            );
        if (reference_id) conditions.push(Prisma.sql`sm.reference_id = ${reference_id}`);
        if (created_by)   conditions.push(Prisma.sql`sm.created_by ILIKE ${`%${created_by}%`}`);

        if (search) {
            const pattern = `%${search}%`;
            conditions.push(Prisma.sql`(p.name ILIKE ${pattern} OR p.code ILIKE ${pattern})`);
        }
        conditions.push(...buildDateRangeConditions(date_from, date_to));

        return {
            whereClause: combineWhere(conditions),
            orderBySql:  buildOrderBy(SORT_COLUMN, sortBy, sortOrder, "created_at"),
        };
    }

    private static toDTO(r: FGRawRow): ResponseStockMovementFGDTO {
        return {
            id:                r.id,
            entity_id:         r.entity_id,
            product_code:      r.product_code,
            product_name:      r.product_name,
            category:          r.category,
            size:              r.size,
            gender:            r.gender,
            location_type:     r.location_type,
            location_id:       r.location_id,
            location_name:     r.location_name,
            movement_type:     r.movement_type,
            quantity:          Number(r.quantity),
            qty_before:        Number(r.qty_before),
            qty_after:         Number(r.qty_after),
            reference_id:      r.reference_id,
            reference_type:    r.reference_type,
            reference_code:    r.reference_code,
            reference_subtype: r.reference_subtype,
            destination_name:  r.destination_name,
            created_by:        r.created_by,
            created_at:        r.created_at,
        };
    }

    private static readonly BASE_SELECT = Prisma.sql`
        sm.id,
        sm.entity_id,
        p.code                         AS product_code,
        p.name                         AS product_name,
        pt.name                        AS category,
        ps.size::text                  AS size,
        p.gender::text                 AS gender,
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
        CASE
            WHEN sm.reference_type::text = 'STOCK_TRANSFER' AND st.to_outlet_id    IS NOT NULL THEN 'DO'
            WHEN sm.reference_type::text = 'STOCK_TRANSFER' AND st.to_warehouse_id IS NOT NULL THEN 'TG'
            WHEN sm.reference_type::text = 'STOCK_RETURN'  THEN 'RETURN'
            WHEN sm.reference_type::text = 'GOODS_RECEIPT' THEN 'GR'
            ELSE NULL
        END                            AS reference_subtype,
        CASE
            WHEN sm.movement_type::text IN ('OUT', 'TRANSFER_OUT', 'RETURN_OUT', 'POS_SALE') THEN
                CASE
                    WHEN sm.reference_type::text = 'STOCK_TRANSFER' THEN COALESCE(st_tw.name, st_to.name)
                    WHEN sm.reference_type::text = 'STOCK_RETURN'   THEN COALESCE(sr_tw.name, sr_to.name)
                    ELSE 'OUTBOUND'
                END
            WHEN sm.movement_type::text IN ('IN', 'TRANSFER_IN', 'RETURN_IN', 'INITIAL') THEN
                CASE
                    WHEN sm.reference_type::text = 'STOCK_TRANSFER' THEN st_fw.name
                    WHEN sm.reference_type::text = 'STOCK_RETURN'   THEN COALESCE(sr_fw.name, sr_fo.name)
                    WHEN sm.reference_type::text = 'GOODS_RECEIPT'  THEN 'PRODUCTION / INBOUND'
                    ELSE 'INBOUND'
                END
            ELSE NULL
        END                            AS destination_name,
        sm.created_by,
        sm.created_at
    `;

    private static readonly BASE_JOINS = Prisma.sql`
        FROM stock_movements sm
        INNER JOIN products      p   ON sm.entity_id = p.id
        LEFT  JOIN product_types pt  ON p.type_id    = pt.id
        LEFT  JOIN product_size  ps  ON p.size_id    = ps.id
        LEFT  JOIN warehouses    w   ON sm.location_id = w.id AND sm.location_type::text = 'WAREHOUSE'
        LEFT  JOIN outlets       o   ON sm.location_id = o.id AND sm.location_type::text = 'OUTLET'
        LEFT  JOIN stock_transfers st ON sm.reference_id = st.id AND sm.reference_type::text = 'STOCK_TRANSFER'
        LEFT  JOIN stock_returns   sr ON sm.reference_id = sr.id AND sm.reference_type::text = 'STOCK_RETURN'
        LEFT  JOIN goods_receipts  gr ON sm.reference_id = gr.id AND sm.reference_type::text = 'GOODS_RECEIPT'
        LEFT  JOIN warehouses st_fw  ON st.from_warehouse_id = st_fw.id
        LEFT  JOIN warehouses st_tw  ON st.to_warehouse_id   = st_tw.id
        LEFT  JOIN outlets    st_to  ON st.to_outlet_id      = st_to.id
        LEFT  JOIN warehouses sr_fw  ON sr.from_warehouse_id = sr_fw.id
        LEFT  JOIN outlets    sr_fo  ON sr.from_outlet_id    = sr_fo.id
        LEFT  JOIN warehouses sr_tw  ON sr.to_warehouse_id   = sr_tw.id
        LEFT  JOIN outlets    sr_to  ON sr.to_outlet_id      = sr_to.id
    `;
}
