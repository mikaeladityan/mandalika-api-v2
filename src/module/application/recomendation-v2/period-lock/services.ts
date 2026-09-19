import { Prisma, RecommendationLockStatus, RecommendationLockView, WorkOrderProductStatus } from "../../../../generated/prisma/client.js";
import prisma from "../../../../config/prisma.js";
import { ApiError } from "../../../../lib/errors/api.error.js";
import type { LockPeriodRequest, ListLocksQuery, UnlockPeriodRequest } from "./schema.js";
import { materialIdsByTypeScope } from "../../shared/material-type-scope.js";

export type SnapshotRowInput = {
    view: RecommendationLockView;
    raw_mat_id: number;
    fg_id?: number | null;
    product_status: WorkOrderProductStatus;
    material_name: string;
    barcode?: string | null;
    category_name?: string | null;
    supplier_id?: number | null;
    supplier_name?: string | null;
    type_tag?: string | null;
    sort_sales?: number;
    sort_current_stock?: number;
    sort_forecast_needed?: number;
    sort_recommendation?: number;
    hidden?: boolean;
    payload: Record<string, unknown>;
};

type SnapshotCapture = {
    rows: SnapshotRowInput[];
    meta: Record<string, unknown>;
};

export type LockedRecommendationQuery = {
    page?: number;
    take?: number;
    search?: string;
    type?: string;
    sortBy?: string;
    order?: "asc" | "desc";
};

type RecommendationPeriods = {
    sales_periods: Array<Record<string, any>>;
    forecast_periods: Array<Record<string, any>>;
    po_periods: Array<Record<string, any>>;
};

const lockedError = () => new ApiError(409, "Periode rekomendasi sedang terkunci", { code: "PERIOD_LOCKED" }, "PERIOD_LOCKED");

function toSnapshotRow(row: SnapshotRowInput) {
    const fgId = row.fg_id ?? null;
    return {
        view: row.view,
        raw_mat_id: row.raw_mat_id,
        fg_id: fgId,
        fg_id_key: fgId ?? 0,
        product_status: row.product_status,
        material_name: row.material_name,
        barcode: row.barcode ?? null,
        category_name: row.category_name ?? null,
        supplier_id: row.supplier_id ?? null,
        supplier_name: row.supplier_name ?? null,
        type_tag: row.type_tag ?? null,
        sort_sales: row.sort_sales ?? 0,
        sort_current_stock: row.sort_current_stock ?? 0,
        sort_forecast_needed: row.sort_forecast_needed ?? 0,
        sort_recommendation: row.sort_recommendation ?? 0,
        hidden: row.hidden ?? false,
        payload: row.payload as Prisma.InputJsonValue,
    };
}

