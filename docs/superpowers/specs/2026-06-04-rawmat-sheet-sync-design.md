# Raw Material → Google Sheets Sync (Design Spec)

**Status:** Approved for plan
**Date:** 2026-06-04
**Author:** Engineering (ERP Mandalika)
**Related:** [2026-06-03 Product (FG) Sheet Sync](./2026-06-03-product-sheet-sync-design.md)

---

## 1. Goal & Non-Goals

### Goal

Mirror master Raw Material data from the ERP database into a Google
Spreadsheet tab in **one direction (ERP → Sheet)**, immediately after
every CRUD operation, with self-healing upsert, in-place barcode change,
exponential-backoff retry, a persisted failure table, and a per-row UI
badge for status + manual re-sync.

The pattern is intentionally identical to the existing FG (Product)
sheet sync so the operational and mental model carries over.

### Non-Goals

- **No Sheet → ERP.** Edits performed manually in the spreadsheet are
  not pulled back into the ERP. The sheet is a downstream consumer.
- **No multi-tab fan-out.** This sync writes to one tab in one
  spreadsheet. Reports/dashboards that read from this sheet are out of
  scope.
- **No bulk multi-select** action in the RM list (we already removed it
  on FG to avoid job storms).
- **No sync of soft-deleted RMs that get updated.** If `deleted_at` is
  set, further `update()` calls do **not** enqueue. Restore (clearing
  `deleted_at`) re-enqueues as `upsert`.

---

## 2. Sheet Layout

**Spreadsheet ID:** `1jT9fGCKUDOyNimdLrQ66Y1OKg6d9AUxdJCHQOUyDPZI`
**Tab name:** TBD on first deploy (env: `GOOGLE_RM_TAB_NAME`,
default candidate `MANDALIKA` mirroring FG; can be overridden).

| Col | Header           | Source                                   | Null handling          |
|-----|------------------|------------------------------------------|------------------------|
| A   | _(reserved)_     | **never written, never read by sync**    | left untouched         |
| B   | `BARCODE`        | `RawMaterial.barcode`                    | sync precondition (skip RM if null) |
| C   | `CATEGORY`       | `raw_mat_category.name`                  | `""`                   |
| D   | `MATERIAL NAME`  | `RawMaterial.name`                       | required               |
| E   | `UOM`            | `unit_raw_material.name`                 | required relation      |
| F   | `SUPPLIER`       | preferred supplier `.supplier.name`      | `""`                   |
| G   | `PRICE`          | preferred `SupplierMaterial.unit_price`  | `""`                   |
| H   | `MOQ`            | preferred `SupplierMaterial.min_buy`     | `""`                   |
| I   | `LEAD TIME`      | preferred `SupplierMaterial.lead_time`   | `""`                   |
| J   | `MIN STOCK`      | `RawMaterial.min_stock`                  | `"0"`                  |
| K   | `LOCAL/IMPORT`   | `RawMaterial.source` enum                | `""`                   |

**Column A** is treated the same as the FG UID column: reserved for an
external linked-sheet workflow. The sync **never** reads, writes, or
clears column A. The only way column A loses a value is when an entire
row is deleted (because the underlying RM was hard- or soft-deleted).

### Preferred Supplier Resolution (cols F–I)

When fetching the RM for sync, eagerly include `supplier_materials`
with relation `supplier`. Pick the supplier row using this precedence:

1. `is_preferred = true AND status = "ACTIVE"` → use it
2. Otherwise the lowest-`id` row with `status = "ACTIVE"` → use it
3. Otherwise all four cells (`SUPPLIER`, `PRICE`, `MOQ`, `LEAD TIME`) are `""`

This deterministic order is important: the same RM must always produce
the same row content, otherwise idempotent reruns will write differing
data and create churn diffs in the sheet history.

### Identifier

`BARCODE` (column B) is the row-identity key. `RawMaterial.barcode` is
nullable in the schema, so:

- **Precondition at trigger time:** if `barcode` is `null`, do not
  enqueue any job (saves worker cycles, avoids `findRowByCode("")`
  matching empty cells).
- **Inside the worker:** treat `null` barcode as a fatal job error so a
  developer notices if the precondition ever leaks (defense-in-depth).

---

## 3. Triggers

