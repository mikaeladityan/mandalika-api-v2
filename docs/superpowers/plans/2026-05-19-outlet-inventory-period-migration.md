# Outlet Inventory Period Migration — Implementation Plan (Phase A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `month`/`year` columns to `outlet_inventories` so per-period outlet stock snapshots work the same way as warehouse legs, unblocking the stock-distribution module.

**Architecture:**
- Schema: add `month`/`year` to `outlet_inventories`; unique becomes `(outlet_id, product_id, month, year)`; period index added.
- Writers: every outlet stock mutation finds-or-creates the row for the **current** `(month, year)` with running-balance carry-over from the latest preceding row.
- Readers that want "current stock" filter on the current `(month, year)`.
- Tests: all seeds/assertions include `month`/`year`; a new rollover test exercises carry-over.

**Tech Stack:** Prisma 6 (Postgres), Hono, Vitest with mocked Prisma client (`src/tests/setup.ts`), TypeScript.

---

## File Structure

**Create:**
- `prisma/migrations/20260519120000_outlet_inventory_period/migration.sql` — schema migration
- `src/tests/outlet/outlet-inventory-period.test.ts` — period rollover unit test

**Modify (writers):**
- `prisma/schema.prisma` — `OutletInventory` model
- `src/module/application/shared/inventory.helper.ts` — add `getCurrentInventoryPeriod()`, add private outlet resolve/write helpers, refactor `deductOutletStock`/`addOutletStock`
- `src/module/application/stock-transfer/stock-transfer.service.ts` — `deductOutletInventory`, `addOutletInventory` (2 private methods, 4 prisma sites)
- `src/module/application/inventory-v2/do/do.service.ts` — 1 outlet reader
- `src/module/application/outlet/inventory/outlet-inventory.service.ts` — `getStock`, `listStock`, `initProducts`, `setMinStock`, `adjustQuantity`

**Modify (readers):**
- `src/module/application/inventory-v2/monitoring/stock-total/stock-total.service.ts` — outlet UNION leg in raw SQL
- `src/module/application/inventory-v2/monitoring/stock-location/stock-location.service.ts` — current-period filter
- `src/module/application/product/stock-location/product.stock-location.service.ts` — current-period filter
- `src/module/application/inventory/fg/fg.service.ts` — current-period filter

**Modify (tests):**
- `src/tests/setup.ts` — `outletInventory` mocks return `month`/`year`; tx form same
- `src/tests/outlet/outlet-inventory.service.test.ts` — seeds + assertions
- `src/tests/outlet/outlet-inventory.routes.test.ts` — same
- `src/tests/stock-transfer/stock-transfer.service.test.ts` — seeds
- `src/tests/inventory-v2/do/do.service.test.ts` — seeds
- `src/tests/inventory-v2/return/return.service.test.ts` — seeds
- `src/tests/product/product.routes.test.ts` — seeds
- `src/tests/inventory/fg/fg.service.test.ts` — seeds

---

## Task 1: Schema Migration

**Files:**
- Modify: `prisma/schema.prisma` — `OutletInventory` model (around line 574)
- Create: `prisma/migrations/20260519120000_outlet_inventory_period/migration.sql`

- [ ] **Step 1.1: Update `OutletInventory` in schema.prisma**

Replace existing model with:

```prisma
model OutletInventory {
  id         Int      @id @default(autoincrement())
  outlet_id  Int
  product_id Int
  quantity   Decimal  @default(0) @db.Decimal(18, 2)
  min_stock  Decimal? @db.Decimal(18, 2)
  month      Int      @default(1)
  year       Int      @default(2024)
  updated_at DateTime @updatedAt
  outlet     Outlet   @relation(fields: [outlet_id], references: [id], onDelete: Cascade)
  product    Product  @relation(fields: [product_id], references: [id], onDelete: Cascade)

  @@unique([outlet_id, product_id, month, year])
  @@index([outlet_id])
  @@index([product_id])
  @@index([month, year])
  @@map("outlet_inventories")
}
```

- [ ] **Step 1.2: Generate migration via Prisma CLI**

Run:
```bash
npx prisma migrate dev --name outlet_inventory_period --create-only
```
Expected: new file under `prisma/migrations/<timestamp>_outlet_inventory_period/migration.sql`.

- [ ] **Step 1.3: Patch the generated migration to backfill BEFORE NOT NULL**

The default Prisma migration will fail on existing rows because new columns are NOT NULL. Edit the generated `migration.sql` to insert backfill between ADD COLUMN and SET NOT NULL. Final file content:

