import { Prisma } from "../../../../../../generated/prisma/client.js";

export const DEFAULT_PAGE = 1;
export const DEFAULT_TAKE = 50;
export const EXPORT_MAX_ROWS = 50_000;

export type SortOrder = "asc" | "desc";

export function buildDateRangeConditions(date_from?: string, date_to?: string): Prisma.Sql[] {
    const conditions: Prisma.Sql[] = [];
    if (date_from) {
        conditions.push(Prisma.sql`sm.created_at >= ${new Date(date_from)}`);
    }
    if (date_to) {
        const end = new Date(date_to);
        end.setUTCHours(23, 59, 59, 999);
        conditions.push(Prisma.sql`sm.created_at <= ${end}`);
    }
    return conditions;
}

export function combineWhere(conditions: Prisma.Sql[]): Prisma.Sql {
    return conditions.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
        : Prisma.empty;
}

export function buildOrderBy(
    sortColumnMap: Record<string, string>,
    sortBy: string,
    sortOrder: SortOrder,
    fallbackKey: keyof typeof sortColumnMap & string,
): Prisma.Sql {
    const col = sortColumnMap[sortBy] ?? sortColumnMap[fallbackKey];
    const dir = sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";
    return Prisma.sql`ORDER BY ${Prisma.raw(col!)} ${Prisma.raw(dir)}`;
}