The service layer at `rawmat.service.ts` is the only place that emits
sync jobs. All call sites are pre-fetch the prior row when needed for
`oldBarcode` lookup.

| Action                                    | Enqueue                                            | Notes |
|-------------------------------------------|----------------------------------------------------|-------|
| `create(payload)`                         | `{ action: "upsert", rawMaterialId }`              | Only if `payload.barcode` truthy |
| `update(id, payload)` — barcode unchanged | `{ action: "upsert", rawMaterialId }`              | Only if barcode truthy |
| `update(id, payload)` — barcode changed   | `{ action: "upsert", rawMaterialId, oldBarcode }`  | Worker locates row via `oldBarcode` first, falls back to new barcode |
| `softDelete(id)`                          | `{ action: "delete", rawMaterialId, barcode }`     | Only if the RM had a barcode |
| `restore(id)` (clear `deleted_at`)        | `{ action: "upsert", rawMaterialId }`              | Worker self-heals: row almost certainly missing → appendRow |
| `update(id, ...)` on RM where `deleted_at` set | **no enqueue**                                | Updates to deleted records do not propagate |
| Resync endpoint                           | `delete` if `deleted_at`, else `upsert`            | Same dispatcher logic as FG |

### Worker Behavior (`rawmat-sheet.worker.ts`)

Reuses the existing `bullConnection` config (host/port/password/db +
`maxRetriesPerRequest: null`). Lives in the same `worker.ts` PM2
process as the FG worker — register via a single import line.

- `attempts: 3`, `backoff: { type: "exponential", delay: 5000 }`,
  `removeOnComplete: { age: 86400, count: 1000 }`,
  `removeOnFail: { age: 7 * 86400, count: 5000 }`
- On `failed` (after retries exhausted): upsert a row into
  `RawMaterialSheetSyncFailure` keyed by `(raw_material_id, action)`,
  set `error_message`, increment `attempt_count`, stamp
  `last_attempted_at`.
- On `completed`: mark any unresolved
  `RawMaterialSheetSyncFailure` rows for that `raw_material_id`
  as resolved (`resolved_at = now()`).

---

## 4. Service Logic (`rawmat-sheet.service.ts`)

Stateless static class mirroring `ProductSheetSyncService`:

```ts
const EXPECTED_HEADERS = [
    "BARCODE", "CATEGORY", "MATERIAL NAME", "UOM",
    "SUPPLIER", "PRICE", "MOQ", "LEAD TIME",
    "MIN STOCK", "LOCAL/IMPORT",
] as const;
const HEADER_RANGE = "B1:K1";
const CODE_COLUMN_RANGE = "B2:B";
const APPEND_ANCHOR_RANGE = "B:B";
const rowDataRange = (n: number) => `B${n}:K${n}`;
```

Method `static async handle(job: RawMatSheetSyncJob): Promise<void>`:

1. Short-circuit if `env.RAWMAT_SHEET_SYNC_ENABLED === false`.
2. `readHeader(sheetId, tab, HEADER_RANGE)` — if mismatch with
   `EXPECTED_HEADERS`, throw a descriptive error (`Expected: ... Got: ...`).
   This guards against a user reordering or renaming columns by hand.
3. Branch on `job.action`:
   - **`upsert`**: load RM with includes (`unit_raw_material`,
     `raw_mat_category`, `supplier_materials` ordered for preferred
     resolution).
     - Throw if RM not found in DB.
     - `primarySearchCode = job.oldBarcode ?? rm.barcode`. Throw if
       both are empty (precondition leaked).
     - `rowIndex = findRowByCode(... primarySearchCode)`.
     - If `null && job.oldBarcode`: retry `findRowByCode(...
       rm.barcode)` as fallback.
     - If still `null`: `appendRow(..., APPEND_ANCHOR_RANGE, values)`.
     - Else: `updateRow(..., rowDataRange(rowIndex), values)`.
   - **`delete`**: `findRowByCode(..., CODE_COLUMN_RANGE, job.barcode)`.
     If `null`, no-op. Else `deleteRow(..., rowIndex)`.

The Google Sheets client (`api/src/lib/google-sheets.ts`) is reused
**unchanged** — it already takes A1-notation range strings and is
sheet-agnostic.

---

## 5. Mapper (`rawmat-sheet.mapper.ts`)

