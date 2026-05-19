export interface CsvColumn<T> {
    header: string;
    value: (row: T) => string | number | null | undefined;
}

function escape(v: unknown): string {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"`
        : s;
}

/**
 * Build a CSV string from rows with static + dynamic (per-location) columns.
 * `locationNames` becomes one column per name; cell value comes from
 * `dynamicLookup(row, name)`.
 */
export function buildDynamicCsv<T>(
    rows: T[],
    staticColumns: CsvColumn<T>[],
    locationNames: string[],
    dynamicLookup: (row: T, locationName: string) => number,
): string {
    const headers = [...staticColumns.map((c) => c.header), ...locationNames];
    const lines = rows.map((row) => {
        const staticCells = staticColumns.map((c) => escape(c.value(row)));
        const dynamicCells = locationNames.map((n) => escape(dynamicLookup(row, n)));
        return [...staticCells, ...dynamicCells].join(",");
    });
    return [headers.join(","), ...lines].join("\n");
}
