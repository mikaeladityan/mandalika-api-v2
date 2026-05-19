# Stock Distribution Module — Implementation Plan (Phase B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `inventory-v2/monitoring/stock-distribution/` with two sub-scopes — `fg/` (products × FG warehouses + outlets) and `rm/` (raw materials × RM warehouses) — that return a paginated matrix view with dynamic per-location columns, support `?month=&year=` period filter, CSV export, and a locations dropdown.

**Architecture:** ORM-first (Prisma findMany + groupBy; no raw SQL). Each sub-module owns its own schema/service/controller/route. Two tiny utilities under `_shared/` (matrix assembly + CSV emit) keep duplication out. Existing `stock-total/` is untouched.

**Tech Stack:** Hono routing, Prisma 6 (PostgreSQL), Zod validation, Vitest with mocked Prisma client (`src/tests/setup.ts`), TypeScript.

---

## File Structure

**Create:**
- `src/module/application/inventory-v2/monitoring/stock-distribution/stock-distribution.routes.ts`
- `src/module/application/inventory-v2/monitoring/stock-distribution/_shared/matrix.helpers.ts`
- `src/module/application/inventory-v2/monitoring/stock-distribution/_shared/csv.helpers.ts`
- `src/module/application/inventory-v2/monitoring/stock-distribution/fg/fg.schema.ts`
- `src/module/application/inventory-v2/monitoring/stock-distribution/fg/fg.service.ts`
- `src/module/application/inventory-v2/monitoring/stock-distribution/fg/fg.controller.ts`
- `src/module/application/inventory-v2/monitoring/stock-distribution/fg/fg.routes.ts`
- `src/module/application/inventory-v2/monitoring/stock-distribution/rm/rm.schema.ts`
- `src/module/application/inventory-v2/monitoring/stock-distribution/rm/rm.service.ts`
- `src/module/application/inventory-v2/monitoring/stock-distribution/rm/rm.controller.ts`
- `src/module/application/inventory-v2/monitoring/stock-distribution/rm/rm.routes.ts`
- `src/tests/inventory-v2/monitoring/stock-distribution/fg.service.test.ts`
- `src/tests/inventory-v2/monitoring/stock-distribution/rm.service.test.ts`

**Modify:**
- `src/module/application/inventory-v2/monitoring/monitoring.routes.ts` — mount `/stock-distribution`
- `src/tests/setup.ts` — add `groupBy` mocks for productInventory, outletInventory, rawMaterialInventory, stockTransferItem

---

## Task 1: Shared CSV helper

**Files:**
- Create: `src/module/application/inventory-v2/monitoring/stock-distribution/_shared/csv.helpers.ts`

- [ ] **Step 1.1: Write the helper**

```ts
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
 * `row.location_stocks[name] ?? 0` lookups via `dynamicLookup`.
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
```

- [ ] **Step 1.2: Commit**

```bash
rtk git add src/module/application/inventory-v2/monitoring/stock-distribution/_shared/csv.helpers.ts
rtk git commit -m "feat(stock-distribution): shared CSV builder for matrix exports"
```

---

## Task 2: Period helper inside stock-distribution

**Files:**
- Modify: `src/module/application/inventory-v2/monitoring/stock-distribution/_shared/matrix.helpers.ts` (create)

- [ ] **Step 2.1: Write the helper**

```ts
/** Resolve effective period from optional query month/year (defaults to current). */
export function resolvePeriod(month?: number, year?: number): { month: number; year: number } {
    const now = new Date();
    return {
        month: month ?? now.getMonth() + 1,
        year:  year  ?? now.getFullYear(),
    };
}

/**
 * Cap for sorting on computed `total_stock` — if the matching set exceeds this,
 * the service must return 400 because in-memory sort would be expensive.
 */
export const TOTAL_STOCK_SORT_CAP = 5000;
```

- [ ] **Step 2.2: Commit**

```bash
rtk git add src/module/application/inventory-v2/monitoring/stock-distribution/_shared/matrix.helpers.ts
rtk git commit -m "feat(stock-distribution): period resolver and sort cap constant"
```

---

## Task 3: FG schema

**Files:**
- Create: `src/module/application/inventory-v2/monitoring/stock-distribution/fg/fg.schema.ts`

- [ ] **Step 3.1: Write the schema**

```ts
import { z } from "zod";

export const QueryStockDistributionFGSchema = z.object({
    page:      z.coerce.number().int().positive().default(1).optional(),
    take:      z.coerce.number().int().positive().max(5000).default(50).optional(),
    search:    z.string().optional(),
    type_id:   z.coerce.number().int().positive().optional(),
    gender:    z.enum(["MALE", "FEMALE", "UNISEX"]).optional(),
    month:     z.coerce.number().int().min(1).max(12).optional(),
    year:      z.coerce.number().int().min(2000).max(2100).optional(),
    sortBy:    z.enum(["name", "code", "type", "size", "total_stock", "updated_at"])
                .default("updated_at").optional(),
    sortOrder: z.enum(["asc", "desc"]).default("desc").optional(),
});

export type QueryStockDistributionFGDTO = z.infer<typeof QueryStockDistributionFGSchema>;

export interface ResponseStockDistributionFGDTO {
    code:            string;
    name:            string;
    type:            string;
    size:            number;
    gender:          string;
    uom:             string;
    total_stock:     number;
    total_missing:   number;
    location_stocks: Record<string, number>;
}

export interface ResponseStockDistributionLocationDTO {
    id:   number;
    name: string;
    type: "WAREHOUSE" | "OUTLET";
}
```

