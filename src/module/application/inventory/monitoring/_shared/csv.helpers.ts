export interface CsvColumn<T> {
    header: string;
    value: (row: T) => string | number | null | undefined;
}

const UTF8_BOM = "﻿";
const LINE_END = "\r\n";

type CsvCell = string | number | null | undefined;

function escape(v: CsvCell): string {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function joinRow(cells: string[]): string {
    return cells.join(",");
}

/** Static-column CSV writer (RFC 4180 + UTF-8 BOM + CRLF). */
export function buildCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
    const headerLine = joinRow(columns.map((c) => escape(c.header)));
    const dataLines  = rows.map((row) => joinRow(columns.map((c) => escape(c.value(row)))));
    return `${UTF8_BOM}${[headerLine, ...dataLines].join(LINE_END)}`;
}

/**
 * Static + dynamic per-location columns. Cell value for each dynamic column
 * comes from `dynamicLookup(row, locationName)`.
 */
export function buildDynamicCsv<T>(
    rows: T[],
    staticColumns: CsvColumn<T>[],
    locationNames: string[],
    dynamicLookup: (row: T, locationName: string) => number,
): string {
    const headerLine = joinRow([
        ...staticColumns.map((c) => escape(c.header)),
        ...locationNames.map(escape),
    ]);
    const dataLines = rows.map((row) =>
        joinRow([
            ...staticColumns.map((c) => escape(c.value(row))),
            ...locationNames.map((name) => escape(dynamicLookup(row, name))),
        ]),
    );
    return `${UTF8_BOM}${[headerLine, ...dataLines].join(LINE_END)}`;
}
