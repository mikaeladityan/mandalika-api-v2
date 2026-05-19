/** Resolve effective period from optional query month/year (defaults to current). */
export function resolvePeriod(month?: number, year?: number): { month: number; year: number } {
    const now = new Date();
    return {
        month: month ?? now.getMonth() + 1,
        year:  year  ?? now.getFullYear(),
    };
}

/**
 * Cap for in-memory sort on computed `total_stock`. Since page `take` is capped
 * at 5000 in the Zod schema, the per-page sort never exceeds this cap.
 */
export const TOTAL_STOCK_SORT_CAP = 5000;