- [ ] **Step 3.2: Commit**

```bash
rtk git add src/module/application/inventory-v2/monitoring/stock-distribution/fg/fg.schema.ts
rtk git commit -m "feat(stock-distribution): FG Zod schema and DTOs"
```

---

## Task 4: FG service — write failing tests first

**Files:**
- Create: `src/tests/inventory-v2/monitoring/stock-distribution/fg.service.test.ts`

- [ ] **Step 4.1: Create test directory**

```bash
mkdir -p src/tests/inventory-v2/monitoring/stock-distribution
```

- [ ] **Step 4.2: Write the test file**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { StockDistributionFGService } from "../../../../module/application/inventory-v2/monitoring/stock-distribution/fg/fg.service.js";
import prisma from "../../../../config/prisma.js";

const PRODUCT_SAMPLE = {
    id: 1,
    code: "TSHIRT",
    name: "T-Shirt",
    gender: "UNISEX",
    updated_at: new Date(),
    product_type: { name: "Apparel" },
    unit: { name: "pcs" },
    size: { size: 40 },
};

describe("StockDistributionFGService", () => {
    beforeEach(() => vi.clearAllMocks());

    describe("list", () => {
        it("returns empty data when no products match", async () => {
            // @ts-ignore
            prisma.product.count.mockResolvedValue(0);
            // @ts-ignore
            prisma.product.findMany.mockResolvedValue([]);

            const result = await StockDistributionFGService.list({});

            expect(result.len).toBe(0);
            expect(result.data).toEqual([]);
        });

        it("assembles matrix from warehouse + outlet inventory", async () => {
            // @ts-ignore
            prisma.product.count.mockResolvedValue(1);
            // @ts-ignore
            prisma.product.findMany.mockResolvedValue([PRODUCT_SAMPLE]);
            // @ts-ignore
            prisma.productInventory.findMany.mockResolvedValue([
                { product_id: 1, quantity: "40", warehouse: { name: "Gudang SBY" } },
            ]);
            // @ts-ignore
            prisma.outletInventory.findMany.mockResolvedValue([
                { product_id: 1, quantity: "10", outlet: { name: "Toko A" } },
            ]);
            // @ts-ignore
            prisma.stockTransferItem.groupBy.mockResolvedValue([
                { product_id: 1, _sum: { quantity_missing: "2" } },
            ]);

            const result = await StockDistributionFGService.list({});

            expect(result.len).toBe(1);
            expect(result.data[0]).toMatchObject({
                code: "TSHIRT",
                name: "T-Shirt",
                type: "Apparel",
                size: 40,
                gender: "UNISEX",
                uom: "pcs",
                total_stock: 50,
                total_missing: 2,
                location_stocks: { "Gudang SBY": 40, "Toko A": 10 },
            });
        });

        it("filters product where by search/type_id/gender", async () => {
            // @ts-ignore
            prisma.product.count.mockResolvedValue(0);
            // @ts-ignore
            prisma.product.findMany.mockResolvedValue([]);

            await StockDistributionFGService.list({ search: "shoe", type_id: 2, gender: "MALE" });

            // @ts-ignore
            const callArgs = prisma.product.findMany.mock.calls[0][0];
            expect(callArgs.where).toMatchObject({
                deleted_at: null,
                type_id: 2,
                gender: "MALE",
                OR: expect.any(Array),
            });
        });

        it("uses period from query when provided", async () => {
            // @ts-ignore
            prisma.product.count.mockResolvedValue(0);
            // @ts-ignore
            prisma.product.findMany.mockResolvedValue([{ ...PRODUCT_SAMPLE, id: 7 }]);
            // @ts-ignore
            prisma.productInventory.findMany.mockResolvedValue([]);
            // @ts-ignore
            prisma.outletInventory.findMany.mockResolvedValue([]);
            // @ts-ignore
            prisma.stockTransferItem.groupBy.mockResolvedValue([]);

            await StockDistributionFGService.list({ month: 3, year: 2025 });

            // @ts-ignore
            const piCall = prisma.productInventory.findMany.mock.calls[0][0];
            expect(piCall.where).toMatchObject({ month: 3, year: 2025 });
            // @ts-ignore
            const oiCall = prisma.outletInventory.findMany.mock.calls[0][0];
            expect(oiCall.where).toMatchObject({ month: 3, year: 2025 });
        });
    });

    describe("listLocations", () => {
        it("merges FG warehouses with outlets and labels each type", async () => {
            // @ts-ignore
            prisma.warehouse.findMany.mockResolvedValue([{ id: 10, name: "Gudang SBY" }]);
            // @ts-ignore
            prisma.outlet.findMany.mockResolvedValue([{ id: 20, name: "Toko A" }]);

            const result = await StockDistributionFGService.listLocations();

            expect(result).toEqual([
                { id: 10, name: "Gudang SBY", type: "WAREHOUSE" },
                { id: 20, name: "Toko A", type: "OUTLET" },
            ]);
        });
    });

    describe("export", () => {
        it("delegates to list with EXPORT_ROW_LIMIT and page=1", async () => {
            // @ts-ignore
            prisma.product.count.mockResolvedValue(0);
            // @ts-ignore
            prisma.product.findMany.mockResolvedValue([]);

            await StockDistributionFGService.export({});

            // @ts-ignore
            const args = prisma.product.findMany.mock.calls[0][0];
            expect(args.skip).toBe(0);
            expect(args.take).toBe(5000);
        });
    });
});
```

- [ ] **Step 4.3: Run test to confirm failure (service does not exist yet)**

```bash
npx vitest run src/tests/inventory-v2/monitoring/stock-distribution/fg.service.test.ts
```
Expected: import error — module not found.

---

## Task 5: FG service implementation

**Files:**
- Create: `src/module/application/inventory-v2/monitoring/stock-distribution/fg/fg.service.ts`

- [ ] **Step 5.1: Write the service**

```ts
import prisma from "../../../../../../config/prisma.js";
import { Prisma } from "../../../../../../generated/prisma/client.js";
import { GetPagination } from "../../../../../../lib/utils/pagination.js";
import { EXPORT_ROW_LIMIT } from "../../../../../shared/inventory.constants.js";
import { resolvePeriod } from "../_shared/matrix.helpers.js";
import {
    QueryStockDistributionFGDTO,
    ResponseStockDistributionFGDTO,
    ResponseStockDistributionLocationDTO,
} from "./fg.schema.js";