```sql
-- DropIndex / DropConstraint for old unique on (outlet_id, product_id)
ALTER TABLE "outlet_inventories" DROP CONSTRAINT IF EXISTS "outlet_inventories_outlet_id_product_id_key";

-- Add columns nullable first
ALTER TABLE "outlet_inventories"
    ADD COLUMN "month" INT,
    ADD COLUMN "year"  INT;

-- Backfill all existing rows to CURRENT period
UPDATE "outlet_inventories"
SET "month" = EXTRACT(MONTH FROM CURRENT_DATE)::int,
    "year"  = EXTRACT(YEAR  FROM CURRENT_DATE)::int
WHERE "month" IS NULL OR "year" IS NULL;

-- Enforce NOT NULL + defaults
ALTER TABLE "outlet_inventories"
    ALTER COLUMN "month" SET NOT NULL,
    ALTER COLUMN "month" SET DEFAULT 1,
    ALTER COLUMN "year"  SET NOT NULL,
    ALTER COLUMN "year"  SET DEFAULT 2024;

-- New unique + index
ALTER TABLE "outlet_inventories"
    ADD CONSTRAINT "outlet_inventories_outlet_id_product_id_month_year_key"
    UNIQUE ("outlet_id", "product_id", "month", "year");

CREATE INDEX "outlet_inventories_month_year_idx" ON "outlet_inventories" ("month", "year");
```

- [ ] **Step 1.4: Apply migration + regenerate client**

Run:
```bash
npx prisma migrate dev
npx prisma generate
```
Expected: migration applied, client regenerated. `prisma.outletInventory` now exposes `month`/`year` typed as `number`.

- [ ] **Step 1.5: Verify TypeScript compiles**