async function captureLiveRows(period: LockPeriodRequest): Promise<SnapshotCapture> {
    const query = { page: 1, take: 1_000_000, month: period.month, year: period.year, sales_months: 3, forecast_months: 4, po_months: 3 } as const;
    const [{ RecomendationV2Service }] = await Promise.all([
        import("../recomendation-v2.service.js"),
    ]);
    const [general, discontinueFg] = await Promise.all([
        RecomendationV2Service.list({ ...query, product_status: "ACTIVE" }),
        RecomendationV2Service.list({ ...query, product_status: "PENDING" }),
    ]);
    const { aggregateDiscontinueMaterialRows } = await import("../discontinue/material-recommendation.service.js");
    const discontinueMaterial = {
        data: aggregateDiscontinueMaterialRows(discontinueFg.data),
        periods: discontinueFg.periods,
    };
    const materialIds = [...new Set([
        ...general.data.map((row: any) => Number(row.material_id)),
        ...discontinueFg.data.map((row: any) => Number(row.material_id)),
        ...discontinueMaterial.data.map((row: any) => Number(row.material_id)),
    ])];
    const [scopeRows, materialMeta] = await Promise.all([
        Promise.all((['ffo', 'lokal', 'impor', 'tester'] as const).map(async (type) => [type, await materialIdsByTypeScope(type)] as const)),
        prisma.rawMaterial.findMany({
            where: { id: { in: materialIds } },
            select: {
                id: true,
                raw_mat_category: { select: { name: true } },
                supplier_materials: {
                    where: { is_preferred: true, status: "ACTIVE" },
                    orderBy: { supplier_id: "asc" },
                    take: 1,
                    select: { supplier_id: true, supplier: { select: { name: true } } },
                },
            },
        }).catch(() => []),
    ]);
    const typeByMaterial = new Map<number, string>();
    for (const [type, ids] of scopeRows) for (const id of ids ?? []) typeByMaterial.set(Number(id), type);
    const metaByMaterial = new Map((materialMeta as any[]).map((row: any) => [Number(row.id), row]));
    const mapRow = (row: any, view: RecommendationLockView): SnapshotRowInput => {
        const fgId = view === RecommendationLockView.DISCONTINUE_FG ? Number(row.finished_goods?.[0]?.id ?? 0) || null : null;
        const sales = row.sales ?? [];
        const meta = metaByMaterial.get(Number(row.material_id));
        const preferred = meta?.supplier_materials?.[0];
        return {
            view,
            raw_mat_id: Number(row.material_id),
            fg_id: fgId,
            product_status: view === RecommendationLockView.GENERAL ? WorkOrderProductStatus.ACTIVE : WorkOrderProductStatus.PENDING,
            material_name: String(row.material_name ?? ""),
            barcode: row.barcode ?? null,
            category_name: meta?.raw_mat_category?.name ?? null,
            supplier_id: preferred?.supplier_id ?? null,
            supplier_name: preferred?.supplier?.name ?? row.supplier_name ?? null,
            type_tag: typeByMaterial.get(Number(row.material_id)) ?? null,
            sort_sales: sales.reduce((sum: number, item: any) => sum + Number(item.quantity ?? 0), 0),
            sort_current_stock: Number(row.current_stock ?? 0),
            sort_forecast_needed: Number(row.forecast_needed ?? 0),
            sort_recommendation: Number(row.recommendation_quantity ?? 0),
            hidden: Boolean(row.work_order_hidden_at),
            payload: JSON.parse(JSON.stringify(row)) as Record<string, unknown>,
        };
    };
    return {
        rows: [
            ...general.data.map((row: any) => mapRow(row, RecommendationLockView.GENERAL)),
            ...discontinueFg.data.map((row: any) => mapRow(row, RecommendationLockView.DISCONTINUE_FG)),
            ...discontinueMaterial.data.map((row: any) => mapRow(row, RecommendationLockView.DISCONTINUE_MATERIAL)),
        ],
        meta: { periods: general.periods },
    };
}

export class RecommendationPeriodLockService {
    static async createLock(input: LockPeriodRequest, actorId: string) {
        const capture = await captureLiveRows(input);
        return prisma.$transaction(async (tx) => {
            const active = await tx.recommendationPeriodLock.findFirst({
                where: { month: input.month, year: input.year, status: RecommendationLockStatus.LOCKED },
                select: { id: true },
            });
            if (active) throw lockedError();
            const latest = await tx.recommendationPeriodLock.findFirst({
                where: { month: input.month, year: input.year },
                orderBy: { version: "desc" },
                select: { version: true },
            });
            const lock = await tx.recommendationPeriodLock.create({
                data: {
                    month: input.month,
                    year: input.year,
                    version: (latest?.version ?? 0) + 1,
                    note: input.note,
                    meta: capture.meta as Prisma.InputJsonValue,
                    locked_by: actorId,
                    rows: { create: capture.rows.map(toSnapshotRow) },
                },
                include: { _count: { select: { rows: true } } },
            });
            return { id: lock.id, month: lock.month, year: lock.year, version: lock.version, status: lock.status, locked_at: lock.locked_at, locked_by: lock.locked_by, note: lock.note, counts: { total: lock._count.rows } };
        });
    }

    static async releaseLock(input: UnlockPeriodRequest, actorId: string) {
        const lock = await prisma.recommendationPeriodLock.findFirst({
            where: { month: input.month, year: input.year, status: RecommendationLockStatus.LOCKED },
            orderBy: { version: "desc" },
        });
        if (!lock) throw new ApiError(404, "Lock periode aktif tidak ditemukan");
        return prisma.recommendationPeriodLock.update({
            where: { id: lock.id },
            data: { status: RecommendationLockStatus.RELEASED, unlocked_at: new Date(), unlocked_by: actorId },
        });
    }