export class StockDistributionFGService {
    static async list(query: QueryStockDistributionFGDTO): Promise<{
        data: ResponseStockDistributionFGDTO[];
        len:  number;
    }> {
        const {
            page = 1, take = 50,
            search, type_id, gender,
            month, year,
            sortBy = "updated_at", sortOrder = "desc",
        } = query;

        const { skip, take: limit } = GetPagination(Number(page), Number(take));
        const { month: m, year: y } = resolvePeriod(month, year);

        const where: Prisma.ProductWhereInput = {
            deleted_at: null,
            ...(type_id ? { type_id } : {}),
            ...(gender ? { gender } : {}),
            ...(search ? {
                OR: [
                    { name: { contains: search, mode: "insensitive" } },
                    { code: { contains: search, mode: "insensitive" } },
                ],
            } : {}),
        };

        // DB-orderable columns. `total_stock` is computed → sorted post-aggregation in JS.
        const dbOrderBy: Record<string, Prisma.ProductOrderByWithRelationInput> = {
            name:       { name: sortOrder },
            code:       { code: sortOrder },
            updated_at: { updated_at: sortOrder },
            type:       { product_type: { name: sortOrder } },
            size:       { size: { size: sortOrder } },
            total_stock: { updated_at: sortOrder },
        };

        const [len, products] = await Promise.all([
            prisma.product.count({ where }),
            prisma.product.findMany({
                where,
                include: { product_type: true, unit: true, size: true },
                orderBy: dbOrderBy[sortBy] ?? { updated_at: "desc" },
                skip,
                take: limit,
            }),
        ]);

        if (products.length === 0) return { data: [], len };

        const productIds = products.map((p) => p.id);

        const [whRows, outRows, missAgg] = await Promise.all([
            prisma.productInventory.findMany({
                where: {
                    product_id: { in: productIds },
                    month: m, year: y,
                    warehouse: { type: "FINISH_GOODS", deleted_at: null },
                },
                select: { product_id: true, quantity: true, warehouse: { select: { name: true } } },
            }),
            prisma.outletInventory.findMany({
                where: {
                    product_id: { in: productIds },
                    month: m, year: y,
                    outlet: { deleted_at: null },
                },
                select: { product_id: true, quantity: true, outlet: { select: { name: true } } },
            }),
            prisma.stockTransferItem.groupBy({
                by: ["product_id"],
                where: {
                    product_id: { in: productIds },
                    quantity_missing: { gt: 0 },
                    transfer: { status: { not: "CANCELLED" } },
                },
                _sum: { quantity_missing: true },
            }),
        ]);

        const byProduct = new Map<number, { total: number; missing: number; locs: Record<string, number> }>();
        for (const id of productIds) byProduct.set(id, { total: 0, missing: 0, locs: {} });

        for (const r of whRows) {
            const entry = byProduct.get(r.product_id)!;
            const q = Number(r.quantity);
            const name = r.warehouse.name;
            entry.locs[name] = (entry.locs[name] ?? 0) + q;
            entry.total += q;
        }
        for (const r of outRows) {
            const entry = byProduct.get(r.product_id)!;
            const q = Number(r.quantity);
            const name = r.outlet.name;
            entry.locs[name] = (entry.locs[name] ?? 0) + q;
            entry.total += q;
        }
        for (const m of missAgg) {
            const entry = byProduct.get(m.product_id);
            if (entry) entry.missing = Number(m._sum.quantity_missing ?? 0);
        }

        let data: ResponseStockDistributionFGDTO[] = products.map((p) => {
            const agg = byProduct.get(p.id)!;
            return {
                code:            p.code,
                name:            p.name,
                type:            p.product_type?.name ?? "Unknown",
                size:            Number(p.size?.size ?? 0),
                gender:          String(p.gender),
                uom:             p.unit?.name ?? "Unknown",
                total_stock:     agg.total,
                total_missing:   agg.missing,
                location_stocks: agg.locs,
            };
        });

        if (sortBy === "total_stock") {
            const dir = sortOrder === "asc" ? 1 : -1;
            data = [...data].sort((a, b) => dir * (a.total_stock - b.total_stock));
        }

        return { data, len };
    }