Run:
```bash
rtk tsc --noEmit
```
Expected: errors only at outlet-inventory call sites (which we'll fix in subsequent tasks). Other errors → stop and investigate.

- [ ] **Step 1.6: Commit**

```bash
rtk git add prisma/schema.prisma prisma/migrations/
rtk git commit -m "feat(schema): add month/year to outlet_inventories for period snapshots"
```

---

## Task 2: Period Helper + Outlet Resolve/Write Helpers

**Files:**
- Modify: `src/module/application/shared/inventory.helper.ts`

- [ ] **Step 2.1: Add `getCurrentInventoryPeriod()` at top of `InventoryHelper`**

Insert immediately after the class opening:

```ts
/** Returns the current month (1-12) and year used for inventory period rows. */
static getCurrentInventoryPeriod(): { month: number; year: number } {
    const now = new Date();
    return { month: now.getMonth() + 1, year: now.getFullYear() };
}
```

- [ ] **Step 2.2: Add private outlet resolve/write helpers**

Insert before `deductOutletStock`:

```ts
private static async resolveOutletInventoryRecord(
    tx: Prisma.TransactionClient,
    outlet_id: number,
    product_id: number,
    month: number,
    year: number,
): Promise<{ qtyBefore: number; targetRecord: { id: number; quantity: Prisma.Decimal } | null }> {
    const latest = (await tx.outletInventory.findMany({
        where: { outlet_id, product_id },
        orderBy: [{ year: "desc" }, { month: "desc" }],
        take: 1,
    }))[0] ?? null;

    const qtyBefore = latest ? Number(latest.quantity) : 0;
    const targetRecord = latest?.month === month && latest?.year === year ? latest : null;
    return { qtyBefore, targetRecord };
}

private static async writeOutletInventoryRecord(
    tx: Prisma.TransactionClient,
    outlet_id: number,
    product_id: number,
    targetRecord: { id: number } | null,
    qtyAfter: number,
    month: number,
    year: number,
): Promise<void> {
    if (targetRecord) {
        await tx.outletInventory.update({ where: { id: targetRecord.id }, data: { quantity: qtyAfter } });
    } else {
        await tx.outletInventory.create({
            data: { outlet_id, product_id, quantity: qtyAfter, month, year },
        });
    }
}
```

- [ ] **Step 2.3: Verify TypeScript compiles for the helper file**

Run:
```bash
rtk tsc --noEmit src/module/application/shared/inventory.helper.ts
```
Expected: no errors in this file. (Other files may still error.)

- [ ] **Step 2.4: Commit**

```bash
rtk git add src/module/application/shared/inventory.helper.ts
rtk git commit -m "feat(inventory): add period helper and outlet resolve/write helpers"
```

---

## Task 3: Refactor `deductOutletStock` / `addOutletStock`

**Files:**
- Modify: `src/module/application/shared/inventory.helper.ts` (lines 152-225 in current file)

- [ ] **Step 3.1: Rewrite `deductOutletStock`**

Replace the entire method body with:

```ts
static async deductOutletStock(
    tx: Prisma.TransactionClient,
    outlet_id: number,
    items: StockItem[],
    ref_id: number,
    ref_type: MovementRefType,
    movement_type: MovementType,
    userId: string,
): Promise<void> {
    const { month, year } = this.getCurrentInventoryPeriod();

    for (const item of items) {
        if (!item.product_id) throw new ApiError(400, "Product ID is required for outlet deduction");

        const { qtyBefore, targetRecord } = await this.resolveOutletInventoryRecord(
            tx, outlet_id, item.product_id, month, year,
        );

        if (qtyBefore < item.quantity) {
            const pName = item.product?.name ?? `ID:${item.product_id}`;
            throw new ApiError(400, `Stok tidak mencukupi di Outlet untuk produk ${pName}`);
        }

        const qty_after = qtyBefore - item.quantity;
        await this.writeOutletInventoryRecord(
            tx, outlet_id, item.product_id, targetRecord, qty_after, month, year,
        );

        await tx.stockMovement.create({
            data: {
                entity_type: MovementEntityType.PRODUCT,
                entity_id: item.product_id,
                location_type: MovementLocationType.OUTLET,
                location_id: outlet_id,
                movement_type,
                quantity: item.quantity,
                qty_before: qtyBefore,
                qty_after,
                reference_id: ref_id,
                reference_type: ref_type,
                created_by: userId,
            },
        });
    }
}
```

- [ ] **Step 3.2: Rewrite `addOutletStock`**

Replace with:

```ts
static async addOutletStock(
    tx: Prisma.TransactionClient,
    outlet_id: number,
    items: StockItem[],
    ref_id: number,
    ref_type: MovementRefType,
    movement_type: MovementType,
    userId: string,
    notes?: string,
): Promise<void> {
    const { month, year } = this.getCurrentInventoryPeriod();

    for (const item of items) {
        if (!item.product_id) throw new ApiError(400, "Product ID is required for outlet addition");

        const { qtyBefore, targetRecord } = await this.resolveOutletInventoryRecord(
            tx, outlet_id, item.product_id, month, year,
        );

        const qty_after = qtyBefore + item.quantity;
        await this.writeOutletInventoryRecord(
            tx, outlet_id, item.product_id, targetRecord, qty_after, month, year,
        );

        await tx.stockMovement.create({
            data: {
                entity_type: MovementEntityType.PRODUCT,
                entity_id: item.product_id,
                location_type: MovementLocationType.OUTLET,
                location_id: outlet_id,
                movement_type,
                quantity: item.quantity,
                qty_before: qtyBefore,
                qty_after,
                reference_id: ref_id,
                reference_type: ref_type,
                created_by: userId,
                ...(notes ? { notes } : {}),
            },
        });
    }
}
```

- [ ] **Step 3.3: Type-check the helper file**

Run:
```bash
rtk tsc --noEmit
```
Expected: helper file clean. Remaining errors only in writer/reader call sites we'll handle next.

- [ ] **Step 3.4: Commit**

```bash
rtk git add src/module/application/shared/inventory.helper.ts
rtk git commit -m "refactor(inventory): period-aware outlet stock helpers with carry-over"
```

---

## Task 4: Refactor `stock-transfer.service.ts` Outlet Methods

**Files:**
- Modify: `src/module/application/stock-transfer/stock-transfer.service.ts` (`deductOutletInventory` and `addOutletInventory` private methods)

- [ ] **Step 4.1: Replace `deductOutletInventory`**

Locate the private method (currently around line 242) and replace its body:

```ts
private static async deductOutletInventory(tx: any, outlet_id: number, items: any[], transfer_id: number, userId: string) {
    const { month, year } = InventoryHelper.getCurrentInventoryPeriod();

    for (const item of items) {
        const deductAmount = Number(item.quantity_packed || item.quantity_requested);

        const latest = (await tx.outletInventory.findMany({
            where: { outlet_id, product_id: item.product_id },
            orderBy: [{ year: 'desc' }, { month: 'desc' }],
            take: 1,
        }))[0] ?? null;

        const qty_before = latest ? Number(latest.quantity) : 0;
        if (qty_before < deductAmount) {
            throw new ApiError(400, `Insufficient stock in Outlet for product ${item.product_id}`);
        }

        const qty_after = qty_before - deductAmount;
        const isCurrentPeriod = latest?.month === month && latest?.year === year;

        if (isCurrentPeriod) {
            await tx.outletInventory.update({ where: { id: latest.id }, data: { quantity: qty_after } });
        } else {
            await tx.outletInventory.create({
                data: { outlet_id, product_id: item.product_id, quantity: qty_after, month, year },
            });
        }

        await tx.stockMovement.create({
            data: {
                entity_type: MovementEntityType.PRODUCT,
                entity_id: item.product_id,
                location_type: 'OUTLET',
                location_id: outlet_id,
                movement_type: MovementType.TRANSFER_OUT,
                quantity: deductAmount,
                qty_before,
                qty_after,
                reference_id: transfer_id,
                reference_type: MovementRefType.STOCK_TRANSFER,
                created_by: userId
            }
        });
    }
}
```

- [ ] **Step 4.2: Replace `addOutletInventory`**

Locate the method (around line 327) and replace:

```ts
private static async addOutletInventory(tx: any, outlet_id: number, items: any[], transfer_id: number, userId: string) {
    const { month, year } = InventoryHelper.getCurrentInventoryPeriod();

    for (const item of items) {
        const addAmount = Number(item.quantity_fulfilled);

        const latest = (await tx.outletInventory.findMany({
            where: { outlet_id, product_id: item.product_id },
            orderBy: [{ year: 'desc' }, { month: 'desc' }],
            take: 1,
        }))[0] ?? null;

        const qty_before = latest ? Number(latest.quantity) : 0;
        const qty_after = qty_before + addAmount;
        const isCurrentPeriod = latest?.month === month && latest?.year === year;

        if (isCurrentPeriod) {
            await tx.outletInventory.update({ where: { id: latest.id }, data: { quantity: qty_after } });
        } else {
            await tx.outletInventory.create({
                data: { outlet_id, product_id: item.product_id, quantity: qty_after, month, year },
            });
        }

        await tx.stockMovement.create({
            data: {
                entity_type: MovementEntityType.PRODUCT,
                entity_id: item.product_id,
                location_type: 'OUTLET',
                location_id: outlet_id,
                movement_type: MovementType.TRANSFER_IN,
                quantity: addAmount,
                qty_before,
                qty_after,
                reference_id: transfer_id,
                reference_type: MovementRefType.STOCK_TRANSFER,
                created_by: userId
            }
        });
    }
}
```

- [ ] **Step 4.3: Ensure `InventoryHelper` is imported**

If not already imported at top of file, add:
```ts
import { InventoryHelper } from "../shared/inventory.helper.js";
```
(Check existing imports; if `InventoryHelper` already imported elsewhere in the file, skip.)

- [ ] **Step 4.4: Type-check**

Run:
```bash
rtk tsc --noEmit
```
Expected: this file clean.

- [ ] **Step 4.5: Commit**

```bash
rtk git add src/module/application/stock-transfer/stock-transfer.service.ts
rtk git commit -m "refactor(stock-transfer): outlet stock writes use month/year period"
```

---

## Task 5: Update `do.service.ts` Outlet Reader

**Files:**
- Modify: `src/module/application/inventory-v2/do/do.service.ts` (around line 415)

- [ ] **Step 5.1: Replace the outlet lookup**

Find:
```ts
if (outlet_id) {
    const oi = await prisma.outletInventory.findUnique({
        where: { outlet_id_product_id: { outlet_id, product_id: Number(product_id) } },
    });
    return Number(oi?.quantity ?? 0);
}
```

Replace with:
```ts
if (outlet_id) {
    const oi = await prisma.outletInventory.findFirst({
        where: { outlet_id, product_id: Number(product_id) },
        orderBy: [{ year: "desc" }, { month: "desc" }],
    });
    return Number(oi?.quantity ?? 0);
}
```

(We return the **latest period** balance — matches "current available" semantics. If no row exists yet for current period, the prior period's balance is the carry-forward baseline, which is what callers want.)

- [ ] **Step 5.2: Type-check + commit**

```bash
rtk tsc --noEmit
rtk git add src/module/application/inventory-v2/do/do.service.ts
rtk git commit -m "refactor(do): outlet stock lookup uses latest period row"
```

---

## Task 6: Refactor `outlet-inventory.service.ts`

**Files:**
- Modify: `src/module/application/outlet/inventory/outlet-inventory.service.ts`

This file has 5 prisma.outletInventory call sites all using the old `outlet_id_product_id` unique. Each must select the **current** period row (creating it if missing for write paths, returning the latest preceding for read paths).

- [ ] **Step 6.1: Add a helper at top of class**

Insert after `findOutlet` private method:

```ts
private static getPeriod() {
    const now = new Date();
    return { month: now.getMonth() + 1, year: now.getFullYear() };
}
```

- [ ] **Step 6.2: Rewrite `getStock` (currently lines 20-38)**

```ts
static async getStock(outlet_id: number, product_id: number) {
    const outlet = await OutletInventoryService.findOutlet(outlet_id);

    const inventory = await prisma.outletInventory.findFirst({
        where: { outlet_id, product_id },
        orderBy: [{ year: "desc" }, { month: "desc" }],
        include: { product: { select: { id: true, name: true, code: true } } },
    });

    if (!inventory) throw new ApiError(404, "Stok produk tidak ditemukan di outlet ini");

    return {
        ...inventory,
        quantity: Number(inventory.quantity || 0),
        location_name: outlet.name,
        is_low_stock:
            inventory.min_stock !== null &&
            Number(inventory.quantity) < Number(inventory.min_stock),
    };
}
```

- [ ] **Step 6.3: Update `listStock` (currently line 40)**

Add current-period filter to the `where` clause. Modify the `where` construction:

```ts
const { month, year } = OutletInventoryService.getPeriod();

const where: Prisma.OutletInventoryWhereInput = {
    outlet_id,
    month,
    year,
    ...(search && {
        product: {
            OR: [
                { name: { contains: search, mode: "insensitive" } },
                { code: { contains: search, mode: "insensitive" } },
            ],
        },
    }),
};
```

- [ ] **Step 6.4: Update `initProducts` (currently line 109)**

The `createMany` call must include `month`/`year`:

```ts
const { month, year } = OutletInventoryService.getPeriod();

const result = await prisma.outletInventory.createMany({
    data: product_ids.map((product_id) => ({ outlet_id, product_id, quantity: 0, month, year })),
    skipDuplicates: true,
});
```

- [ ] **Step 6.5: Update `setMinStock` (currently line 131)**

```ts
static async setMinStock(outlet_id: number, product_id: number, body: RequestOutletInventorySetMinStockDTO) {
    const { month, year } = OutletInventoryService.getPeriod();

    const inventory = await prisma.outletInventory.findUnique({
        where: { outlet_id_product_id_month_year: { outlet_id, product_id, month, year } },
    });
    if (!inventory) throw new ApiError(404, "Stok produk tidak ditemukan di outlet ini untuk periode berjalan");

    return await prisma.outletInventory.update({
        where: { outlet_id_product_id_month_year: { outlet_id, product_id, month, year } },
        data: { min_stock: body.min_stock },
        include: { product: { select: { id: true, name: true, code: true } } },
    });
}
```

- [ ] **Step 6.6: Update `adjustQuantity` (currently line 150)**

```ts
static async adjustQuantity(
    outlet_id: number,
    product_id: number,
    delta: number,
    tx?: typeof prisma,
) {
    const client = tx ?? prisma;
    const { month, year } = OutletInventoryService.getPeriod();

    const latest = await client.outletInventory.findFirst({
        where: { outlet_id, product_id },
        orderBy: [{ year: "desc" }, { month: "desc" }],
    });
    if (!latest) throw new ApiError(404, "Stok produk tidak ditemukan di outlet ini");

    const qty_before = Number(latest.quantity);
    const qty_after = qty_before + delta;

    if (qty_after < 0)
        throw new ApiError(422, "Stok tidak mencukupi untuk melakukan pengurangan");

    const isCurrentPeriod = latest.month === month && latest.year === year;
    if (isCurrentPeriod) {
        await client.outletInventory.update({ where: { id: latest.id }, data: { quantity: qty_after } });
    } else {
        await client.outletInventory.create({
            data: { outlet_id, product_id, quantity: qty_after, month, year },
        });
    }

    return { qty_before, qty_after };
}
```

- [ ] **Step 6.7: Type-check**

Run:
```bash
rtk tsc --noEmit
```
Expected: this file clean. Remaining errors in monitoring readers and fg.service we tackle next.

- [ ] **Step 6.8: Commit**

```bash
rtk git add src/module/application/outlet/inventory/outlet-inventory.service.ts
rtk git commit -m "refactor(outlet-inventory): period-aware CRUD with carry-over"
```

---

## Task 7: Update Reader Services

**Files:**
- Modify: `src/module/application/inventory-v2/monitoring/stock-total/stock-total.service.ts`
- Modify: `src/module/application/inventory-v2/monitoring/stock-location/stock-location.service.ts`
- Modify: `src/module/application/product/stock-location/product.stock-location.service.ts`
- Modify: `src/module/application/inventory/fg/fg.service.ts`

For each reader: the goal is "show current outlet snapshot". Filter outlet rows by current `(month, year)`.

- [ ] **Step 7.1: stock-total.service.ts (raw SQL UNION leg)**

In `prisma.$queryRaw` (around line 100), find:
```sql
SELECT o.name AS loc_name, oi.quantity::numeric AS loc_qty
FROM outlet_inventories oi
JOIN outlets o ON oi.outlet_id = o.id
WHERE oi.product_id = p.id
  AND o.deleted_at IS NULL
```

Replace with:
```sql
SELECT o.name AS loc_name, oi.quantity::numeric AS loc_qty
FROM outlet_inventories oi
JOIN outlets o ON oi.outlet_id = o.id
WHERE oi.product_id = p.id
  AND oi.month = ${currentMonth}
  AND oi.year  = ${currentYear}
  AND o.deleted_at IS NULL
```

Same change for the `out_agg` subquery (around line 121):
```sql
LEFT JOIN (
    SELECT product_id, SUM(quantity)::numeric AS total_qty
    FROM outlet_inventories
    WHERE month = ${currentMonth} AND year = ${currentYear}
    GROUP BY product_id
) out_agg ON out_agg.product_id = p.id
```

- [ ] **Step 7.2: stock-location.service.ts**

Open file, locate every `prisma.outletInventory.findMany` / `findUnique` / `findFirst`. Add `month`/`year` from `InventoryHelper.getCurrentInventoryPeriod()` to the `where` clause. If the existing code uses Prisma ORM, replace `findUnique({ where: { outlet_id_product_id: ... } })` with `findFirst({ where: { outlet_id, product_id }, orderBy: [{ year: "desc" }, { month: "desc" }] })` so it returns the latest available period (even if not current — keeps the "show me what stock exists" semantic).

(Implementation detail: open the file fresh; the original spec author did not enumerate exact line numbers because this is a smaller surface; pattern is the same as `do.service.ts:415`.)

- [ ] **Step 7.3: product.stock-location.service.ts**

Apply the same transformation as Step 7.2.

- [ ] **Step 7.4: fg.service.ts outlet leg**

Open file, grep for `outletInventory`. For aggregation queries that sum outlet stock, add `month: currentMonth, year: currentYear` to the `where`. Use `InventoryHelper.getCurrentInventoryPeriod()`.

- [ ] **Step 7.5: Type-check**

```bash
rtk tsc --noEmit
```
Expected: all clean.

- [ ] **Step 7.6: Commit**

```bash
rtk git add src/module/application/inventory-v2/monitoring/ src/module/application/product/stock-location/ src/module/application/inventory/fg/
rtk git commit -m "refactor(readers): outlet stock readers filter by current month/year"
```

---

## Task 8: Update Test Setup Mock

**Files:**
- Modify: `src/tests/setup.ts` — both top-level `outletInventory` (around line 478) and `$transaction` form's `outletInventory` (around line 963)

- [ ] **Step 8.1: Update top-level `outletInventory` mock**

Find the existing block (line 478 onwards) and replace with:

```ts
outletInventory: {
    findUnique: vi.fn().mockImplementation(async (args) => {
        const key = args?.where?.outlet_id_product_id_month_year ?? args?.where?.outlet_id_product_id;
        if (!key) return null;
        if (key.product_id === 999 || key.outlet_id === 999) return null;
        return {
            id: 1,
            outlet_id: key.outlet_id,
            product_id: key.product_id,
            quantity: "10.00",
            min_stock: "5.00",
            month: key.month ?? new Date().getMonth() + 1,
            year: key.year ?? new Date().getFullYear(),
            updated_at: new Date(),
            product: { id: key.product_id, name: "T-Shirt", code: "TSHIRT" },
        };
    }),
    findFirst: vi.fn().mockImplementation(async (args) => {
        const w = args?.where;
        if (!w) return null;
        if (w.product_id === 999 || w.outlet_id === 999) return null;
        return {
            id: 1,
            outlet_id: w.outlet_id,
            product_id: w.product_id,
            quantity: "10.00",
            min_stock: "5.00",
            month: new Date().getMonth() + 1,
            year: new Date().getFullYear(),
            updated_at: new Date(),
            product: { id: w.product_id, name: "T-Shirt", code: "TSHIRT" },
        };
    }),
    findMany: vi.fn().mockResolvedValue([
        {
            id: 1,
            outlet_id: 1,
            product_id: 1,
            quantity: "10.00",
            min_stock: "5.00",
            month: new Date().getMonth() + 1,
            year: new Date().getFullYear(),
            updated_at: new Date(),
            product: { id: 1, name: "T-Shirt", code: "TSHIRT" },
        },
    ]),
    create: vi.fn().mockResolvedValue({ id: 1 }),
    createMany: vi.fn().mockResolvedValue({ count: 2 }),
    update: vi.fn().mockResolvedValue({
        id: 1,
        outlet_id: 1,
        product_id: 1,
        quantity: "10.00",
        min_stock: "20.00",
        month: new Date().getMonth() + 1,
        year: new Date().getFullYear(),
        updated_at: new Date(),
        product: { id: 1, name: "T-Shirt", code: "TSHIRT" },
    }),
    count: vi.fn().mockResolvedValue(1),
},
```

- [ ] **Step 8.2: Update `$transaction` form's `outletInventory`**

Find (around line 963):
```ts
outletInventory: {
    create: vi.fn().mockResolvedValue({ id: 1 }),
    update: vi.fn().mockResolvedValue({ id: 1 }),
},
```

Replace with:
```ts
outletInventory: {
    findUnique: vi.fn().mockResolvedValue(null),
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: 1, month: new Date().getMonth() + 1, year: new Date().getFullYear() }),
    createMany: vi.fn().mockResolvedValue({ count: 1 }),
    update: vi.fn().mockResolvedValue({ id: 1 }),
},
```

- [ ] **Step 8.3: Commit**

```bash
rtk git add src/tests/setup.ts
rtk git commit -m "test(setup): mock outletInventory with month/year + findFirst/findMany"
```

---

## Task 9: Update Existing Test Files

For each test file that asserts on outlet inventory shape: add `month` and `year` fields to mock returns and any `expect(...)` that checks the row shape directly.

- [ ] **Step 9.1: `src/tests/outlet/outlet-inventory.service.test.ts`**

Open the file. For `mockInventory` constant near top:

```ts
const mockInventory = {
    id: 1,
    outlet_id: 1,
    product_id: 1,
    quantity: "10.00",
    min_stock: "5.00",
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
    updated_at: new Date(),
    product: { id: 1, name: "T-Shirt", code: "TSHIRT" },
};
```

Then wherever a test uses `prisma.outletInventory.findUnique.mockResolvedValue(...)` for the `getStock` path: switch to `prisma.outletInventory.findFirst.mockResolvedValue(...)`. Same for `adjustQuantity` tests.

For tests that previously expected the OLD `outlet_id_product_id` where shape (e.g., `setMinStock`), update the assertion to expect `outlet_id_product_id_month_year`.

- [ ] **Step 9.2: `src/tests/outlet/outlet-inventory.routes.test.ts`**

Same treatment: any mocked findUnique/findMany returns should carry month/year. Run the file in isolation:

```bash
rtk vitest run src/tests/outlet/outlet-inventory.routes.test.ts
```
Fix any remaining failures.

- [ ] **Step 9.3: `src/tests/stock-transfer/stock-transfer.service.test.ts`**

The transfer service test seeds outletInventory rows. Add `month`/`year` to all outlet rows used. Also update assertions that check `update`/`create` calls: outlet `create` now passes `month, year`.

- [ ] **Step 9.4: `src/tests/inventory-v2/do/do.service.test.ts`**

Same treatment. The DO service now does `findFirst` (not `findUnique`) on outletInventory for stock lookup — update mock assertions accordingly.

- [ ] **Step 9.5: `src/tests/inventory-v2/return/return.service.test.ts`**

Same.

- [ ] **Step 9.6: `src/tests/product/product.routes.test.ts`**

Same.

- [ ] **Step 9.7: `src/tests/inventory/fg/fg.service.test.ts`**

Same — fg.service now filters outlet by current period; ensure mocks return rows for current period.

- [ ] **Step 9.8: Run full suite**

```bash
rtk vitest run
```
Expected: all green. If failures: fix in-file, do **not** mutate behavior.

- [ ] **Step 9.9: Commit**

```bash
rtk git add src/tests/
rtk git commit -m "test: update outlet-inventory mocks and assertions for month/year"
```

---

## Task 10: Add Period Rollover Test

**Files:**
- Create: `src/tests/outlet/outlet-inventory-period.test.ts`

- [ ] **Step 10.1: Write the new test file**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { InventoryHelper } from "../../module/application/shared/inventory.helper.js";
import { MovementRefType, MovementType } from "../../generated/prisma/client.js";

const NOW_MONTH = new Date().getMonth() + 1;
const NOW_YEAR  = new Date().getFullYear();

function buildTx(latest: { id: number; quantity: string; month: number; year: number } | null) {
    return {
        outletInventory: {
            findMany: vi.fn().mockResolvedValue(latest ? [latest] : []),
            update: vi.fn().mockResolvedValue({ id: latest?.id ?? 1 }),
            create: vi.fn().mockResolvedValue({ id: 99 }),
        },
        stockMovement: {
            create: vi.fn().mockResolvedValue({ id: 1 }),
        },
    } as any;
}

describe("InventoryHelper outlet period semantics", () => {
    beforeEach(() => vi.clearAllMocks());

    describe("getCurrentInventoryPeriod", () => {
        it("returns current month and year from system clock", () => {
            const { month, year } = InventoryHelper.getCurrentInventoryPeriod();
            expect(month).toBe(NOW_MONTH);
            expect(year).toBe(NOW_YEAR);
        });
    });

    describe("deductOutletStock", () => {
        it("updates existing row when current-period row exists", async () => {
            const tx = buildTx({ id: 5, quantity: "10.00", month: NOW_MONTH, year: NOW_YEAR });

            await InventoryHelper.deductOutletStock(
                tx, 1,
                [{ product_id: 1, quantity: 3, product: { name: "X" } }],
                100, MovementRefType.POS_TRANSACTION, MovementType.SALE_OUT, "user-1",
            );

            expect(tx.outletInventory.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { quantity: 7 } });
            expect(tx.outletInventory.create).not.toHaveBeenCalled();
        });

        it("creates a new current-period row carrying balance forward when latest is older period", async () => {
            const tx = buildTx({ id: 3, quantity: "10.00", month: NOW_MONTH === 1 ? 12 : NOW_MONTH - 1, year: NOW_MONTH === 1 ? NOW_YEAR - 1 : NOW_YEAR });

            await InventoryHelper.deductOutletStock(
                tx, 1,
                [{ product_id: 1, quantity: 3, product: { name: "X" } }],
                100, MovementRefType.POS_TRANSACTION, MovementType.SALE_OUT, "user-1",
            );

            expect(tx.outletInventory.create).toHaveBeenCalledWith({
                data: { outlet_id: 1, product_id: 1, quantity: 7, month: NOW_MONTH, year: NOW_YEAR },
            });
            expect(tx.outletInventory.update).not.toHaveBeenCalled();
        });

        it("throws when prior balance is insufficient", async () => {
            const tx = buildTx({ id: 1, quantity: "2.00", month: NOW_MONTH, year: NOW_YEAR });

            await expect(
                InventoryHelper.deductOutletStock(
                    tx, 1,
                    [{ product_id: 1, quantity: 5, product: { name: "X" } }],
                    100, MovementRefType.POS_TRANSACTION, MovementType.SALE_OUT, "user-1",
                ),
            ).rejects.toThrow("Stok tidak mencukupi di Outlet");
        });

        it("throws when no prior row exists (cold start) and deduction requested", async () => {
            const tx = buildTx(null);

            await expect(
                InventoryHelper.deductOutletStock(
                    tx, 1,
                    [{ product_id: 1, quantity: 1, product: { name: "X" } }],
                    100, MovementRefType.POS_TRANSACTION, MovementType.SALE_OUT, "user-1",
                ),
            ).rejects.toThrow("Stok tidak mencukupi di Outlet");
        });
    });

    describe("addOutletStock", () => {
        it("creates current-period row on cold start", async () => {
            const tx = buildTx(null);

            await InventoryHelper.addOutletStock(
                tx, 1,
                [{ product_id: 1, quantity: 5, product: { name: "X" } }],
                100, MovementRefType.GOODS_RECEIPT, MovementType.PURCHASE_IN, "user-1",
            );

            expect(tx.outletInventory.create).toHaveBeenCalledWith({
                data: { outlet_id: 1, product_id: 1, quantity: 5, month: NOW_MONTH, year: NOW_YEAR },
            });
        });

        it("carries balance forward when latest row is older period", async () => {
            const tx = buildTx({ id: 7, quantity: "12.00", month: NOW_MONTH === 1 ? 12 : NOW_MONTH - 1, year: NOW_MONTH === 1 ? NOW_YEAR - 1 : NOW_YEAR });

            await InventoryHelper.addOutletStock(
                tx, 1,
                [{ product_id: 1, quantity: 3, product: { name: "X" } }],
                100, MovementRefType.GOODS_RECEIPT, MovementType.PURCHASE_IN, "user-1",
            );

            expect(tx.outletInventory.create).toHaveBeenCalledWith({
                data: { outlet_id: 1, product_id: 1, quantity: 15, month: NOW_MONTH, year: NOW_YEAR },
            });
        });

        it("updates existing current-period row", async () => {
            const tx = buildTx({ id: 9, quantity: "8.00", month: NOW_MONTH, year: NOW_YEAR });

            await InventoryHelper.addOutletStock(
                tx, 1,
                [{ product_id: 1, quantity: 2, product: { name: "X" } }],
                100, MovementRefType.GOODS_RECEIPT, MovementType.PURCHASE_IN, "user-1",
            );

            expect(tx.outletInventory.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { quantity: 10 } });
        });
    });
});
```

- [ ] **Step 10.2: Run the new test**

```bash
rtk vitest run src/tests/outlet/outlet-inventory-period.test.ts
```
Expected: all tests pass.

- [ ] **Step 10.3: Verify `MovementRefType.POS_TRANSACTION` and `MovementType.SALE_OUT` exist**

If the test imports fail, run:
```bash
rtk grep -n "POS_TRANSACTION\|SALE_OUT\|GOODS_RECEIPT\|PURCHASE_IN" prisma/schema.prisma
```
Substitute any missing enum values with the closest valid ones (the specific value used in tests does not matter — only that it type-checks).

- [ ] **Step 10.4: Commit**

```bash
rtk git add src/tests/outlet/outlet-inventory-period.test.ts
rtk git commit -m "test(outlet): period rollover and carry-over semantics"
```

---

## Task 11: Full Suite + Type Check

- [ ] **Step 11.1: Full type check**

```bash
rtk tsc --noEmit
```
Expected: no errors.

- [ ] **Step 11.2: Full vitest run**

```bash
rtk vitest run
```
Expected: every existing test still passes, plus the new period rollover suite.

- [ ] **Step 11.3: If anything fails**

Diagnose root cause — do not skip or mock around failures. Fix the underlying code or test seed. Re-run.

- [ ] **Step 11.4: Final commit (if any tweaks were needed)**

```bash
rtk git add -A
rtk git status
# If clean, skip commit.
# Otherwise:
rtk git commit -m "fix: post-migration test tweaks"
```

---

## Self-Review Checklist (performed during planning)

- ✅ Spec section 3 (schema change) → Task 1
- ✅ Spec section 4 (period write semantics) → Tasks 2, 3, 4, 6
- ✅ Spec section 5 (reader semantics) → Tasks 5, 7
- ✅ Spec section 6.1 writers → Tasks 3, 4, 6
- ✅ Spec section 6.2 readers → Tasks 5, 7
- ✅ Spec section 6.3 tests → Tasks 8, 9, 10
- ✅ Spec section 7 migration step order → Task 1 sub-steps + subsequent tasks in order
- ✅ Spec section 9 risk mitigations → carry-over via shared helper (Task 2), test seed via setup.ts (Task 8), `@@unique` enforced (Task 1)

No spec requirement is left without a task.
