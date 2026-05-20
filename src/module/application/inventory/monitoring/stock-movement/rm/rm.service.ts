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
    QueryStockMovementRMDTO,
    ResponseStockMovementRMDTO,
} from "./rm.schema.js";

const SORT_COLUMN: Record<NonNullable<QueryStockMovementRMDTO["sortBy"]>, string> = {
    created_at: "sm.created_at",
    quantity:   "sm.quantity",
};

type RMRawRow = {
    id:                number;
    entity_id:         number;
    barcode:           string | null;
    rm_name:           string;
    category:          string | null;
    unit:              string | null;
    material_type:     string | null;
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

export class StockMovementRMService {
    static async list(query: QueryStockMovementRMDTO): Promise<{
        data: ResponseStockMovementRMDTO[];
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
            prisma.$queryRaw<RMRawRow[]>`
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

    static async export(query: QueryStockMovementRMDTO): Promise<ResponseStockMovementRMDTO[]> {
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

        const rows = await prisma.$queryRaw<RMRawRow[]>`
            SELECT ${this.BASE_SELECT}
            ${this.BASE_JOINS}
            ${whereClause}
            ${orderBySql}
            LIMIT ${EXPORT_MAX_ROWS}
        `;

        return rows.map(this.toDTO);
    }

    // ── Private helpers ─────────────────────────────────────────────────────

    /**
     * RM hanya tinggal di warehouse bertipe RAW_MATERIAL.
     * Jika user tidak memilih lokasi, default ke warehouse RAW_MATERIAL pertama yang aktif.
     */
    private static async applyDefaultLocation(
        query: QueryStockMovementRMDTO,
    ): Promise<QueryStockMovementRMDTO> {
        if (query.location_id) return query;

        const wh = await prisma.warehouse.findFirst({
            where:   { type: "RAW_MATERIAL", deleted_at: null },
            select:  { id: true },
            orderBy: { id: "asc" },
        });
        if (!wh) return query;

        return { ...query, location_id: wh.id };
    }

    private static buildClauses(query: QueryStockMovementRMDTO): {
        whereClause: Prisma.Sql;
        orderBySql:  Prisma.Sql;
    } {
        const {
            search,
            entity_id,
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
            Prisma.sql`sm.entity_type   = 'RAW_MATERIAL'::"MovementEntityType"`,
            Prisma.sql`sm.location_type = 'WAREHOUSE'::"MovementLocationType"`,
        ];

        if (entity_id)   conditions.push(Prisma.sql`sm.entity_id    = ${entity_id}`);
        if (location_id) conditions.push(Prisma.sql`sm.location_id  = ${location_id}`);
        if (movement_type)
            conditions.push(Prisma.sql`sm.movement_type  = ${movement_type}::text::"MovementType"`);
        if (reference_type)
            conditions.push(Prisma.sql`sm.reference_type = ${reference_type}::text::"MovementRefType"`);
        if (reference_id) conditions.push(Prisma.sql`sm.reference_id = ${reference_id}`);
        if (created_by)   conditions.push(Prisma.sql`sm.created_by ILIKE ${`%${created_by}%`}`);

        if (search) {
            const pattern = `%${search}%`;
            conditions.push(Prisma.sql`(rm.name ILIKE ${pattern} OR rm.barcode ILIKE ${pattern})`);
        }
        conditions.push(...buildDateRangeConditions(date_from, date_to));

        return {
            whereClause: combineWhere(conditions),
            orderBySql:  buildOrderBy(SORT_COLUMN, sortBy, sortOrder, "created_at"),
        };
    }

    private static toDTO(r: RMRawRow): ResponseStockMovementRMDTO {
        return {
            id:                r.id,
            entity_id:         r.entity_id,
            barcode:           r.barcode,
            rm_name:           r.rm_name,
            category:          r.category,
            unit:              r.unit,
            material_type:     r.material_type,
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
        rm.barcode                       AS barcode,
        rm.name                          AS rm_name,
        rmc.name                         AS category,
        urm.name                         AS unit,
        rm.type::text                    AS material_type,
        sm.location_id,
        w.name                           AS location_name,
        sm.movement_type::text           AS movement_type,
        sm.quantity::numeric             AS quantity,
        sm.qty_before::numeric           AS qty_before,
        sm.qty_after::numeric            AS qty_after,
        sm.reference_id,
        sm.reference_type::text          AS reference_type,
        CASE
            WHEN sm.reference_type::text = 'PURCHASE_ORDER' THEN po.po_number
            WHEN sm.reference_type::text = 'GOODS_RECEIPT'  THEN pr.receipt_number
            WHEN sm.reference_type::text = 'STOCK_TRANSFER' THEN st.transfer_number
            WHEN sm.reference_type::text = 'PRODUCTION'     THEN prod.mfg_number
            ELSE NULL
        END                              AS reference_code,
        CASE
            WHEN sm.reference_type::text = 'PURCHASE_ORDER' THEN 'PO'
            WHEN sm.reference_type::text = 'GOODS_RECEIPT'  THEN 'GR'
            WHEN sm.reference_type::text = 'STOCK_TRANSFER' THEN 'TG'
            WHEN sm.reference_type::text = 'PRODUCTION'     THEN 'MFG'
            ELSE NULL
        END                              AS reference_subtype,
        CASE
            WHEN sm.movement_type::text IN ('IN', 'TRANSFER_IN', 'RETURN_IN', 'INITIAL') THEN
                CASE
                    WHEN sm.reference_type::text = 'PURCHASE_ORDER' THEN sup_po.name
                    WHEN sm.reference_type::text = 'GOODS_RECEIPT'  THEN sup_pr.name
                    WHEN sm.reference_type::text = 'STOCK_TRANSFER' THEN st_fw.name
                    ELSE 'INBOUND'
                END
            WHEN sm.movement_type::text IN ('OUT', 'TRANSFER_OUT', 'RETURN_OUT') THEN
                CASE
                    WHEN sm.reference_type::text = 'STOCK_TRANSFER' THEN st_tw.name
                    WHEN sm.reference_type::text = 'PRODUCTION'     THEN 'PRODUCTION'
                    ELSE 'OUTBOUND'
                END
            ELSE NULL
        END                              AS destination_name,
        sm.created_by,
        sm.created_at
    `;

    private static readonly BASE_JOINS = Prisma.sql`
        FROM stock_movements sm
        INNER JOIN raw_materials      rm  ON sm.entity_id = rm.id
        LEFT  JOIN raw_mat_categories rmc ON rm.raw_mat_categories_id = rmc.id
        LEFT  JOIN unit_raw_materials urm ON rm.unit_id               = urm.id
        LEFT  JOIN warehouses         w   ON sm.location_id = w.id
        LEFT  JOIN purchase_orders    po  ON sm.reference_id = po.id   AND sm.reference_type::text = 'PURCHASE_ORDER'
        LEFT  JOIN purchase_receipts  pr  ON sm.reference_id = pr.id   AND sm.reference_type::text = 'GOODS_RECEIPT'
        LEFT  JOIN stock_transfers    st  ON sm.reference_id = st.id   AND sm.reference_type::text = 'STOCK_TRANSFER'
        LEFT  JOIN production_orders  prod ON sm.reference_id = prod.id AND sm.reference_type::text = 'PRODUCTION'
        LEFT  JOIN suppliers          sup_po ON po.supplier_id = sup_po.id
        LEFT  JOIN purchase_orders    po_pr  ON pr.po_id       = po_pr.id
        LEFT  JOIN suppliers          sup_pr ON po_pr.supplier_id = sup_pr.id
        LEFT  JOIN warehouses st_fw ON st.from_warehouse_id = st_fw.id
        LEFT  JOIN warehouses st_tw ON st.to_warehouse_id   = st_tw.id
    `;
}