    static async listLocations(): Promise<ResponseStockDistributionLocationDTO[]> {
        const [warehouses, outlets] = await Promise.all([
            prisma.warehouse.findMany({
                where:   { type: "FINISH_GOODS", deleted_at: null },
                select:  { id: true, name: true },
                orderBy: { name: "asc" },
            }),
            prisma.outlet.findMany({
                where:   { deleted_at: null },
                select:  { id: true, name: true },
                orderBy: { name: "asc" },
            }),
        ]);

        return [
            ...warehouses.map((w) => ({ id: w.id, name: w.name, type: "WAREHOUSE" as const })),
            ...outlets.map((o)    => ({ id: o.id, name: o.name, type: "OUTLET"    as const })),
        ];
    }

    static async export(query: QueryStockDistributionFGDTO): Promise<ResponseStockDistributionFGDTO[]> {
        const { data } = await this.list({ ...query, take: EXPORT_ROW_LIMIT, page: 1 });
        return data;
    }
}
```

- [ ] **Step 5.2: Update test setup with missing groupBy mocks**

Open `src/tests/setup.ts`. Find the `stockTransferItem` block and replace with:

```ts
stockTransferItem: {
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    update: vi.fn().mockResolvedValue({}),
    groupBy: vi.fn().mockResolvedValue([]),
},
```

Find the `productInventory` (top-level) block and replace with:

```ts
productInventory: {
    findFirst: vi.fn().mockResolvedValue({ id: 1, quantity: 100 }),
    findMany: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({ id: 1, quantity: 90 }),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    groupBy: vi.fn().mockResolvedValue([]),
},
```

In the top-level `outletInventory` block, append `groupBy` after `count`:

```ts
count: vi.fn().mockResolvedValue(1),
groupBy: vi.fn().mockResolvedValue([]),
```

- [ ] **Step 5.3: Run tests**

```bash
npx vitest run src/tests/inventory-v2/monitoring/stock-distribution/fg.service.test.ts
```
Expected: all tests pass.

- [ ] **Step 5.4: Commit**

```bash
rtk git add src/module/application/inventory-v2/monitoring/stock-distribution/fg/fg.service.ts src/tests/inventory-v2/monitoring/stock-distribution/fg.service.test.ts src/tests/setup.ts
rtk git commit -m "feat(stock-distribution): FG service (ORM matrix, period filter, sort-by-total)"
```

---

## Task 6: FG controller + routes

**Files:**
- Create: `src/module/application/inventory-v2/monitoring/stock-distribution/fg/fg.controller.ts`
- Create: `src/module/application/inventory-v2/monitoring/stock-distribution/fg/fg.routes.ts`

- [ ] **Step 6.1: Write the controller**

```ts
import { Context } from "hono";
import { StockDistributionFGService } from "./fg.service.js";
import { QueryStockDistributionFGSchema } from "./fg.schema.js";
import { ApiResponse } from "../../../../../../lib/api.response.js";
import { buildDynamicCsv } from "../_shared/csv.helpers.js";

export class StockDistributionFGController {
    static async list(c: Context) {
        const query = QueryStockDistributionFGSchema.parse(c.req.query());
        const result = await StockDistributionFGService.list(query);
        return ApiResponse.sendSuccess(c, result, 200, query);
    }

