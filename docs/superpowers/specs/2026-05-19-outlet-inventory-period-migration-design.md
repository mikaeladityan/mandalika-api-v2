# Outlet Inventory Period Migration — Design (Phase A)

**Date:** 2026-05-19
**Schema target:** `outlet_inventories`
**Status:** Design — pending approval
**Unblocks:** Phase B — `2026-05-19-stock-distribution-design.md`

## 1. Background & Motivation

`product_inventories` and `raw_material_inventories` carry `month`/`year` columns so that each row represents a per-period running balance. This enables historical snapshots and the period filter used across monitoring views.

`outlet_inventories` does not. Today, an outlet's stock is a single row per `(outlet_id, product_id)` that is mutated in place — there is no way to reconstruct "what did outlet X look like last month." This creates two concrete problems:

1. **Inconsistency.** Same logical concept (per-location periodised stock) modeled two different ways.
2. **Blocks Phase B.** The stock-distribution module's `?month=&year=` filter cannot work for the outlet leg, forcing a "current-only" disclaimer hack on outlet columns.

Phase A closes the gap by giving `outlet_inventories` the same period semantics as warehouse inventories.

## 2. Scope

**In scope:**
- Add `month` and `year` columns to `outlet_inventories`
- Update unique constraint and add period index
- Update **all** writer call sites to upsert per `(outlet_id, product_id, month, year)` with running-balance carry-over on rollover
- Update **all** reader call sites that surface "current stock" to filter by current month/year
- Backfill existing rows to **current** month/year
- Tests for all touched services

**Out of scope:**
- `date` column. `product_inventories.date` exists with default `1` but is not actually filtered on anywhere in current codebase; adopting it for outlet would propagate dead schema. Decision: outlet uses **only `month` + `year`**. (Future cleanup may drop `date` from warehouse legs too, but that is a separate concern.)
- Cross-period rollover job (we carry forward implicitly on first write of a new period; no scheduled job needed for v1).
- Frontend changes.
- Phase B (stock-distribution module).

## 3. Schema Change

```prisma
model OutletInventory {
  id         Int      @id @default(autoincrement())
  outlet_id  Int
  product_id Int
  quantity   Decimal  @default(0) @db.Decimal(18, 2)
  min_stock  Decimal? @db.Decimal(18, 2)
  month      Int      // NEW
  year       Int      // NEW
  updated_at DateTime @updatedAt
  outlet     Outlet   @relation(fields: [outlet_id], references: [id], onDelete: Cascade)
  product    Product  @relation(fields: [product_id], references: [id], onDelete: Cascade)

  @@unique([outlet_id, product_id, month, year])   // CHANGED
  @@index([outlet_id])
  @@index([product_id])
  @@index([month, year])                            // NEW
  @@map("outlet_inventories")
}
```

Migration SQL (Postgres):

```sql
-- Step 1: add columns nullable
ALTER TABLE outlet_inventories
  ADD COLUMN month INT,
  ADD COLUMN year  INT;

-- Step 2: backfill all rows to CURRENT period
UPDATE outlet_inventories
SET month = EXTRACT(MONTH FROM CURRENT_DATE)::int,
    year  = EXTRACT(YEAR  FROM CURRENT_DATE)::int
WHERE month IS NULL OR year IS NULL;

-- Step 3: enforce NOT NULL + defaults
ALTER TABLE outlet_inventories
  ALTER COLUMN month SET NOT NULL,
  ALTER COLUMN year  SET NOT NULL,
  ALTER COLUMN month SET DEFAULT 1,
  ALTER COLUMN year  SET DEFAULT 2024;

-- Step 4: replace unique constraint
-- (constraint name may differ in DB; Prisma's generated migration handles drop-and-recreate
-- correctly — manual SQL above is illustrative only.)
ALTER TABLE outlet_inventories DROP CONSTRAINT outlet_inventories_outlet_id_product_id_key;
ALTER TABLE outlet_inventories
  ADD CONSTRAINT outlet_inventories_outlet_id_product_id_month_year_key
  UNIQUE (outlet_id, product_id, month, year);

-- Step 5: add period index
CREATE INDEX outlet_inventories_month_year_idx ON outlet_inventories (month, year);
```

Run via `prisma migrate dev --name outlet_inventory_period`.

## 4. Period Write Semantics (Running Balance Carry-Over)

On every outlet stock mutation:

1. Compute `(currentMonth, currentYear)` from `new Date()`.
2. Look up row by composite unique `(outlet_id, product_id, currentMonth, currentYear)`.
3. **Hit** → update its `quantity`.
4. **Miss** → find latest preceding row for `(outlet_id, product_id)` ordered by `year DESC, month DESC`. Its `quantity` becomes the carry-over `qty_before`. Apply the delta and `create` a new row for current period with the resulting quantity.
5. **Cold start** (no prior row at all) → create with delta as initial quantity (matches today's behavior for first-ever stock).

This matches the implicit semantics already used in `product.stock.service.ts:177` for warehouse leg.

## 5. Reader Semantics

All readers that show "current stock for outlet X" must explicitly filter on `(month: currentMonth, year: currentYear)`. There is exactly one current row per `(outlet, product)` after this change; falling back to "latest preceding row" is reader's choice for the cold-start case but should only be needed transiently.

Display-side readers used by reports (e.g., monitoring) can take an arbitrary `(month, year)` — that is the whole point of the migration.

## 6. Affected Files

### 6.1 Writers (must update)

| File | What to change |
|---|---|
| `src/module/application/shared/inventory.helper.ts` `deductOutletStock` / `addOutletStock` | Use upsert by `(outlet_id, product_id, month, year)`; implement carry-over lookup on miss |
| `src/module/application/stock-transfer/stock-transfer.service.ts` (4 call sites at L245, L256, L330, L337-L342) | Same — write to current-period row |
| `src/module/application/inventory-v2/do/do.service.ts` (L416) | Same |
| `src/module/application/outlet/inventory/outlet-inventory.service.ts` (manual CRUD, L23–L160) | Update `findUnique` calls + `create`/`update` to include period; `createMany` must include `month`/`year`; `update` operates on current period only |
| `src/tests/setup.ts` | Seed must include `month`/`year` |

### 6.2 Readers (must update)

| File | What to change |
|---|---|
| `src/module/application/inventory-v2/monitoring/stock-total/stock-total.service.ts` | Add `month`/`year` filter on outlet leg in the raw SQL UNION (line 100-104) |
| `src/module/application/inventory-v2/monitoring/stock-location/stock-location.service.ts` | Filter outlet rows by current period |
| `src/module/application/product/stock-location/product.stock-location.service.ts` | Filter outlet rows by current period |
| `src/module/application/inventory/fg/fg.service.ts` | Filter outlet rows by current period |
| `src/module/application/outlet/inventory/outlet-inventory.service.ts` (list/getByOutlet) | Default to current period |

### 6.3 Tests (must update or extend)

| File | What to change |
|---|---|
| `src/tests/outlet/outlet-inventory.service.test.ts` | All seeds + assertions add `month`/`year`; add period-rollover test |
| `src/tests/outlet/outlet-inventory.routes.test.ts` | Same |
| `src/tests/stock-transfer/stock-transfer.service.test.ts` | Seeds add period; verify writer writes to current period |
| `src/tests/inventory-v2/do/do.service.test.ts` | Same |
| `src/tests/inventory-v2/return/return.service.test.ts` | Same |
| `src/tests/product/product.routes.test.ts` | Same |
| `src/tests/inventory/fg/fg.service.test.ts` | Same |

Add a new test file:
- `src/tests/outlet/outlet-inventory-period.test.ts` — verifies carry-over on month rollover, multi-period isolation, cold start.

## 7. Migration Steps (execution order)

1. Update `schema.prisma`, run `prisma migrate dev --name outlet_inventory_period`.
2. Regenerate Prisma client.
3. Add new helper `getCurrentInventoryPeriod()` in `src/module/application/shared/inventory.helper.ts` returning `{ month, year }` from `new Date()` using server local time. This matches existing warehouse-leg writers — no timezone shift introduced.
4. Update each writer in dependency order: helper → stock-transfer → do → manual CRUD.
5. Update each reader.
6. Update tests + seed.
7. Run full test suite, expect green.

## 8. Backwards Compatibility

- Pre-existing `outlet_inventories` rows backfilled to current `(month, year)` — no historical depth before migration day, only forward from this date. Accepted per product decision.
- Frontend: read-only views unaffected for the current month. Historical month queries will return empty for outlets until the new month accrues data.

## 9. Risk & Mitigation

| Risk | Mitigation |
|---|---|
| Writer forgotten somewhere → orphan row in old `(outlet_id, product_id)` shape | Add Prisma type check + manual grep audit checklist in plan |
| Test seed drift | One shared helper `seedOutletInventory(opts)` in test setup that always includes period |
| Month rollover at midnight Asia/Jakarta | Use server local time (`new Date()`) consistent with existing warehouse-leg writers — they have the same behavior today |
| Concurrent writes at rollover boundary creating two rows | `@@unique` plus retry-on-conflict guard in upsert helper |

## 10. Open Items

None. Backfill strategy and column scope (`month` + `year` only, no `date`) decided during brainstorming 2026-05-19.