```ts
export type RawMatWithSheetRelations = RawMaterial & {
    raw_mat_category: { name: string } | null;
    unit_raw_material: { name: string };
    supplier_materials: Array<{
        is_preferred: boolean;
        status: string;
        unit_price: Decimal;
        min_buy: Decimal | null;
        lead_time: number | null;
        supplier: { name: string };
        id: number;
    }>;
};

export function rawMatToRow(rm: RawMatWithSheetRelations): string[] {
    const pref = pickPreferredSupplier(rm.supplier_materials);
    return [
        rm.barcode ?? "",                                  // B
        rm.raw_mat_category?.name ?? "",                   // C
        rm.name,                                           // D
        rm.unit_raw_material.name,                         // E
        pref?.supplier.name ?? "",                         // F
        pref ? String(pref.unit_price) : "",               // G
        pref?.min_buy != null ? String(pref.min_buy) : "", // H
        pref?.lead_time != null ? String(pref.lead_time) : "", // I
        rm.min_stock != null ? String(rm.min_stock) : "0", // J
        rm.source ?? "",                                   // K
    ];
}
```

`pickPreferredSupplier` is unit-tested in isolation:
1. First `s.is_preferred && s.status === "ACTIVE"`.
2. Else first `s.status === "ACTIVE"` sorted by `id` asc.
3. Else `undefined`.

> **Decimal convention reminder:** percentages on FG sync pass through
> the raw Decimal value (`String(decimal)`). PRICE / MOQ / LEAD TIME
> here are not percentages — they are absolute amounts — so no `× 100`
> conversion. After first sync, verify the formatting matches what the
> sheet's downstream consumers expect (especially for thousand
> separators and locale).

---

## 6. Persistence Schema

### New Prisma model

```prisma
model RawMaterialSheetSyncFailure {
  id                Int          @id @default(autoincrement())
  raw_material_id   Int
  action            String       @db.VarChar(16)  // "upsert" | "delete"
  error_message     String       @db.Text
  attempt_count     Int          @default(1)
  last_attempted_at DateTime     @default(now())
  resolved_at       DateTime?
  created_at        DateTime     @default(now())
  raw_material      RawMaterial  @relation(fields: [raw_material_id], references: [id], onDelete: Cascade)

  @@index([raw_material_id, resolved_at])
  @@index([resolved_at])
  @@map("raw_material_sheet_sync_failures")
}
```

Back-relation on `RawMaterial`:

```prisma
sheet_sync_failures RawMaterialSheetSyncFailure[]
```

Migration is applied directly via `psql` because
`prisma/migrations/` is gitignored on this project (same pattern as the
FG migration).

### Response DTO additions

```ts
sheet_sync_status: z.enum(["synced", "failed"]).optional(),
sheet_sync_error: z.string().optional(),
```

The list query derives these per row by batch-loading unresolved
failures for the page's `raw_material_id`s and zipping in. Default for
RM with no failure row is `"synced"`.

---

## 7. Environment

`api/.env` additions:

```
GOOGLE_RM_SHEET_ID=1jT9fGCKUDOyNimdLrQ66Y1OKg6d9AUxdJCHQOUyDPZI
GOOGLE_RM_TAB_NAME=MANDALIKA          # confirm before first deploy
RAWMAT_SHEET_SYNC_ENABLED=true
```

`api/src/config/env.ts` additions:

```ts
GOOGLE_RM_SHEET_ID: str(),
GOOGLE_RM_TAB_NAME: str({ default: "MANDALIKA" }),
RAWMAT_SHEET_SYNC_ENABLED: bool({ default: false }),
```

Reusing existing:
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`
- `bullConnection` from `api/src/config/queue.ts`
- `redisClient` shared instance for non-Bull operations

`api/src/config/queue.ts` addition:

```ts
export const RAWMAT_SHEET_QUEUE_NAME =
    env.NODE_ENV === "test" ? "test-rawmat-sheet-sync" : "rawmat-sheet-sync";