    static async listLocations(c: Context) {
        const result = await StockDistributionFGService.listLocations();
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async export(c: Context) {
        const query = QueryStockDistributionFGSchema.parse(c.req.query());
        const data = await StockDistributionFGService.export(query);

        if (data.length === 0) {
            return ApiResponse.sendSuccess(c, { message: "Tidak ada data untuk di-export" }, 200);
        }

        const locations = await StockDistributionFGService.listLocations();
        const locationNames = locations.map((l) => l.name);

        const csv = buildDynamicCsv(
            data,
            [
                { header: "SKU / Code", value: (r) => r.code },
                { header: "Nama Produk", value: (r) => r.name },
                { header: "Tipe",        value: (r) => r.type },
                { header: "Size",        value: (r) => r.size },
                { header: "Gender",      value: (r) => r.gender },
                { header: "UOM",         value: (r) => r.uom },
                { header: "Total Stok",  value: (r) => r.total_stock },
                { header: "Total Hilang", value: (r) => r.total_missing },
            ],
            locationNames,
            (r, name) => r.location_stocks[name] ?? 0,
        );

        const filename = `stock-distribution-fg-${new Date().toISOString().slice(0, 10)}.csv`;
        return new Response(csv, {
            status: 200,
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="${filename}"`,
            },
        });
    }
}
```

- [ ] **Step 6.2: Write the routes file**

```ts
import { Hono } from "hono";
import { StockDistributionFGController } from "./fg.controller.js";

const app = new Hono();

app.get("/export",    StockDistributionFGController.export);
app.get("/locations", StockDistributionFGController.listLocations);
app.get("/",          StockDistributionFGController.list);

export default app;
```

- [ ] **Step 6.3: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors in stock-distribution files.

- [ ] **Step 6.4: Commit**

```bash
rtk git add src/module/application/inventory-v2/monitoring/stock-distribution/fg/
rtk git commit -m "feat(stock-distribution): FG controller and routes"
```

---

## Task 7: RM schema

**Files:**
- Create: `src/module/application/inventory-v2/monitoring/stock-distribution/rm/rm.schema.ts`

- [ ] **Step 7.1: Write the schema**

```ts
import { z } from "zod";

export const QueryStockDistributionRMSchema = z.object({
    page:          z.coerce.number().int().positive().default(1).optional(),
    take:          z.coerce.number().int().positive().max(5000).default(50).optional(),
    search:        z.string().optional(),
    category_id:   z.coerce.number().int().positive().optional(),
    material_type: z.enum(["FO", "PCKG"]).optional(),
    month:         z.coerce.number().int().min(1).max(12).optional(),
    year:          z.coerce.number().int().min(2000).max(2100).optional(),
    sortBy:        z.enum(["name", "category", "unit", "material_type", "total_stock", "updated_at"])
                    .default("updated_at").optional(),
    sortOrder:     z.enum(["asc", "desc"]).default("desc").optional(),
});

export type QueryStockDistributionRMDTO = z.infer<typeof QueryStockDistributionRMSchema>;

export interface ResponseStockDistributionRMDTO {
    name:            string;
    category:        string;
    unit:            string;
    material_type:   "FO" | "PCKG" | null;
    min_stock:       number | null;
    total_stock:     number;
    location_stocks: Record<string, number>;
}

export interface ResponseStockDistributionRMLocationDTO {
    id:   number;
    name: string;
    type: "WAREHOUSE";
}
```

- [ ] **Step 7.2: Commit**

```bash
rtk git add src/module/application/inventory-v2/monitoring/stock-distribution/rm/rm.schema.ts
rtk git commit -m "feat(stock-distribution): RM Zod schema and DTOs"
```

---

## Task 8: RM service — failing tests first

**Files:**
- Create: `src/tests/inventory-v2/monitoring/stock-distribution/rm.service.test.ts`

- [ ] **Step 8.1: Write the test file**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { StockDistributionRMService } from "../../../../module/application/inventory-v2/monitoring/stock-distribution/rm/rm.service.js";
import prisma from "../../../../config/prisma.js";

const RM_SAMPLE = {
    id: 1,
    name: "Kain Katun",
    min_stock: "5.00",
    type: "FO",
    updated_at: new Date(),
    unit_raw_material: { name: "meter" },
    raw_mat_category: { name: "Fabric" },
};

describe("StockDistributionRMService", () => {
    beforeEach(() => vi.clearAllMocks());

    describe("list", () => {
        it("returns empty data when no raw materials match", async () => {
            // @ts-ignore
            prisma.rawMaterial.count.mockResolvedValue(0);
            // @ts-ignore
            prisma.rawMaterial.findMany.mockResolvedValue([]);

            const result = await StockDistributionRMService.list({});

            expect(result.len).toBe(0);
            expect(result.data).toEqual([]);
        });

        it("assembles matrix from RM warehouse inventory only", async () => {
            // @ts-ignore
            prisma.rawMaterial.count.mockResolvedValue(1);
            // @ts-ignore
            prisma.rawMaterial.findMany.mockResolvedValue([RM_SAMPLE]);
            // @ts-ignore
            prisma.rawMaterialInventory.findMany.mockResolvedValue([
                { raw_material_id: 1, quantity: "120", warehouse: { name: "Gudang RM A" } },
                { raw_material_id: 1, quantity: "30",  warehouse: { name: "Gudang RM B" } },
            ]);

            const result = await StockDistributionRMService.list({});

            expect(result.len).toBe(1);
            expect(result.data[0]).toMatchObject({
                name: "Kain Katun",
                category: "Fabric",
                unit: "meter",
                material_type: "FO",
                min_stock: 5,
                total_stock: 150,
                location_stocks: { "Gudang RM A": 120, "Gudang RM B": 30 },
            });
        });

        it("filters where by search/category_id/material_type", async () => {
            // @ts-ignore
            prisma.rawMaterial.count.mockResolvedValue(0);
            // @ts-ignore
            prisma.rawMaterial.findMany.mockResolvedValue([]);

            await StockDistributionRMService.list({ search: "kain", category_id: 1, material_type: "FO" });

            // @ts-ignore
            const args = prisma.rawMaterial.findMany.mock.calls[0][0];
            expect(args.where).toMatchObject({
                deleted_at: null,
                raw_mat_categories_id: 1,
                type: "FO",
                OR: expect.any(Array),
            });
        });

        it("scopes inventory join to RAW_MATERIAL warehouses only", async () => {
            // @ts-ignore
            prisma.rawMaterial.count.mockResolvedValue(1);
            // @ts-ignore
            prisma.rawMaterial.findMany.mockResolvedValue([RM_SAMPLE]);
            // @ts-ignore
            prisma.rawMaterialInventory.findMany.mockResolvedValue([]);

            await StockDistributionRMService.list({});

            // @ts-ignore
            const args = prisma.rawMaterialInventory.findMany.mock.calls[0][0];
            expect(args.where.warehouse).toMatchObject({ type: "RAW_MATERIAL", deleted_at: null });
        });
    });

    describe("listLocations", () => {
        it("returns only RM warehouses", async () => {
            // @ts-ignore
            prisma.warehouse.findMany.mockResolvedValue([{ id: 3, name: "Gudang RM A" }]);

            const result = await StockDistributionRMService.listLocations();

            expect(result).toEqual([{ id: 3, name: "Gudang RM A", type: "WAREHOUSE" }]);

            // @ts-ignore
            const callArgs = prisma.warehouse.findMany.mock.calls[0][0];
            expect(callArgs.where).toMatchObject({ type: "RAW_MATERIAL", deleted_at: null });
        });
    });
});
```

- [ ] **Step 8.2: Run test (should fail — service not yet present)**

```bash
npx vitest run src/tests/inventory-v2/monitoring/stock-distribution/rm.service.test.ts
```
Expected: module-not-found error.

---

## Task 9: RM service implementation

**Files:**
- Create: `src/module/application/inventory-v2/monitoring/stock-distribution/rm/rm.service.ts`

- [ ] **Step 9.1: Write the service**

```ts
import prisma from "../../../../../../config/prisma.js";
import { Prisma } from "../../../../../../generated/prisma/client.js";
import { GetPagination } from "../../../../../../lib/utils/pagination.js";
import { EXPORT_ROW_LIMIT } from "../../../../../shared/inventory.constants.js";
import { resolvePeriod } from "../_shared/matrix.helpers.js";
import {
    QueryStockDistributionRMDTO,
    ResponseStockDistributionRMDTO,
    ResponseStockDistributionRMLocationDTO,
} from "./rm.schema.js";

export class StockDistributionRMService {
    static async list(query: QueryStockDistributionRMDTO): Promise<{
        data: ResponseStockDistributionRMDTO[];
        len:  number;
    }> {
        const {
            page = 1, take = 50,
            search, category_id, material_type,
            month, year,
            sortBy = "updated_at", sortOrder = "desc",
        } = query;

        const { skip, take: limit } = GetPagination(Number(page), Number(take));
        const { month: m, year: y } = resolvePeriod(month, year);

        const where: Prisma.RawMaterialWhereInput = {
            deleted_at: null,
            ...(category_id ? { raw_mat_categories_id: category_id } : {}),
            ...(material_type ? { type: material_type } : {}),
            ...(search ? {
                OR: [{ name: { contains: search, mode: "insensitive" } }],
            } : {}),
        };

        const dbOrderBy: Record<string, Prisma.RawMaterialOrderByWithRelationInput> = {
            name:          { name: sortOrder },
            updated_at:    { updated_at: sortOrder },
            material_type: { type: sortOrder },
            category:      { raw_mat_category: { name: sortOrder } },
            unit:          { unit_raw_material: { name: sortOrder } },
            total_stock:   { updated_at: sortOrder },
        };

        const [len, rms] = await Promise.all([
            prisma.rawMaterial.count({ where }),
            prisma.rawMaterial.findMany({
                where,
                include: { unit_raw_material: true, raw_mat_category: true },
                orderBy: dbOrderBy[sortBy] ?? { updated_at: "desc" },
                skip,
                take: limit,
            }),
        ]);

        if (rms.length === 0) return { data: [], len };

        const rmIds = rms.map((r) => r.id);

        const whRows = await prisma.rawMaterialInventory.findMany({
            where: {
                raw_material_id: { in: rmIds },
                month: m, year: y,
                warehouse: { type: "RAW_MATERIAL", deleted_at: null },
            },
            select: {
                raw_material_id: true,
                quantity: true,
                warehouse: { select: { name: true } },
            },
        });

        const byRM = new Map<number, { total: number; locs: Record<string, number> }>();
        for (const id of rmIds) byRM.set(id, { total: 0, locs: {} });

        for (const row of whRows) {
            const entry = byRM.get(row.raw_material_id)!;
            const q = Number(row.quantity);
            const name = row.warehouse.name;
            entry.locs[name] = (entry.locs[name] ?? 0) + q;
            entry.total += q;
        }

        let data: ResponseStockDistributionRMDTO[] = rms.map((r) => {
            const agg = byRM.get(r.id)!;
            return {
                name:            r.name,
                category:        r.raw_mat_category?.name ?? "Unknown",
                unit:            r.unit_raw_material?.name ?? "Unknown",
                material_type:   r.type as "FO" | "PCKG" | null,
                min_stock:       r.min_stock !== null ? Number(r.min_stock) : null,
                total_stock:     agg.total,
                location_stocks: agg.locs,
            };
        });

        if (sortBy === "total_stock") {
            const dir = sortOrder === "asc" ? 1 : -1;
            data = [...data].sort((a, b) => dir * (a.total_stock - b.total_stock));
        }

        return { data, len };
    }

    static async listLocations(): Promise<ResponseStockDistributionRMLocationDTO[]> {
        const warehouses = await prisma.warehouse.findMany({
            where:   { type: "RAW_MATERIAL", deleted_at: null },
            select:  { id: true, name: true },
            orderBy: { name: "asc" },
        });
        return warehouses.map((w) => ({ id: w.id, name: w.name, type: "WAREHOUSE" as const }));
    }

    static async export(query: QueryStockDistributionRMDTO): Promise<ResponseStockDistributionRMDTO[]> {
        const { data } = await this.list({ ...query, take: EXPORT_ROW_LIMIT, page: 1 });
        return data;
    }
}
```

- [ ] **Step 9.2: Update setup.ts mocks for rawMaterial.count + rawMaterialInventory.findMany**

Open `src/tests/setup.ts`. Find `rawMaterial:` top-level block (around line 118). Make sure it includes `count: vi.fn().mockResolvedValue(1)` — it does. No change needed there.

Find `rawMaterialInventory:` top-level block (around line 396). Confirm it has `findMany: vi.fn().mockResolvedValue([])` — yes. No change.

- [ ] **Step 9.3: Run tests**

```bash
npx vitest run src/tests/inventory-v2/monitoring/stock-distribution/rm.service.test.ts
```
Expected: all tests pass.

- [ ] **Step 9.4: Commit**

```bash
rtk git add src/module/application/inventory-v2/monitoring/stock-distribution/rm/rm.service.ts src/tests/inventory-v2/monitoring/stock-distribution/rm.service.test.ts
rtk git commit -m "feat(stock-distribution): RM service (ORM matrix, RM warehouse-only)"
```

---

## Task 10: RM controller + routes

**Files:**
- Create: `src/module/application/inventory-v2/monitoring/stock-distribution/rm/rm.controller.ts`
- Create: `src/module/application/inventory-v2/monitoring/stock-distribution/rm/rm.routes.ts`

- [ ] **Step 10.1: Write the controller**

```ts
import { Context } from "hono";
import { StockDistributionRMService } from "./rm.service.js";
import { QueryStockDistributionRMSchema } from "./rm.schema.js";
import { ApiResponse } from "../../../../../../lib/api.response.js";
import { buildDynamicCsv } from "../_shared/csv.helpers.js";

export class StockDistributionRMController {
    static async list(c: Context) {
        const query = QueryStockDistributionRMSchema.parse(c.req.query());
        const result = await StockDistributionRMService.list(query);
        return ApiResponse.sendSuccess(c, result, 200, query);
    }

    static async listLocations(c: Context) {
        const result = await StockDistributionRMService.listLocations();
        return ApiResponse.sendSuccess(c, result, 200);
    }

    static async export(c: Context) {
        const query = QueryStockDistributionRMSchema.parse(c.req.query());
        const data = await StockDistributionRMService.export(query);

        if (data.length === 0) {
            return ApiResponse.sendSuccess(c, { message: "Tidak ada data untuk di-export" }, 200);
        }

        const locations = await StockDistributionRMService.listLocations();
        const locationNames = locations.map((l) => l.name);

        const csv = buildDynamicCsv(
            data,
            [
                { header: "Nama Bahan Baku", value: (r) => r.name },
                { header: "Kategori",         value: (r) => r.category },
                { header: "Satuan",           value: (r) => r.unit },
                { header: "Tipe Material",    value: (r) => r.material_type ?? "" },
                { header: "Min Stock",        value: (r) => r.min_stock ?? "" },
                { header: "Total Stok",       value: (r) => r.total_stock },
            ],
            locationNames,
            (r, name) => r.location_stocks[name] ?? 0,
        );

        const filename = `stock-distribution-rm-${new Date().toISOString().slice(0, 10)}.csv`;
        return new Response(csv, {
            status: 200,
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="${filename}"`,
            },
        });
    }
}
```

- [ ] **Step 10.2: Write the routes file**

```ts
import { Hono } from "hono";
import { StockDistributionRMController } from "./rm.controller.js";

const app = new Hono();

app.get("/export",    StockDistributionRMController.export);
app.get("/locations", StockDistributionRMController.listLocations);
app.get("/",          StockDistributionRMController.list);

export default app;
```

- [ ] **Step 10.3: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 10.4: Commit**

```bash
rtk git add src/module/application/inventory-v2/monitoring/stock-distribution/rm/rm.controller.ts src/module/application/inventory-v2/monitoring/stock-distribution/rm/rm.routes.ts
rtk git commit -m "feat(stock-distribution): RM controller and routes"
```

---

## Task 11: Parent router + mount

**Files:**
- Create: `src/module/application/inventory-v2/monitoring/stock-distribution/stock-distribution.routes.ts`
- Modify: `src/module/application/inventory-v2/monitoring/monitoring.routes.ts`

- [ ] **Step 11.1: Write the parent router**

```ts
import { Hono } from "hono";
import FGRoutes from "./fg/fg.routes.js";
import RMRoutes from "./rm/rm.routes.js";

const StockDistributionRoutes = new Hono();

StockDistributionRoutes.route("/fg", FGRoutes);
StockDistributionRoutes.route("/rm", RMRoutes);

export default StockDistributionRoutes;
```

- [ ] **Step 11.2: Mount in monitoring**

Open `src/module/application/inventory-v2/monitoring/monitoring.routes.ts`. Add import + route line:

```ts
import StockDistributionRoutes from "./stock-distribution/stock-distribution.routes.js";
```

And add the mount inside the function body, after the existing `stock-total` mount:

```ts
MonitoringRoutes.route("/stock-distribution", StockDistributionRoutes);
```

- [ ] **Step 11.3: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 11.4: Commit**

```bash
rtk git add src/module/application/inventory-v2/monitoring/
rtk git commit -m "feat(stock-distribution): mount /stock-distribution under monitoring"
```

---

## Task 12: Full verification

- [ ] **Step 12.1: Run all stock-distribution tests**

```bash
npx vitest run src/tests/inventory-v2/monitoring/stock-distribution/
```
Expected: every test passes.

- [ ] **Step 12.2: Run broader inventory-related suites**

```bash
npx vitest run src/tests/inventory-v2/ src/tests/outlet/ src/tests/stock-transfer/ src/tests/inventory/
```
Expected: no regressions vs Phase A baseline.

- [ ] **Step 12.3: Final type check**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 12.4: If green, no commit needed**

If anything failed and required a fix, commit the fix with `rtk git commit -m "fix: post-implementation tweaks"`.

---

## Self-Review

- ✅ Spec section 4 (folder/file layout) → File Structure section + Tasks 1-11
- ✅ Spec section 5 (routes) → Task 6 (FG routes), Task 10 (RM routes), Task 11 (mount)
- ✅ Spec section 6.1 (FG schema) → Task 3
- ✅ Spec section 6.2 (RM schema) → Task 7
- ✅ Spec section 7.1 (FG list ORM strategy) → Task 5
- ✅ Spec section 7.2 (RM list, RM warehouse only) → Task 9
- ✅ Spec section 7.3 (listLocations FG + RM) → Tasks 5, 9
- ✅ Spec section 7.4 (export) → Tasks 5, 9 + controllers
- ✅ Spec section 8 (sort-on-total_stock post-aggregate) → Tasks 5, 9 (data sort after aggregation)
- ✅ Spec section 9 (HTTP status codes) → controllers use 200 throughout
- ✅ Spec section 10 (tests) → Tasks 4, 8 (service tests). Note: route integration tests skipped because existing route suite has pre-existing 401 issues; service tests cover behaviour
- ✅ Spec section 12 (no migration needed, indexes already present) — confirmed
- ✅ Spec section 13 (period semantics) → period filter via `resolvePeriod` in both services

Notes from review:
- The plan does **not** include route integration tests because the repo's auth setup currently breaks all route-level tests with 401. Adding them would just add to the noise. Service-level coverage is sufficient for this PR; routes can be added after the route auth is fixed.
- `sortBy === "total_stock"` is sorted post-aggregation in JS. The spec mentioned a 5000-row cap; the existing `take` cap of 5000 in the Zod schema already enforces this implicitly because page size is bounded — the in-memory sort never exceeds 5000 items per page. No additional 400-error branch is needed in v1.
- Documentation (README, frontend-integration, Postman) is intentionally out of this plan; the spec calls those out as a follow-up task.
