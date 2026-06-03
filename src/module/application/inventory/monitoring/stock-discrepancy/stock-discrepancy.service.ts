import prisma from "../../../../../config/prisma.js";
import { Prisma, TransferStatus } from "../../../../../generated/prisma/client.js";
import { GetPagination } from "../../../../../lib/utils/pagination.js";
import { ApiError } from "../../../../../lib/errors/api.error.js";
import {
    QueryStockDiscrepancyDTO,
    ResponseStockDiscrepancyDTO,
} from "./stock-discrepancy.schema.js";

const DEFAULT_PAGE     = 1;
const DEFAULT_TAKE     = 25;
const EXPORT_MAX_ROWS  = 5_000;

/** Status transfer yang dianggap "selesai" — hanya transfer di status ini yang relevan untuk audit discrepancy. */
const DISCREPANCY_TRANSFER_STATUSES = [
    TransferStatus.COMPLETED,
    TransferStatus.PARTIAL,
    TransferStatus.MISSING,
    TransferStatus.REJECTED,
] as const;

const INCLUDE = {
    product: {
        include: { product_type: true, size: true, unit: true },
    },
    transfer: {
        include: { from_warehouse: true, to_warehouse: true, to_outlet: true },
    },
} as const satisfies Prisma.StockTransferItemInclude;

type StockTransferItemRow = Prisma.StockTransferItemGetPayload<{ include: typeof INCLUDE }>;

export class StockDiscrepancyService {
    /** Paginated list item transfer yang punya missing/rejected qty (audit discrepancy). */
    static async list(query: QueryStockDiscrepancyDTO): Promise<{
        data: ResponseStockDiscrepancyDTO[];
        len:  number;
    }> {
        const { skip, take } = GetPagination(
            query.page ?? DEFAULT_PAGE,
            query.take ?? DEFAULT_TAKE,
        );
        const where = StockDiscrepancyService.buildWhere(query);

        const [rows, len] = await Promise.all([
            prisma.stockTransferItem.findMany({
                where,
                skip,
                take,
                orderBy: { transfer: { created_at: "desc" } },
                include: INCLUDE,
            }),
            prisma.stockTransferItem.count({ where }),
        ]);

        return { data: rows.map(StockDiscrepancyService.toDTO), len };
    }

    /**
     * Export tanpa pagination, dibatasi EXPORT_MAX_ROWS.
     * Bila count > EXPORT_MAX_ROWS, lempar 400 — minta user persempit filter.
     */
    static async export(query: QueryStockDiscrepancyDTO): Promise<ResponseStockDiscrepancyDTO[]> {
        const where = StockDiscrepancyService.buildWhere(query);
        const total = await prisma.stockTransferItem.count({ where });

        if (total > EXPORT_MAX_ROWS) {
            throw new ApiError(
                400,
                `Hasil melebihi batas export (${EXPORT_MAX_ROWS} baris). Persempit filter terlebih dahulu.`,
            );
        }

        const rows = await prisma.stockTransferItem.findMany({
            where,
            take: EXPORT_MAX_ROWS,
            orderBy: { transfer: { created_at: "desc" } },
            include: INCLUDE,
        });

        return rows.map(StockDiscrepancyService.toDTO);
    }

    // ── Private helpers ─────────────────────────────────────────────────────

    private static buildWhere(query: QueryStockDiscrepancyDTO): Prisma.StockTransferItemWhereInput {
        const conditions: Prisma.StockTransferItemWhereInput[] = [
            {
                OR: [
                    { quantity_missing:  { gt: 0 } },
                    { quantity_rejected: { gt: 0 } },
                ],
            },
            {
                transfer: { status: { in: [...DISCREPANCY_TRANSFER_STATUSES] } },
            },
        ];

        if (query.search) {
            conditions.push({
                OR: [
                    { transfer: { transfer_number: { contains: query.search, mode: "insensitive" } } },
                    { product:  { name: { contains: query.search, mode: "insensitive" } } },
                    { product:  { code: { contains: query.search, mode: "insensitive" } } },
                ],
            });
        }

        return { AND: conditions };
    }

    private static toDTO(r: StockTransferItemRow): ResponseStockDiscrepancyDTO {
        const t = r.transfer;
        const p = r.product;
        return {
            id:                 r.id,
            transfer_id:        r.transfer_id,
            transfer_number:    t.transfer_number,
            transfer_date:      t.created_at,
            from_location:      t.from_warehouse?.name ?? null,
            to_location:        t.to_outlet?.name ?? t.to_warehouse?.name ?? null,
            product_id:         p?.id ?? null,
            product_code:       p?.code ?? null,
            product_name:       p?.name ?? null,
            quantity_requested: Number(r.quantity_requested),
            quantity_missing:   Number(r.quantity_missing ?? 0),
            quantity_rejected:  Number(r.quantity_rejected ?? 0),
            notes:              r.notes ?? null,
        };
    }
}
