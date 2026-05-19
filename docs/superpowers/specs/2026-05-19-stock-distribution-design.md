# Stock Distribution Module — Design

**Date:** 2026-05-19
**Module:** `api/src/module/application/inventory-v2/monitoring/stock-distribution/`
**Status:** Design — pending approval

## 1. Background & Motivation

Existing `monitoring/stock-total/` provides a "matrix view" of FG inventory: rows = products, dynamic columns = each FG warehouse + each outlet, cell = quantity. It works but has three limitations:

1. **FG-only.** Raw Material has no equivalent view despite needing one (procurement & production planning need RM-per-warehouse visibility).
2. **Raw SQL.** Implementation uses `prisma.$queryRaw` for the whole pipeline. Recent SOP (per `rm/` refactor, 2026-05-19) prefers ORM-only with selective `Prisma.sql` only when unavoidable.
3. **No period selection.** Always pinned to `now()`. A monthly snapshot per `month/year` is already in the data (`product_inventories.month/year`, `raw_material_inventories.month/year`) but not exposed.

We are adding a new module `stock-distribution/` with separate FG and RM sub-scopes. Existing `stock-total/` remains untouched until frontend migrates.

## 2. Scope

**In scope (this spec):**
- New module `monitoring/stock-distribution/fg/` (matrix: products × FG warehouses + outlets)
- New module `monitoring/stock-distribution/rm/` (matrix: raw materials × RM warehouses only)
- Period filter (`?month=`, `?year=`) optional, defaults to current
- Pagination, search, sort, dynamic location columns, CSV export, locations dropdown
- Backend only

**Out of scope:**
- Deprecating / deleting existing `stock-total/` (separate task once FE migrates)
- Frontend integration (separate task following frontend-dev-flow)
- RM `total_missing` (transfer-derived) — explicitly excluded per product decision
- Historical period across multiple months (only single month/year per query)

## 3. Naming

Module name: **`stock-distribution`** — accurately describes the matrix view (item × location distribution). Parent route: `/monitoring/stock-distribution/{fg|rm}`.

## 4. Folder & File Layout

```
src/module/application/inventory-v2/monitoring/stock-distribution/
├── stock-distribution.routes.ts        # parent router (mounts fg + rm)
├── _shared/
│   ├── matrix.helpers.ts               # buildMatrix(rows, locations, qtyMap)
│   └── csv.helpers.ts                  # escapeCsv, buildDynamicCsv
├── fg/
│   ├── fg.schema.ts                    # Zod + DTO types
│   ├── fg.service.ts                   # list / listLocations / export
│   ├── fg.controller.ts                # hono controllers
│   └── fg.routes.ts                    # GET / | /locations | /export
└── rm/
    ├── rm.schema.ts
    ├── rm.service.ts
    ├── rm.controller.ts
    └── rm.routes.ts
```

`_shared/` houses the small utilities both sub-modules use (matrix assembly + CSV emit). Each sub-module owns its own schema, service, controller, route. No `any`/`unknown`.

## 5. Routes

```
GET /monitoring/stock-distribution/fg              # list (paginated matrix)
GET /monitoring/stock-distribution/fg/locations    # dropdown: FG warehouses + active outlets
GET /monitoring/stock-distribution/fg/export       # CSV

GET /monitoring/stock-distribution/rm              # list
GET /monitoring/stock-distribution/rm/locations    # dropdown: RM warehouses only
GET /monitoring/stock-distribution/rm/export       # CSV
```

Mount in `monitoring.routes.ts`:
```ts
MonitoringRoutes.route("/stock-distribution", StockDistributionRoutes);
```

## 6. Schemas

### 6.1 FG (`fg.schema.ts`)

```ts
QueryStockDistributionFGSchema:
  page?      : positive int, default 1
  take?      : positive int <=5000, default 50
  search?    : string                  # matches product code / name
  type_id?   : int                     # ProductType filter
  gender?    : "MALE"|"FEMALE"|"UNISEX"  # cast to enum GENDER
  month?     : int 1..12, default = current month
  year?      : int 2000..2100, default = current year
  sortBy?    : "name"|"code"|"type"|"size"|"total_stock"|"updated_at", default "updated_at"
  sortOrder? : "asc"|"desc", default "desc"

ResponseStockDistributionFGDTO:
  code: string
  name: string
  type: string                        # ProductType.name or "Unknown"
  size: number                        # ProductSize.size or 0
  gender: string
  uom: string
  total_stock: number                 # sum across all FG warehouses + outlets
  total_missing: number               # from stock_transfer_items (non-cancelled)
  location_stocks: Record<string, number>   # { "Gudang SBY": 40, "Toko A": 10 }

ResponseStockDistributionLocationDTO:
  id: number
  name: string
  type: "WAREHOUSE" | "OUTLET"
```

### 6.2 RM (`rm.schema.ts`)

```ts
QueryStockDistributionRMSchema:
  page?, take?, search?              # same shape as FG
  category_id?  : int                 # RawMatCategories filter
  material_type?: "FO"|"PCKG"         # MaterialType enum
  month?, year? : same defaults
  sortBy?       : "name"|"category"|"unit"|"material_type"|"total_stock"|"updated_at"
  sortOrder?    : "asc"|"desc"

ResponseStockDistributionRMDTO:
  name: string
  category: string                    # RawMatCategories.name or "Unknown"
  unit: string                        # UnitRawMaterial.name
  material_type: "FO" | "PCKG" | null
  min_stock: number | null
  total_stock: number                 # sum across all RAW_MATERIAL warehouses
  location_stocks: Record<string, number>

ResponseStockDistributionRMLocationDTO:
  id: number
  name: string
  type: "WAREHOUSE"                   # always WAREHOUSE for RM
```