    static async listLocks(input: ListLocksQuery) {
        const lockModel = (prisma as any).recommendationPeriodLock;
        if (!lockModel) return [];
        return lockModel.findMany({
            where: { month: input.month, year: input.year },
            orderBy: [{ year: "desc" }, { month: "desc" }, { version: "desc" }],
            include: { _count: { select: { rows: true } } },
        });
    }

    static async findActiveLock(month: number, year: number) {
        const lockModel = (prisma as any).recommendationPeriodLock;
        if (!lockModel) return null;
        return lockModel.findFirst({
            where: { month, year, status: RecommendationLockStatus.LOCKED },
            orderBy: { version: "desc" },
            include: { _count: { select: { rows: true } } },
        });
    }

    static async getLockState(month: number, year: number) {
        const active = await this.findActiveLock(month, year);
        if (active) return { locked: true, version: active.version, locked_at: active.locked_at, locked_by: active.locked_by, note: active.note, counts: { total: active._count.rows } };
        const lockModel = (prisma as any).recommendationPeriodLock;
        if (!lockModel) return { locked: false };
        const latest = await lockModel.findFirst({ where: { month, year }, orderBy: { version: "desc" }, select: { version: true } });
        return latest ? { locked: false, last_version: latest.version } : { locked: false };
    }

    static async assertPeriodUnlocked(month: number, year: number) {
        if (await this.findActiveLock(month, year)) throw lockedError();
    }

    static async findLockedRows(month: number, year: number, view: RecommendationLockView) {
        const lock = await this.findActiveLock(month, year);
        if (!lock) return null;
        const rowModel = (prisma as any).recommendationLockRow;
        if (!rowModel) return null;
        const rows = await rowModel.findMany({ where: { lock_id: lock.id, view }, orderBy: { sort_sales: "desc" } });
        return { lock, rows, periods: (lock.meta as { periods?: unknown } | null)?.periods };
    }

    static async listLockedRows(query: LockedRecommendationQuery & { month: number; year: number }, view: RecommendationLockView) {
        const lock = await this.findActiveLock(query.month, query.year);
        if (!lock) return null;
        const where: Prisma.RecommendationLockRowWhereInput = {
            lock_id: lock.id,
            view,
            ...(query.search ? {
                OR: [
                    { material_name: { contains: query.search, mode: "insensitive" } },
                    { barcode: { contains: query.search, mode: "insensitive" } },
                    { supplier_name: { contains: query.search, mode: "insensitive" } },
                ],
            } : {}),
            ...(query.type ? { type_tag: query.type } : {}),
        };
        const sortColumn = {
            material_name: "material_name",
            barcode: "barcode",
            current_stock: "sort_current_stock",
            forecast_needed: "sort_forecast_needed",
            recommendation_quantity: "sort_recommendation",
        } as const;
        const column = sortColumn[query.sortBy as keyof typeof sortColumn] ?? "sort_sales";
        const direction = query.order ?? "desc";
        const page = Math.max(1, query.page ?? 1);
        const take = Math.max(1, query.take ?? 25);
        const rowModel = (prisma as any).recommendationLockRow;
        if (!rowModel) return null;
        const [rows, len] = await Promise.all([
            rowModel.findMany({
                where,
                orderBy: [{ [column]: direction }, { id: "asc" }],
                skip: (page - 1) * take,
                take,
            }),
            rowModel.count({ where }),
        ]);
        return {
            data: rows.map((row: any) => {
                const payload = { ...(row.payload as Record<string, unknown>) } as Record<string, unknown>;
                payload.work_order_hidden_at = row.hidden ? payload.work_order_hidden_at : null;
                return payload;
            }),
            len,
            periods: ((lock.meta as { periods?: unknown } | null)?.periods ?? {}) as RecommendationPeriods,
            lock: {
                locked: true,
                version: lock.version,
                locked_at: lock.locked_at,
                locked_by: lock.locked_by,
                note: lock.note,
            },
        };
    }
}

export { RecommendationLockView, RecommendationLockStatus };