```

> ⚠️ **Security:** The current service account key was pasted into
> chat twice. The plan must start with the user rotating it in GCP IAM
> → Service Accounts → revoke → create new → replace in `.env`.
> Implementation cannot be marked done while a known-leaked key is in
> production.

---

## 8. Frontend

Mirror the per-row badge already shipped for FG:

### Hooks (`app/src/app/(application)/rawmats/server/use.rawmats.ts`)

Add `resync` to whichever existing action-hook handles status/delete:

```ts
const resync = useMutation<unknown, ResponseError, number>({
    mutationKey: ["rawmat", "resync"],
    mutationFn: (id) => RawMatService.resync(id),
    onSuccess: () => {
        setNotif({ title: "Sync Ulang", message: "Sync ulang ke Spreadsheet dijadwalkan" });
        queryClient.invalidateQueries({ queryKey: ["rawmats"], type: "all" });
    },
    onError: (err) => FetchError(err, setErr),
});
```

### Column + per-row loader (mirror `pages/products/table/columns.tsx`)

Add a `SHEET` column with three states: `synced` (emerald) /
`failed` (rose, clickable) / `syncing` (amber + `Loader2` spin).
Parent page owns `syncingIds: Set<number>` and clears the ID 2.5s after
`mutate` resolves so the worker has time to finish, then invalidates
the list query.

### Bulk multi-select on RM

**In scope, same PR.** If the RM list currently has bulk multi-select
(bulk soft-delete / restore), remove it as part of this work — same
reasoning as FG: prevents one user action from enqueuing hundreds of
sync jobs that hit Google Sheet API rate limits (300 writes/min/user)
and starve normal per-row syncs.

The plan task will: (1) audit the RM list page for bulk action JSX,
(2) remove selection state + bulk action handlers, (3) keep per-row
edit/delete buttons intact.

---

## 9. Testing

Three new test files mirror FG coverage. All use Vitest with
`vi.hoisted` for shared mocks per existing project convention.

### `tests/rawmat/rawmat-sheet.mapper.test.ts` (~5 tests)

- Returns 10 cells in B–K order with all fields populated.
- Substitutes `""` for null `raw_mat_category` and `source`.
- Substitutes `"0"` for null `min_stock`.
- Picks `is_preferred=true && ACTIVE` supplier when multiple suppliers.
- Picks lowest-id ACTIVE supplier when no preferred flag set.
- Returns `""` for cols F–I when no ACTIVE supplier exists.

### `tests/rawmat/rawmat-sheet.service.test.ts` (~9 tests)

Identical to FG service tests, adapted:
- `upsert` calls `updateRow` when row exists.
- `upsert` calls `appendRow` when row missing (self-heal).
- `upsert` uses `oldBarcode` for lookup when barcode changed.
- `upsert` falls back to new barcode when `oldBarcode` lookup misses.
- `upsert` throws when RM not in DB.
- `upsert` throws on header mismatch.
- `delete` calls `deleteRow` when row found.
- `delete` is no-op when row missing.
- `handle` short-circuits when `RAWMAT_SHEET_SYNC_ENABLED=false`.

### `tests/lib/google-sheets.test.ts`

No changes — the client is already generic, current 8 tests cover the
behavior the RM service relies on.

### Coverage target

Match FG: 21 → ~35 sheet-related tests passing, tsc clean.

---

## 10. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Leaked service-account key | Rotate before deploy (gating step 1) |
| Tab name mismatch (`MANDALIKA` assumed) | Hard-fail at `readHeader` step with descriptive error → user updates `.env` |
| Header reorder by hand in sheet | Same fail-fast mechanism; documented in 4-line ops note in module README |
| RM with null `barcode` flooding queue | Service-layer precondition blocks enqueue entirely |
| Two preferred suppliers (data anomaly) | Deterministic tiebreak by lowest `id` |
| Decimal locale (`,` vs `.`) | `String(decimal)` produces canonical `.` form; documented |
| Sheet API rate limit (300 writes/min/user) | BullMQ default concurrency `1` per worker — single sequential writer. No bulk action shipped. |
| Worker crash leaving partial state | `findRowByCode` is idempotent; retry will converge |
| Restore of an RM whose old row was modified manually in sheet | Self-heal appendRow creates a new row; old manually-edited row remains as orphan. Documented as known behavior. |

---

## 11. Out of scope

- Sheet → ERP direction (covered later, separate spec)
- RM forecast/inventory data sync (only master data)
- Per-warehouse RM rows (sheet is master, not stock)
- Bulk re-sync action ("sync all 1000 RMs at once") — explicitly
  rejected to protect API quota
- RM image / file attachment fields