## 7. Service Design (ORM-first)

**Strategy:** keep query in Prisma ORM. Compute matrix in memory after fetching slim sets. Acceptable because the inventory tables are bounded by month/year + warehouse_type filter, and page size caps result at 5000.

### 7.1 FG `list(query)`

1. Resolve `month`/`year` from query or default to current.
2. Build Prisma `where` for `Product` (deleted_at null, search, type_id, gender).
3. Run in parallel:
   - `prisma.product.count({ where })` → total rows
   - `prisma.product.findMany({ where, include: { product_type, unit, size }, orderBy, skip, take })` → page rows
4. Collect `productIds` from page rows.
5. Run in parallel:
   - `prisma.productInventory.findMany({ where: { product_id in ids, month, year, warehouse: { type: 'FINISH_GOODS', deleted_at: null } }, include: { warehouse: { select: { name }} } })`
   - `prisma.outletInventory.findMany({ where: { product_id in ids, outlet: { deleted_at: null } }, include: { outlet: { select: { name }} } })`
   - `prisma.stockTransferItem.groupBy({ by: ['product_id'], where: { product_id in ids, quantity_missing: { gt: 0 }, transfer: { status: { not: 'CANCELLED' } } }, _sum: { quantity_missing: true } })`
6. Aggregate in JS via `_shared/matrix.helpers.ts`:
   - Map productId → `location_stocks` (warehouse name + outlet name keys)
   - Map productId → `total_stock` (sum) and `total_missing`
7. Sorting on `total_stock` (computed) is post-aggregate — when `sortBy='total_stock'`, sort full filtered set before pagination. Since `take` is capped and we already need productIds, fall back to a two-step: count + lightweight inventory aggregation + re-page. Detailed in implementation plan.

### 7.2 RM `list(query)`

Same shape as FG but:
- Base table: `raw_materials` (joined with `unit_raw_material`, `raw_mat_category`)
- Inventory source: `raw_material_inventories` with `warehouse.type='RAW_MATERIAL'`
- No outlet leg
- No `total_missing`

### 7.3 `listLocations()`

- **FG:** `warehouse.findMany({ where: { type: 'FINISH_GOODS', deleted_at: null }})` + `outlet.findMany({ where: { deleted_at: null }})` → merged with `type` discriminator.
- **RM:** `warehouse.findMany({ where: { type: 'RAW_MATERIAL', deleted_at: null }})` only.

### 7.4 `export(query)`

Delegate to `list({ ...query, take: EXPORT_ROW_LIMIT, page: 1 })`, build CSV via `_shared/csv.helpers.ts`. CSV headers: base columns + one column per location.

## 8. Sorting on Computed `total_stock`

When `sortBy=total_stock`:
- Fetch all matching IDs (no pagination) → join with pre-aggregated `_sum` from inventory tables → sort → slice to page window.
- Cap: if total matching IDs > 5000 reject with 400 ("Refine filter or sort by other column"). Keeps memory bounded.

For all other sort columns, sort happens in DB via Prisma `orderBy`.

## 9. Error Handling & HTTP Status Codes

Per project SOP:
- `200` success (list, locations, export with rows; export with zero rows returns success message JSON, also 200)
- `400` invalid query (Zod parse failure → bubbled as `ApiResponse.sendError(c, ..., 400)`)
- `500` unexpected DB error

No 201 anywhere — these are read-only endpoints.

## 10. Testing

Per test SOP (mirror rm/ suite):
- `fg.service.test.ts` — unit: empty result, single product across multiple locations, missing aggregation, sort variants, period filter
- `rm.service.test.ts` — unit: empty result, single material across multiple RM warehouses, period filter, category & material_type filter
- `fg.routes.test.ts` + `rm.routes.test.ts` — integration via supertest-style: 200 happy path, 400 invalid query, CSV export header check
- Target: ~30 tests total, all green. Must run inside existing inventory suite without regression.

## 11. Documentation Deliverables (follow-up task)

After implementation passes tests, follow `module-documentation` skill:
- `api/docs/modules/inventory/monitoring/stock-distribution/README.md`
- Postman folder under `erp-mandalika.postman_collection.json`
- Update `frontend-integration.md` registries (FG + RM rows)

These are tracked in implementation plan, not in this design spec.

## 12. Migration Notes

- No DB migration required — schema already supports both flows.
- No breaking changes to existing routes.
- Index check: `product_inventories.@@index([date, month, year])` and `raw_material_inventories.@@index([date, month, year])` already present. Sufficient.

## 13. Period Semantics for FG vs RM

A subtlety found during review: `outlet_inventories` has **no `month`/`year` column** — only `updated_at`. So historical snapshots only exist for warehouse legs.

- **FG**: when `?month=&year=` ≠ current period:
  - Warehouse leg pulls from `product_inventories` for that period
  - Outlet leg still shows **current** quantities (only source available)
  - Both are surfaced in `location_stocks`, but the response includes a flag `outlet_period_note: "current-only"` when non-current period is requested, so FE can disclaim
  - When period = current month/year, no flag is set
- **RM**: period works fully (all data comes from `raw_material_inventories` which has month/year).

This is a data-shape limitation, not a bug. Documented for FE consumers.

## 14. Open Items

None. All product decisions resolved during brainstorming on 2026-05-19.
