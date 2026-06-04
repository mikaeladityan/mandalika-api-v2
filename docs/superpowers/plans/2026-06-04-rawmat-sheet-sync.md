# Raw Material → Google Sheets Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror Raw Material master data from the ERP to a Google Spreadsheet tab in one direction (ERP → Sheet) on every CRUD, mirroring the FG sheet sync pattern.

**Architecture:** BullMQ `rawmat-sheet-sync` queue with a worker that calls a stateless `RawMatSheetSyncService`. The service reads the sheet header for validation, finds rows by `BARCODE` (column B), and writes only to columns B–K (column A stays untouched). Failures are persisted to `RawMaterialSheetSyncFailure` after retries are exhausted. Frontend gets a per-row badge with three states (synced/failed/syncing) and a manual resync button.

**Tech Stack:** Hono, Prisma 6.19.2, BullMQ + ioredis, `@googleapis/sheets` v9 + `google-auth-library` v9, Vitest with `vi.hoisted` mocks, Next.js App Router + TanStack Query (frontend).

**Spec reference:** `docs/superpowers/specs/2026-06-04-rawmat-sheet-sync-design.md`

---

## Phase 0 — Pre-flight (manual, gating)

### Task 0.1: Rotate leaked service-account key

The service-account key for `hono-sheets-api@mandalika-parfumery.iam.gserviceaccount.com` was pasted in chat twice. Rotate before doing anything else.

- [ ] **Step 1:** GCP Console → IAM & Admin → Service Accounts → `hono-sheets-api@mandalika-parfumery.iam.gserviceaccount.com` → Keys → disable + delete the old key.
- [ ] **Step 2:** Create a new JSON key, download it.
- [ ] **Step 3:** Update `api/.env` on the VM with the new `GOOGLE_PRIVATE_KEY`. Restart `pm2 restart api-erp erp-worker`.
- [ ] **Step 4:** Manually create a single product (FG) in the UI and confirm a row appears in the FG sheet — this confirms the new key works before we layer RM on top.

---

## Phase 1 — Foundation: schema, env, queue name

### Task 1.1: Add Prisma model for sync failures

**Files:**
- Modify: `api/prisma/schema.prisma`

- [ ] **Step 1: Add the `RawMaterialSheetSyncFailure` model** at the end of the schema (after `ProductSheetSyncFailure` if present, otherwise just before `model TimestampedEntity` or any closing position — group related models together).

```prisma
model RawMaterialSheetSyncFailure {
  id                Int          @id @default(autoincrement())
  raw_material_id   Int
  action            String       @db.VarChar(16)
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

- [ ] **Step 2: Add back-relation on `RawMaterial`** at line ~252 (in the existing relations block):

```prisma
sheet_sync_failures               RawMaterialSheetSyncFailure[]
```

- [ ] **Step 3: Regenerate Prisma client**

Run: `cd api && npx prisma generate`
Expected: `✔ Generated Prisma Client (...)`. No errors.

- [ ] **Step 4: Apply migration to the DB** (use `psql` directly because `prisma/migrations/` is gitignored on this project):

```bash
psql "$DATABASE_URL" <<'SQL'
CREATE TABLE IF NOT EXISTS raw_material_sheet_sync_failures (
    id                  SERIAL PRIMARY KEY,
    raw_material_id     INTEGER NOT NULL REFERENCES raw_materials(id) ON DELETE CASCADE,
    action              VARCHAR(16) NOT NULL,
    error_message       TEXT NOT NULL,
    attempt_count       INTEGER NOT NULL DEFAULT 1,
    last_attempted_at   TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    resolved_at         TIMESTAMP(3),
    created_at          TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS raw_material_sheet_sync_failures_raw_material_id_resolved_at_idx
    ON raw_material_sheet_sync_failures(raw_material_id, resolved_at);
CREATE INDEX IF NOT EXISTS raw_material_sheet_sync_failures_resolved_at_idx
    ON raw_material_sheet_sync_failures(resolved_at);
SQL
```

Verify: `psql "$DATABASE_URL" -c "\d raw_material_sheet_sync_failures"` shows the table.

- [ ] **Step 5: Commit**

```bash
cd api
rtk git add prisma/schema.prisma
rtk git commit -m "feat(rawmat/sheet): add RawMaterialSheetSyncFailure model

Mirrors ProductSheetSyncFailure for the upcoming RM sheet sync worker.
Migration applied directly via psql since prisma/migrations is gitignored.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.2: Add env vars and queue name constant

**Files:**
- Modify: `api/.env`
- Modify: `api/src/config/env.ts`
- Modify: `api/src/config/queue.ts`
- Modify: `api/src/tests/setup.ts` (mocked env block)

- [ ] **Step 1: Append RM sheet env to `api/.env`**

```
# Google Sheets — Raw Material
GOOGLE_RM_SHEET_ID=1jT9fGCKUDOyNimdLrQ66Y1OKg6d9AUxdJCHQOUyDPZI
GOOGLE_RM_TAB_NAME=MANDALIKA
RAWMAT_SHEET_SYNC_ENABLED=true
```

> Note: `GOOGLE_RM_TAB_NAME` is the tab to write to. If your RM spreadsheet uses a different tab name (e.g. `Sheet1`, `Raw Material`), change it. The worker will hard-fail at `readHeader` if the tab name does not exist or the header does not match.

- [ ] **Step 2: Add to `api/src/config/env.ts` envalid schema**

Find the existing FG block (`GOOGLE_FG_SHEET_ID`, `GOOGLE_FG_TAB_NAME`, `PRODUCT_SHEET_SYNC_ENABLED`) and add directly below:

```ts
GOOGLE_RM_SHEET_ID: str(),
GOOGLE_RM_TAB_NAME: str({ default: "MANDALIKA" }),
RAWMAT_SHEET_SYNC_ENABLED: bool({ default: false }),
```

- [ ] **Step 3: Add queue name constant to `api/src/config/queue.ts`**

Find the existing `PRODUCT_SHEET_QUEUE_NAME` declaration and add directly below:

```ts
export const RAWMAT_SHEET_QUEUE_NAME =
    env.NODE_ENV === "test" ? "test-rawmat-sheet-sync" : "rawmat-sheet-sync";
```

- [ ] **Step 4: Update test mock env in `api/src/tests/setup.ts`**

Find the block that mocks env (around line 28-39 — has `GOOGLE_FG_SHEET_ID`, `PRODUCT_SHEET_SYNC_ENABLED`). Add three lines so the mocked env exposes the RM vars too:

```ts
GOOGLE_RM_SHEET_ID: "rm-sheet-id",
GOOGLE_RM_TAB_NAME: "MANDALIKA",
RAWMAT_SHEET_SYNC_ENABLED: false,
```

- [ ] **Step 5: Add Prisma mock for the new model in `api/src/tests/setup.ts`**

Find the `productSheetSyncFailure: { findMany, create, updateMany }` block (around line 766-770) and add a sibling block below:

```ts
rawMaterialSheetSyncFailure: {
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
},
```

- [ ] **Step 6: Verify type-check passes**

Run: `cd api && rtk npx tsc --noEmit`
Expected: `No errors found`.

- [ ] **Step 7: Commit**

```bash
cd api
rtk git add .env src/config/env.ts src/config/queue.ts src/tests/setup.ts
rtk git commit -m "feat(rawmat/sheet): wire env + queue name + test mocks

GOOGLE_RM_SHEET_ID, GOOGLE_RM_TAB_NAME, RAWMAT_SHEET_SYNC_ENABLED flag,
new BullMQ queue name, and Prisma mock for the failure table.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2 — Sheet pipeline files (TDD where useful)

### Task 2.1: Job schema (discriminated union)

**Files:**
- Create: `api/src/module/application/rawmat/sheet/rawmat-sheet.schema.ts`

- [ ] **Step 1: Create the file**

```ts
import { z } from "zod";

export const RawMatSheetSyncJobSchema = z.discriminatedUnion("action", [
    z.object({
        action: z.literal("upsert"),
        rawMaterialId: z.number().int().positive(),
        oldBarcode: z.string().optional(),
    }),
    z.object({
        action: z.literal("delete"),
        rawMaterialId: z.number().int().positive(),
        barcode: z.string().min(1),
    }),
]);

export type RawMatSheetSyncJob = z.infer<typeof RawMatSheetSyncJobSchema>;
```

- [ ] **Step 2: Verify type-check**

Run: `cd api && rtk npx tsc --noEmit`
Expected: `No errors found`.

- [ ] **Step 3: Commit**

```bash
cd api
rtk git add src/module/application/rawmat/sheet/rawmat-sheet.schema.ts
rtk git commit -m "feat(rawmat/sheet): add job schema (upsert | delete discriminated union)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.2: Mapper — TDD

**Files:**
- Create: `api/src/tests/rawmat/rawmat-sheet.mapper.test.ts`
- Create: `api/src/module/application/rawmat/sheet/rawmat-sheet.mapper.ts`

- [ ] **Step 1: Write failing tests**

Create `api/src/tests/rawmat/rawmat-sheet.mapper.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { rawMatToRow, pickPreferredSupplier } from "../../module/application/rawmat/sheet/rawmat-sheet.mapper.js";

describe("pickPreferredSupplier", () => {
    it("returns the is_preferred ACTIVE supplier first", () => {
        const result = pickPreferredSupplier([
            { id: 1, is_preferred: false, status: "ACTIVE", supplier: { name: "A" }, unit_price: 10, min_buy: null, lead_time: null } as never,
            { id: 2, is_preferred: true,  status: "ACTIVE", supplier: { name: "B" }, unit_price: 20, min_buy: null, lead_time: null } as never,
            { id: 3, is_preferred: true,  status: "BLOCK",  supplier: { name: "C" }, unit_price: 30, min_buy: null, lead_time: null } as never,
        ]);
        expect(result?.supplier.name).toBe("B");
    });

    it("falls back to lowest-id ACTIVE when no preferred", () => {
        const result = pickPreferredSupplier([
            { id: 7, is_preferred: false, status: "ACTIVE", supplier: { name: "A" }, unit_price: 10, min_buy: null, lead_time: null } as never,
            { id: 3, is_preferred: false, status: "ACTIVE", supplier: { name: "B" }, unit_price: 20, min_buy: null, lead_time: null } as never,
            { id: 5, is_preferred: false, status: "BLOCK",  supplier: { name: "C" }, unit_price: 30, min_buy: null, lead_time: null } as never,
        ]);
        expect(result?.supplier.name).toBe("B");
    });

    it("returns undefined when no ACTIVE supplier", () => {
        const result = pickPreferredSupplier([
            { id: 1, is_preferred: true, status: "BLOCK", supplier: { name: "X" }, unit_price: 10, min_buy: null, lead_time: null } as never,
        ]);
        expect(result).toBeUndefined();
    });

    it("returns undefined for empty list", () => {
        expect(pickPreferredSupplier([])).toBeUndefined();
    });
});

describe("rawMatToRow", () => {
    const baseRm = {
        id: 1,
        barcode: "RM-001",
        name: "GLYCERIN USP",
        min_stock: 25,
        source: "LOCAL" as const,
        raw_mat_category: { name: "BASE" },
        unit_raw_material: { name: "KG" },
        supplier_materials: [
            { id: 1, is_preferred: true, status: "ACTIVE", supplier: { name: "PT MAJU" }, unit_price: 12500, min_buy: 50, lead_time: 7 },
        ],
    };

    it("returns 10 cells in B-K order with all fields populated", () => {
        const row = rawMatToRow(baseRm as never);
        expect(row).toEqual([
            "RM-001",     // B BARCODE
            "BASE",       // C CATEGORY
            "GLYCERIN USP", // D NAME
            "KG",         // E UOM
            "PT MAJU",    // F SUPPLIER
            "12500",      // G PRICE
            "50",         // H MOQ
            "7",          // I LEAD TIME
            "25",         // J MIN STOCK
            "LOCAL",      // K LOCAL/IMPORT
        ]);
        expect(row).toHaveLength(10);
    });

    it("substitutes empty strings for null category and source", () => {
        const row = rawMatToRow({ ...baseRm, raw_mat_category: null, source: null } as never);
        expect(row[1]).toBe(""); // C
        expect(row[9]).toBe(""); // K
    });

    it("substitutes '0' for null min_stock", () => {
        const row = rawMatToRow({ ...baseRm, min_stock: null } as never);
        expect(row[8]).toBe("0"); // J
    });

    it("leaves supplier columns blank when no ACTIVE supplier", () => {
        const row = rawMatToRow({ ...baseRm, supplier_materials: [] } as never);
        expect(row[4]).toBe(""); // F SUPPLIER
        expect(row[5]).toBe(""); // G PRICE
        expect(row[6]).toBe(""); // H MOQ
        expect(row[7]).toBe(""); // I LEAD TIME
    });

    it("emits '' for null min_buy / lead_time on preferred supplier", () => {
        const row = rawMatToRow({
            ...baseRm,
            supplier_materials: [
                { id: 1, is_preferred: true, status: "ACTIVE", supplier: { name: "PT X" }, unit_price: 100, min_buy: null, lead_time: null },
            ],
        } as never);
        expect(row[5]).toBe("100"); // G PRICE
        expect(row[6]).toBe("");    // H MOQ null
        expect(row[7]).toBe("");    // I LEAD TIME null
    });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `cd api && rtk npx vitest run src/tests/rawmat/rawmat-sheet.mapper.test.ts`
Expected: `Cannot find module '../../module/application/rawmat/sheet/rawmat-sheet.mapper.js'`.

- [ ] **Step 3: Implement mapper**

Create `api/src/module/application/rawmat/sheet/rawmat-sheet.mapper.ts`:

```ts
import { Prisma } from "../../../../generated/prisma/client.js";

export type RawMatWithSheetRelations = Prisma.RawMaterialGetPayload<{
    include: {
        raw_mat_category: { select: { name: true } };
        unit_raw_material: { select: { name: true } };
        supplier_materials: {
            select: {
                id: true;
                is_preferred: true;
                status: true;
                unit_price: true;
                min_buy: true;
                lead_time: true;
                supplier: { select: { name: true } };
            };
        };
    };
}>;

type SupplierRow = RawMatWithSheetRelations["supplier_materials"][number];

export function pickPreferredSupplier(rows: SupplierRow[]): SupplierRow | undefined {
    const preferred = rows.find((r) => r.is_preferred && r.status === "ACTIVE");
    if (preferred) return preferred;

    const activeRows = rows.filter((r) => r.status === "ACTIVE");
    if (activeRows.length === 0) return undefined;

    return activeRows.reduce((min, r) => (r.id < min.id ? r : min));
}

/**
 * Returns 10 cells matching the RM sheet column layout B-K:
 *   BARCODE | CATEGORY | MATERIAL NAME | UOM | SUPPLIER |
 *   PRICE   | MOQ      | LEAD TIME     | MIN STOCK | LOCAL/IMPORT
 *
 * Column A is reserved (not read or written). Sync MUST leave it alone.
 */
export function rawMatToRow(rm: RawMatWithSheetRelations): string[] {
    const pref = pickPreferredSupplier(rm.supplier_materials);
    return [
        rm.barcode ?? "",
        rm.raw_mat_category?.name ?? "",
        rm.name,
        rm.unit_raw_material.name,
        pref?.supplier.name ?? "",
        pref != null ? String(pref.unit_price) : "",
        pref?.min_buy != null ? String(pref.min_buy) : "",
        pref?.lead_time != null ? String(pref.lead_time) : "",
        rm.min_stock != null ? String(rm.min_stock) : "0",
        rm.source ?? "",
    ];
}
```

- [ ] **Step 4: Run tests, confirm they pass**

Run: `cd api && rtk npx vitest run src/tests/rawmat/rawmat-sheet.mapper.test.ts`
Expected: `Test Files  1 passed (1)` / `Tests  9 passed (9)`.

- [ ] **Step 5: Commit**

```bash
cd api
rtk git add src/tests/rawmat/rawmat-sheet.mapper.test.ts src/module/application/rawmat/sheet/rawmat-sheet.mapper.ts
rtk git commit -m "feat(rawmat/sheet): mapper + preferred supplier picker (TDD)

10-cell row in B-K order. Preferred supplier resolution:
is_preferred+ACTIVE → lowest-id ACTIVE → undefined.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.3: Service — TDD

**Files:**
- Create: `api/src/tests/rawmat/rawmat-sheet.service.test.ts`
- Create: `api/src/module/application/rawmat/sheet/rawmat-sheet.service.ts`

- [ ] **Step 1: Write failing tests**

Create `api/src/tests/rawmat/rawmat-sheet.service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const HEADERS = [
    "BARCODE", "CATEGORY", "MATERIAL NAME", "UOM",
    "SUPPLIER", "PRICE", "MOQ", "LEAD TIME",
    "MIN STOCK", "LOCAL/IMPORT",
];

vi.mock("../../config/env.js", () => ({
    env: {
        GOOGLE_RM_SHEET_ID: "rm-sheet",
        GOOGLE_RM_TAB_NAME: "MANDALIKA",
        RAWMAT_SHEET_SYNC_ENABLED: true,
        GOOGLE_SERVICE_ACCOUNT_EMAIL: "x",
        GOOGLE_PRIVATE_KEY: "x",
    },
}));

vi.mock("../../config/prisma.js", () => ({
    default: {
        rawMaterial: {
            findUnique: vi.fn(),
        },
    },
}));

vi.mock("../../lib/google-sheets.js", () => ({
    GoogleSheetsClient: {
        readHeader: vi.fn().mockResolvedValue(HEADERS),
        findRowByCode: vi.fn(),
        appendRow: vi.fn(),
        updateRow: vi.fn(),
        deleteRow: vi.fn(),
    },
}));

import prisma from "../../config/prisma.js";
import { GoogleSheetsClient } from "../../lib/google-sheets.js";
import { RawMatSheetSyncService } from "../../module/application/rawmat/sheet/rawmat-sheet.service.js";

const rmFixture = {
    id: 1,
    barcode: "RM-001",
    name: "GLYCERIN",
    min_stock: 25,
    source: "LOCAL" as const,
    raw_mat_category: { name: "BASE" },
    unit_raw_material: { name: "KG" },
    supplier_materials: [
        { id: 1, is_preferred: true, status: "ACTIVE", supplier: { name: "PT MAJU" }, unit_price: 12500, min_buy: 50, lead_time: 7 },
    ],
};

const rowValues = ["RM-001", "BASE", "GLYCERIN", "KG", "PT MAJU", "12500", "50", "7", "25", "LOCAL"];

describe("RawMatSheetSyncService.handle", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(GoogleSheetsClient.readHeader).mockResolvedValue(HEADERS);
    });

    describe("upsert", () => {
        it("calls updateRow when row exists in sheet", async () => {
            vi.mocked(prisma.rawMaterial.findUnique).mockResolvedValueOnce(rmFixture as never);
            vi.mocked(GoogleSheetsClient.findRowByCode).mockResolvedValueOnce(5);

            await RawMatSheetSyncService.handle({ action: "upsert", rawMaterialId: 1 });

            expect(GoogleSheetsClient.findRowByCode).toHaveBeenCalledWith(
                "rm-sheet", "MANDALIKA", "B2:B", "RM-001",
            );
            expect(GoogleSheetsClient.updateRow).toHaveBeenCalledWith(
                "rm-sheet", "MANDALIKA", "B5:K5", rowValues,
            );
            expect(GoogleSheetsClient.appendRow).not.toHaveBeenCalled();
        });

        it("calls appendRow when row missing (self-heal)", async () => {
            vi.mocked(prisma.rawMaterial.findUnique).mockResolvedValueOnce(rmFixture as never);
            vi.mocked(GoogleSheetsClient.findRowByCode).mockResolvedValueOnce(null);

            await RawMatSheetSyncService.handle({ action: "upsert", rawMaterialId: 1 });

            expect(GoogleSheetsClient.appendRow).toHaveBeenCalledWith(
                "rm-sheet", "MANDALIKA", "B:B", rowValues,
            );
            expect(GoogleSheetsClient.updateRow).not.toHaveBeenCalled();
        });

        it("uses oldBarcode for lookup when barcode changed", async () => {
            vi.mocked(prisma.rawMaterial.findUnique).mockResolvedValueOnce(rmFixture as never);
            vi.mocked(GoogleSheetsClient.findRowByCode).mockResolvedValueOnce(9);

            await RawMatSheetSyncService.handle({
                action: "upsert",
                rawMaterialId: 1,
                oldBarcode: "RM-OLD",
            });

            expect(GoogleSheetsClient.findRowByCode).toHaveBeenCalledWith(
                "rm-sheet", "MANDALIKA", "B2:B", "RM-OLD",
            );
            expect(GoogleSheetsClient.updateRow).toHaveBeenCalledWith(
                "rm-sheet", "MANDALIKA", "B9:K9", rowValues,
            );
        });

        it("falls back to new barcode lookup when oldBarcode not in sheet", async () => {
            vi.mocked(prisma.rawMaterial.findUnique).mockResolvedValueOnce(rmFixture as never);
            vi.mocked(GoogleSheetsClient.findRowByCode)
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(11);

            await RawMatSheetSyncService.handle({
                action: "upsert",
                rawMaterialId: 1,
                oldBarcode: "RM-OLD",
            });

            expect(GoogleSheetsClient.findRowByCode).toHaveBeenNthCalledWith(1,
                "rm-sheet", "MANDALIKA", "B2:B", "RM-OLD");
            expect(GoogleSheetsClient.findRowByCode).toHaveBeenNthCalledWith(2,
                "rm-sheet", "MANDALIKA", "B2:B", "RM-001");
            expect(GoogleSheetsClient.updateRow).toHaveBeenCalledWith(
                "rm-sheet", "MANDALIKA", "B11:K11", rowValues,
            );
        });

        it("throws when RM not found in DB", async () => {
            vi.mocked(prisma.rawMaterial.findUnique).mockResolvedValueOnce(null);
            await expect(
                RawMatSheetSyncService.handle({ action: "upsert", rawMaterialId: 999 }),
            ).rejects.toThrow(/Raw material 999 not found/);
        });

        it("throws when RM has empty barcode and no oldBarcode (precondition leak)", async () => {
            vi.mocked(prisma.rawMaterial.findUnique).mockResolvedValueOnce({
                ...rmFixture, barcode: null,
            } as never);
            await expect(
                RawMatSheetSyncService.handle({ action: "upsert", rawMaterialId: 1 }),
            ).rejects.toThrow(/has no barcode/);
        });

        it("throws when sheet headers do not match expected", async () => {
            vi.mocked(GoogleSheetsClient.readHeader).mockResolvedValueOnce(["WRONG"]);
            vi.mocked(prisma.rawMaterial.findUnique).mockResolvedValueOnce(rmFixture as never);
            await expect(
                RawMatSheetSyncService.handle({ action: "upsert", rawMaterialId: 1 }),
            ).rejects.toThrow(/Sheet header mismatch/);
        });
    });

    describe("delete", () => {
        it("calls deleteRow when row found", async () => {
            vi.mocked(GoogleSheetsClient.findRowByCode).mockResolvedValueOnce(3);
            await RawMatSheetSyncService.handle({
                action: "delete", rawMaterialId: 1, barcode: "RM-001",
            });
            expect(GoogleSheetsClient.findRowByCode).toHaveBeenCalledWith(
                "rm-sheet", "MANDALIKA", "B2:B", "RM-001",
            );
            expect(GoogleSheetsClient.deleteRow).toHaveBeenCalledWith(
                "rm-sheet", "MANDALIKA", 3,
            );
        });

        it("is a no-op when row missing", async () => {
            vi.mocked(GoogleSheetsClient.findRowByCode).mockResolvedValueOnce(null);
            await RawMatSheetSyncService.handle({
                action: "delete", rawMaterialId: 1, barcode: "GONE",
            });
            expect(GoogleSheetsClient.deleteRow).not.toHaveBeenCalled();
        });
    });

    it("short-circuits when sync disabled", async () => {
        const envMod = await import("../../config/env.js");
        const original = envMod.env.RAWMAT_SHEET_SYNC_ENABLED;
        (envMod.env as { RAWMAT_SHEET_SYNC_ENABLED: boolean }).RAWMAT_SHEET_SYNC_ENABLED = false;

        await RawMatSheetSyncService.handle({ action: "upsert", rawMaterialId: 1 });

        expect(GoogleSheetsClient.readHeader).not.toHaveBeenCalled();
        expect(prisma.rawMaterial.findUnique).not.toHaveBeenCalled();

        (envMod.env as { RAWMAT_SHEET_SYNC_ENABLED: boolean }).RAWMAT_SHEET_SYNC_ENABLED = original;
    });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `cd api && rtk npx vitest run src/tests/rawmat/rawmat-sheet.service.test.ts`
Expected: `Cannot find module '.../rawmat-sheet.service.js'`.

- [ ] **Step 3: Implement service**

Create `api/src/module/application/rawmat/sheet/rawmat-sheet.service.ts`:

```ts
import prisma from "../../../../config/prisma.js";
import { env } from "../../../../config/env.js";
import { GoogleSheetsClient } from "../../../../lib/google-sheets.js";
import { rawMatToRow, type RawMatWithSheetRelations } from "./rawmat-sheet.mapper.js";
import type { RawMatSheetSyncJob } from "./rawmat-sheet.schema.js";

/**
 * RM sheet layout:
 *   A: reserved (sync never reads or writes)
 *   B: BARCODE
 *   C: CATEGORY
 *   D: MATERIAL NAME
 *   E: UOM
 *   F: SUPPLIER (preferred)
 *   G: PRICE
 *   H: MOQ
 *   I: LEAD TIME
 *   J: MIN STOCK
 *   K: LOCAL/IMPORT
 */
const EXPECTED_HEADERS = [
    "BARCODE",
    "CATEGORY",
    "MATERIAL NAME",
    "UOM",
    "SUPPLIER",
    "PRICE",
    "MOQ",
    "LEAD TIME",
    "MIN STOCK",
    "LOCAL/IMPORT",
] as const;
const HEADER_RANGE = "B1:K1";
const CODE_COLUMN_RANGE = "B2:B";
const APPEND_ANCHOR_RANGE = "B:B";
const rowDataRange = (n: number) => `B${n}:K${n}`;

const SHEET_INCLUDES = {
    raw_mat_category: { select: { name: true } },
    unit_raw_material: { select: { name: true } },
    supplier_materials: {
        select: {
            id: true,
            is_preferred: true,
            status: true,
            unit_price: true,
            min_buy: true,
            lead_time: true,
            supplier: { select: { name: true } },
        },
    },
} as const;

export class RawMatSheetSyncService {
    static async handle(job: RawMatSheetSyncJob): Promise<void> {
        if (!env.RAWMAT_SHEET_SYNC_ENABLED) return;

        const sheetId = env.GOOGLE_RM_SHEET_ID;
        const tab = env.GOOGLE_RM_TAB_NAME;

        const headers = await GoogleSheetsClient.readHeader(sheetId, tab, HEADER_RANGE);
        if (
            headers.length < EXPECTED_HEADERS.length ||
            EXPECTED_HEADERS.some((h, i) => headers[i] !== h)
        ) {
            throw new Error(
                `Sheet header mismatch. Expected: ${EXPECTED_HEADERS.join(",")} Got: ${headers.join(",")}`,
            );
        }

        if (job.action === "upsert") {
            const rm = (await prisma.rawMaterial.findUnique({
                where: { id: job.rawMaterialId },
                include: SHEET_INCLUDES,
            })) as RawMatWithSheetRelations | null;
            if (!rm) throw new Error(`Raw material ${job.rawMaterialId} not found in DB`);

            const primarySearchCode = job.oldBarcode ?? rm.barcode ?? "";
            if (!primarySearchCode) {
                throw new Error(
                    `Raw material ${job.rawMaterialId} has no barcode — cannot sync to sheet`,
                );
            }

            const values = rawMatToRow(rm);
            let rowIndex = await GoogleSheetsClient.findRowByCode(
                sheetId,
                tab,
                CODE_COLUMN_RANGE,
                primarySearchCode,
            );

            if (rowIndex === null && job.oldBarcode) {
                rowIndex = await GoogleSheetsClient.findRowByCode(
                    sheetId,
                    tab,
                    CODE_COLUMN_RANGE,
                    rm.barcode ?? "",
                );
            }

            if (rowIndex === null) {
                await GoogleSheetsClient.appendRow(sheetId, tab, APPEND_ANCHOR_RANGE, values);
            } else {
                await GoogleSheetsClient.updateRow(sheetId, tab, rowDataRange(rowIndex), values);
            }
            return;
        }

        // action === "delete"
        const rowIndex = await GoogleSheetsClient.findRowByCode(
            sheetId,
            tab,
            CODE_COLUMN_RANGE,
            job.barcode,
        );
        if (rowIndex !== null) {
            await GoogleSheetsClient.deleteRow(sheetId, tab, rowIndex);
        }
    }
}
```

- [ ] **Step 4: Run tests, confirm they pass**

Run: `cd api && rtk npx vitest run src/tests/rawmat/rawmat-sheet.service.test.ts`
Expected: `Test Files  1 passed (1)` / `Tests  10 passed (10)`.

- [ ] **Step 5: Commit**

```bash
cd api
rtk git add src/tests/rawmat/rawmat-sheet.service.test.ts src/module/application/rawmat/sheet/rawmat-sheet.service.ts
rtk git commit -m "feat(rawmat/sheet): sync service with header validation + self-heal (TDD)

Handle reads header for shape validation, finds row by BARCODE in col B,
calls appendRow/updateRow on columns B-K only (column A stays untouched).
Delete is a no-op when row not found. SKU change uses oldBarcode lookup
with fallback to new barcode.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.4: Queue helper (lazy init)

**Files:**
- Create: `api/src/module/application/rawmat/sheet/rawmat-sheet.queue.ts`

- [ ] **Step 1: Create the file**

```ts
import { Queue } from "bullmq";
import { bullConnection, RAWMAT_SHEET_QUEUE_NAME } from "../../../../config/queue.js";
import { env } from "../../../../config/env.js";
import { logger } from "../../../../lib/logger.js";
import type { RawMatSheetSyncJob } from "./rawmat-sheet.schema.js";

export { RAWMAT_SHEET_QUEUE_NAME };

// Lazy: do not instantiate at module import time. Top-level `new Queue(...)`
// would trigger ioredis connect via BullMQ, racing with redisClient.connect()
// in server.ts initialize() and producing "Redis is already connecting".
let _queue: Queue<RawMatSheetSyncJob> | null = null;

function getQueue(): Queue<RawMatSheetSyncJob> {
    if (_queue) return _queue;
    _queue = new Queue<RawMatSheetSyncJob>(RAWMAT_SHEET_QUEUE_NAME, {
        connection: bullConnection,
        defaultJobOptions: {
            attempts: 3,
            backoff: { type: "exponential", delay: 5000 },
            removeOnComplete: { age: 86400, count: 1000 },
            removeOnFail: { age: 604800 },
        },
    });
    return _queue;
}

export async function enqueueRawMatSheetSync(job: RawMatSheetSyncJob): Promise<void> {
    if (!env.RAWMAT_SHEET_SYNC_ENABLED) return;
    try {
        await getQueue().add(`${job.action}:${job.rawMaterialId}`, job);
    } catch (err) {
        logger.error("Failed to enqueue rawmat-sheet sync job", {
            error: err instanceof Error ? err.message : String(err),
            job,
        });
    }
}
```

- [ ] **Step 2: Verify type-check passes**

Run: `cd api && rtk npx tsc --noEmit`
Expected: `No errors found`.

- [ ] **Step 3: Commit**

```bash
cd api
rtk git add src/module/application/rawmat/sheet/rawmat-sheet.queue.ts
rtk git commit -m "feat(rawmat/sheet): lazy-init BullMQ queue + enqueue helper

Mirrors product-sheet.queue: lazy getQueue() avoids module-import
Redis connection race. enqueue is a no-op when feature flag is off.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.5: Worker

**Files:**
- Create: `api/src/module/application/rawmat/sheet/rawmat-sheet.worker.ts`

- [ ] **Step 1: Create the file**

```ts
import { Worker } from "bullmq";
import { bullConnection, RAWMAT_SHEET_QUEUE_NAME } from "../../../../config/queue.js";
import prisma from "../../../../config/prisma.js";
import { logger } from "../../../../lib/logger.js";
import { RawMatSheetSyncService } from "./rawmat-sheet.service.js";
import type { RawMatSheetSyncJob } from "./rawmat-sheet.schema.js";

export function createRawMatSheetSyncWorker(): { close: () => Promise<void> } {
    const worker = new Worker<RawMatSheetSyncJob>(
        RAWMAT_SHEET_QUEUE_NAME,
        async (job) => RawMatSheetSyncService.handle(job.data),
        { connection: bullConnection, concurrency: 2 },
    );

    worker.on("failed", async (job, err) => {
        if (!job) return;
        const exhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
        if (!exhausted) return;
        try {
            await prisma.rawMaterialSheetSyncFailure.create({
                data: {
                    raw_material_id: job.data.rawMaterialId,
                    action: job.data.action,
                    error_message: err.message.slice(0, 4000),
                    attempt_count: job.attemptsMade,
                    last_attempted_at: new Date(),
                },
            });
            logger.warn("rawmat-sheet sync job failed terminally", {
                rawMaterialId: job.data.rawMaterialId,
                action: job.data.action,
                error: err.message,
            });
        } catch (dbErr) {
            logger.error("Failed to record rawmat sheet-sync failure", {
                error: dbErr instanceof Error ? dbErr.message : String(dbErr),
            });
        }
    });

    worker.on("completed", async (job) => {
        try {
            await prisma.rawMaterialSheetSyncFailure.updateMany({
                where: { raw_material_id: job.data.rawMaterialId, resolved_at: null },
                data: { resolved_at: new Date() },
            });
        } catch (err) {
            logger.error("Failed to resolve rawmat sheet-sync failure record", {
                error: err instanceof Error ? err.message : String(err),
            });
        }
    });

    return { close: () => worker.close() };
}
```

- [ ] **Step 2: Verify type-check passes**

Run: `cd api && rtk npx tsc --noEmit`
Expected: `No errors found`.

- [ ] **Step 3: Commit**

```bash
cd api
rtk git add src/module/application/rawmat/sheet/rawmat-sheet.worker.ts
rtk git commit -m "feat(rawmat/sheet): BullMQ worker with failure/completed handlers

On terminal failure (attempts exhausted) writes a row to
raw_material_sheet_sync_failures. On completion, resolves any unresolved
failure rows for that RM.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.6: Register worker in `worker.ts`

**Files:**
- Modify: `api/src/worker.ts`

- [ ] **Step 1: Add import**

At the top of `worker.ts`, after the existing `createProductSheetSyncWorker` import:

```ts
import { createRawMatSheetSyncWorker } from "./module/application/rawmat/sheet/rawmat-sheet.worker.js";
```

- [ ] **Step 2: Declare worker handle**

Below the existing `let productSheetSyncWorker: WorkerHandle | null = null;`:

```ts
let rawmatSheetSyncWorker: WorkerHandle | null = null;
```

- [ ] **Step 3: Start it inside `initialize()`**

After the line that creates `productSheetSyncWorker`:

```ts
        rawmatSheetSyncWorker = createRawMatSheetSyncWorker();
        logger.info("RawMat sheet-sync worker listening");
```

- [ ] **Step 4: Close it in `shutdown()`**

Inside the shutdown `try` block, after `await productSheetSyncWorker?.close();`:

```ts
        await rawmatSheetSyncWorker?.close();
```

- [ ] **Step 5: Type-check passes**

Run: `cd api && rtk npx tsc --noEmit`
Expected: `No errors found`.

- [ ] **Step 6: Commit**

```bash
cd api
rtk git add src/worker.ts
rtk git commit -m "feat(rawmat/sheet): register worker in erp-worker process

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3 — Wire RM service to enqueue sync jobs

### Task 3.1: Hook enqueue calls into `rawmat.service.ts`

**Files:**
- Modify: `api/src/module/application/rawmat/rawmat.service.ts`

> **Why this is one task:** the service file already exists and the 5 enqueue insertion points are intertwined with existing logic. Splitting per-method would force re-reading the same file 5 times.

- [ ] **Step 1: Add import at top of file**

```ts
import { enqueueRawMatSheetSync } from "./sheet/rawmat-sheet.queue.js";
```

- [ ] **Step 2: Enqueue on `create()` — at the end of the success path**

Find `static async create(data: RequestRawMaterialDTO)` (line ~80). It returns inside a `prisma.$transaction` block via `return this.detail(rm.id);`. Wrap the transaction call so we can capture `rm.id` and `barcode`, then enqueue *after* the transaction returns. Refactor:

```ts
        const created = await prisma.$transaction(async (tx) => {
            // ... (existing body unchanged: unitRelation, categoryRelation, tx.rawMaterial.create({...}),
            //      supplier_materials createMany / create) ...
            return rm; // return the bare RM row, not detail()
        });

        // enqueue AFTER transaction commits, only if barcode present
        if (created.barcode) {
            await enqueueRawMatSheetSync({
                action: "upsert",
                rawMaterialId: created.id,
            });
        }

        return this.detail(created.id);
```

Make sure the `return this.detail(rm.id)` line inside the transaction is changed to `return rm;` so the variable name matches `created` outside.

- [ ] **Step 3: Enqueue on `update()` — capture old barcode for SKU-change support**

Find `static async update(id: number, payload: Partial<RequestRawMaterialDTO>)` (line ~155). Before the `prisma.$transaction(...)` call, capture the existing barcode (we already do `await this.findRaw(id)` — reuse it):

```ts
        const existing = await this.findRaw(id);
        if (!existing) throw new ApiError(404, "Data raw material tidak ditemukan");
        const oldBarcode = existing.barcode ?? null;
```

(The existing code stores this in `find` — rename or keep as is, just expose `oldBarcode`.)

After the `await prisma.$transaction(...)` block finishes, add enqueue logic. The transaction currently `returns ...` — let it; then below it:

```ts
        // Read the post-update barcode (may have changed during the txn)
        const post = await prisma.rawMaterial.findUnique({
            where: { id },
            select: { barcode: true, deleted_at: true },
        });

        if (post?.deleted_at == null && post?.barcode) {
            const oldOpt =
                oldBarcode && oldBarcode !== post.barcode ? { oldBarcode } : {};
            await enqueueRawMatSheetSync({
                action: "upsert",
                rawMaterialId: id,
                ...oldOpt,
            });
        }
```

- [ ] **Step 4: Enqueue on `delete()` (soft-delete)**

Find `static async delete(id: number)` (line ~431). Replace its body so we know the barcode before flipping `deleted_at`:

```ts
    static async delete(id: number) {
        const find = await this.findRaw(id);
        if (!find) throw new ApiError(404, "Data raw material tidak ditemukan");
        if (find.deleted_at !== null)
            throw new ApiError(400, "Raw material sudah berada pada status deleted");

        const result = await prisma.rawMaterial.update({
            where: { id, deleted_at: null },
            data: { deleted_at: new Date() },
        });

        if (find.barcode) {
            await enqueueRawMatSheetSync({
                action: "delete",
                rawMaterialId: id,
                barcode: find.barcode,
            });
        }

        return result;
    }
```

- [ ] **Step 5: Enqueue on `restore()`**

Find `static async restore(id: number)` (line ~443). After the `prisma.rawMaterial.update(...)` call:

```ts
    static async restore(id: number) {
        const find = await this.findRaw(id);
        if (!find) throw new ApiError(404, "Data raw material tidak ditemukan");
        if (find.deleted_at === null)
            throw new ApiError(400, "Raw material tidak berada pada status deleted");

        const result = await prisma.rawMaterial.update({
            where: { id, deleted_at: { not: null } },
            data: { deleted_at: null },
        });

        if (find.barcode) {
            await enqueueRawMatSheetSync({
                action: "upsert",
                rawMaterialId: id,
            });
        }

        return result;
    }
```

- [ ] **Step 6: Enqueue on `changeStatus()` if present**

If `static async changeStatus(...)` exists at ~line 456 with `deleted_at: status === "DELETE" ? new Date() : null`, mirror the FG pattern:

```ts
        // capture before mutation
        const existing = await prisma.rawMaterial.findUnique({
            where: { id },
            select: { barcode: true },
        });

        await prisma.rawMaterial.update({
            where: { id },
            data: { deleted_at: status === "DELETE" ? new Date() : null },
        });

        if (existing?.barcode) {
            if (status === "DELETE") {
                await enqueueRawMatSheetSync({
                    action: "delete",
                    rawMaterialId: id,
                    barcode: existing.barcode,
                });
            } else {
                await enqueueRawMatSheetSync({
                    action: "upsert",
                    rawMaterialId: id,
                });
            }
        }
```

- [ ] **Step 7: Add `resync()` method to the service**

At the end of the class, before the closing `}`:

```ts
    static async resync(id: number) {
        const rm = await prisma.rawMaterial.findUnique({
            where: { id },
            select: { id: true, barcode: true, deleted_at: true },
        });
        if (!rm) throw new ApiError(404, `Raw material dengan id ${id} tidak ditemukan`);
        if (!rm.barcode) {
            throw new ApiError(
                400,
                "Raw material tanpa barcode tidak dapat di-sync ke Spreadsheet",
            );
        }

        if (rm.deleted_at !== null) {
            await enqueueRawMatSheetSync({
                action: "delete",
                rawMaterialId: rm.id,
                barcode: rm.barcode,
            });
        } else {
            await enqueueRawMatSheetSync({
                action: "upsert",
                rawMaterialId: rm.id,
            });
        }
        return { message: "Sync ulang dijadwalkan" };
    }
```

- [ ] **Step 8: Type-check + run RM service tests**

Run: `cd api && rtk npx tsc --noEmit && rtk npx vitest run src/tests/rawmat/`
Expected: existing rawmat tests still pass.

- [ ] **Step 9: Commit**

```bash
cd api
rtk git add src/module/application/rawmat/rawmat.service.ts
rtk git commit -m "feat(rawmat/sheet): wire CRUD + restore + resync to BullMQ enqueue

create()/update()/delete()/restore() enqueue a sheet sync job
whenever the RM has a barcode. update() detects barcode change and
passes oldBarcode so the worker can locate the existing row. resync()
endpoint method dispatches delete (if soft-deleted) or upsert.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3.2: Resync controller + route

**Files:**
- Modify: `api/src/module/application/rawmat/rawmat.controller.ts`
- Modify: `api/src/module/application/rawmat/rawmat.routes.ts`

- [ ] **Step 1: Add controller method**

Locate the existing static methods on `RawMaterialController`. At a position parallel to the existing `delete`/`restore`/etc., add:

```ts
    static async resync(c: Context) {
        const id = Number(c.req.param("id"));
        const result = await RawMaterialService.resync(id);
        return c.json(result);
    }
```

(If `Context` is not yet imported, add `import type { Context } from "hono";` at the top — same convention as `product.controller.ts`.)

- [ ] **Step 2: Add route**

In `rawmat.routes.ts`, near the other `POST` routes on `/:id`:

```ts
RawMaterialRoutes.post("/:id/resync", RawMaterialController.resync);
```

- [ ] **Step 3: Type-check passes**

Run: `cd api && rtk npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
cd api
rtk git add src/module/application/rawmat/rawmat.controller.ts src/module/application/rawmat/rawmat.routes.ts
rtk git commit -m "feat(rawmat/sheet): POST /rawmats/:id/resync endpoint

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4 — Enrich list response with sync status

### Task 4.1: Derive `sheet_sync_status` in list query

**Files:**
- Modify: `api/src/module/application/rawmat/rawmat.schema.ts`
- Modify: `api/src/module/application/rawmat/rawmat.service.ts`

- [ ] **Step 1: Extend `ResponseRawMaterialSchema`**

In `rawmat.schema.ts`, find the `.extend({...})` block of `ResponseRawMaterialSchema` and add two fields before the closing `})`:

```ts
    sheet_sync_status: z.enum(["synced", "failed"]).optional(),
    sheet_sync_error: z.string().optional(),
```

- [ ] **Step 2: Derive status in `list()`**

In `rawmat.service.ts`, find the `static async list({...})` method. After the `[rows, [{ count }]] = await Promise.all([...]);` line and before `return { len: Number(count), data: rows.map(toDTO) };`, insert:

```ts
        const pageIds = rows.map((r) => r.id);
        const failureRows =
            pageIds.length === 0
                ? []
                : await prisma.rawMaterialSheetSyncFailure.findMany({
                      where: { raw_material_id: { in: pageIds }, resolved_at: null },
                      orderBy: { created_at: "desc" },
                      select: { raw_material_id: true, error_message: true },
                  });
        const failureByRm = new Map<number, string>();
        for (const f of failureRows) {
            if (!failureByRm.has(f.raw_material_id)) {
                failureByRm.set(f.raw_material_id, f.error_message);
            }
        }
```

Then replace the final `return` with:

```ts
        return {
            len: Number(count),
            data: rows.map((r) => {
                const dto = toDTO(r) as ResponseRawMaterialDTO & {
                    sheet_sync_status?: "synced" | "failed";
                    sheet_sync_error?: string;
                };
                if (failureByRm.has(r.id)) {
                    dto.sheet_sync_status = "failed";
                    dto.sheet_sync_error = failureByRm.get(r.id);
                } else {
                    dto.sheet_sync_status = "synced";
                }
                return dto;
            }),
        };
```

- [ ] **Step 3: Type-check passes**

Run: `cd api && rtk npx tsc --noEmit`

- [ ] **Step 4: Run rawmat tests**

Run: `cd api && rtk npx vitest run src/tests/rawmat/`
Expected: still passing (the mocked `rawMaterialSheetSyncFailure.findMany` returns `[]` so all rows get `synced`).

- [ ] **Step 5: Commit**

```bash
cd api
rtk git add src/module/application/rawmat/rawmat.schema.ts src/module/application/rawmat/rawmat.service.ts
rtk git commit -m "feat(rawmat/sheet): derive sheet_sync_status + sheet_sync_error in list

Batch-loads unresolved failures for the current page and zips them in.
RMs with no failure default to 'synced'. Schema DTO extended.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 5 — Frontend: hook, column, badge, loader, remove bulk select

> All frontend tasks happen in the `app/` repo (`/Users/mandalika/Documents/Mandalika/erp-v0.1.1/app`).

### Task 5.1: Frontend schema + service `.resync()`

**Files:**
- Modify: `app/src/app/(application)/rawmats/server/rawmats.schema.ts` (or equivalent filename — confirm via `ls` first)
- Modify: `app/src/app/(application)/rawmats/server/rawmats.service.ts` (or equivalent)

- [ ] **Step 1: Locate the RM frontend folder**

```bash
ls /Users/mandalika/Documents/Mandalika/erp-v0.1.1/app/src/app/\(application\)/rawmats/server 2>/dev/null \
  || ls /Users/mandalika/Documents/Mandalika/erp-v0.1.1/app/src/app/\(application\)/raw-materials/server 2>/dev/null
```

Whichever exists, use that path consistently in this task. The slug is *probably* `rawmats` mirroring the API route `/rawmats`. If it is different, swap in the actual folder name in the steps below.

- [ ] **Step 2: Extend the response DTO type**

Open `rawmats.schema.ts`. Find `ResponseRawMaterialDTO` (or however the response type is named). Add two optional fields:

```ts
sheet_sync_status?: "synced" | "failed";
sheet_sync_error?: string;
```

If the file mirrors the FG pattern and the response is a `z.infer<typeof ResponseRawMaterialSchema>`, extend the Zod schema instead:

```ts
sheet_sync_status: z.enum(["synced", "failed"]).optional(),
sheet_sync_error: z.string().optional(),
```

- [ ] **Step 3: Add `.resync(id)` to the service**

Open `rawmats.service.ts`. Find the class/object that wraps axios calls (mirrors `ProductService`). Add:

```ts
    static resync(id: number) {
        return apiClient.post(`/rawmats/${id}/resync`).then((r) => r.data);
    }
```

(Adjust `apiClient` identifier to whatever is used in this file — likely `api` or `axiosInstance`.)

- [ ] **Step 4: Type-check passes**

Run: `cd app && rtk npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
cd app
rtk git add src/app/\(application\)/rawmats/server/rawmats.schema.ts src/app/\(application\)/rawmats/server/rawmats.service.ts
rtk git commit -m "feat(rawmats): add sheet_sync_status DTO fields + resync service call

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5.2: `useActionRawMaterial().resync` mutation

**Files:**
- Modify: `app/src/app/(application)/rawmats/server/use.rawmats.ts` (confirm exact filename in step 1)

- [ ] **Step 1: Locate file**

```bash
ls /Users/mandalika/Documents/Mandalika/erp-v0.1.1/app/src/app/\(application\)/rawmats/server | rtk grep -i "use"
```

Use whatever filename is returned — likely `use.rawmats.ts` mirroring `use.products.ts`.

- [ ] **Step 2: Add `resync` mutation**

In the existing `useActionRawMaterial` (or equivalent) hook, add a mutation that mirrors the FG one in `app/src/app/(application)/products/server/use.products.ts`:

```ts
    const resync = useMutation<unknown, ResponseError, number>({
        mutationKey: ["rawmat", "resync"],
        mutationFn: (id) => RawMatService.resync(id),
        onSuccess: () => {
            setNotif({
                title: "Sync Ulang",
                message: "Sync ulang ke Spreadsheet dijadwalkan",
            });
            queryClient.invalidateQueries({ queryKey: ["rawmats"], type: "all" });
        },
        onError: (err) => {
            FetchError(err, setErr);
        },
    });
```

Then add `resync` to the returned object:

```ts
return { /* existing... */ resync };
```

If the hook name in this file is something different (e.g. `useRawMatActions`), keep the existing name — only add the mutation.

- [ ] **Step 3: Type-check passes**

Run: `cd app && rtk npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
cd app
rtk git add src/app/\(application\)/rawmats/server/use.rawmats.ts
rtk git commit -m "feat(rawmats): useActionRawMaterial().resync mutation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5.3: Add `SHEET` column to RM table with 3-state badge

**Files:**
- Modify: `app/src/components/pages/rawmats/table/columns.tsx` (confirm filename — likely `rawmaterials/` or `rawmats/`)

- [ ] **Step 1: Locate file**

```bash
find /Users/mandalika/Documents/Mandalika/erp-v0.1.1/app/src/components/pages -name "columns.tsx" | rtk grep -i "raw"
```

- [ ] **Step 2: Add Loader2 to icon imports**

If `lucide-react` is imported, add `Loader2` to the named import list.

- [ ] **Step 3: Extend the props type**

Find the `type RawMaterialColumnsProps = { ... }` (or equivalent). Add:

```ts
onResync?: (id: number) => void;
syncingIds?: Set<number>;
```

And destructure them in the function signature.

- [ ] **Step 4: Add the new column**

After the existing `status` (or last data) column and before the `actions` column, insert:

```tsx
    {
        id: "sheet_sync_status",
        header: "SHEET",
        cell: ({ row }) => {
            const id = row.original.id;
            const isSyncing = syncingIds?.has(id) ?? false;
            const status = row.original.sheet_sync_status ?? "synced";

            if (isSyncing) {
                return (
                    <span
                        className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700"
                        title="Sedang sync ke Spreadsheet…"
                    >
                        <Loader2 className="h-2.5 w-2.5 animate-spin" />
                        syncing
                    </span>
                );
            }

            if (status === "failed") {
                return (
                    <button
                        type="button"
                        onClick={() => onResync?.(id)}
                        title={
                            row.original.sheet_sync_error ??
                            "Sync gagal — klik untuk retry"
                        }
                        className="inline-flex items-center gap-1 rounded bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700 hover:bg-rose-200 cursor-pointer transition-colors"
                    >
                        ✗ failed
                    </button>
                );
            }
            return (
                <span className="inline-flex items-center rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                    ✓ synced
                </span>
            );
        },
    },
```

- [ ] **Step 5: Type-check passes**

Run: `cd app && rtk npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
cd app
rtk git add src/components/pages/rawmaterials/table/columns.tsx
rtk git commit -m "feat(rawmats): SHEET column with synced/failed/syncing badge

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

(Path in the `git add` is illustrative — use whatever Step 1 returned.)

---

### Task 5.4: Wire `syncingIds` state and resync handler into RM page

**Files:**
- Modify: `app/src/components/pages/rawmaterials/index.tsx` (or equivalent — find via `find ... -name "index.tsx" | grep -i raw`)

- [ ] **Step 1: Add imports**

```ts
import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
```

(If `useCallback`/`useState` already imported, just add what's missing.)

- [ ] **Step 2: Destructure `resync` from the action hook**

Find the `useActionRawMaterial()` (or equivalent) destructuring:

```ts
const { clean, exportCsv, resync } = useActionRawMaterial();
```

- [ ] **Step 3: Add state + handler**

Below the existing hooks:

```ts
const queryClient = useQueryClient();
const [syncingIds, setSyncingIds] = useState<Set<number>>(new Set());

const handleResync = useCallback(
    (id: number) => {
        if (syncingIds.has(id)) return;
        setSyncingIds((prev) => {
            const next = new Set(prev);
            next.add(id);
            return next;
        });
        resync.mutate(id, {
            onSettled: () => {
                setTimeout(() => {
                    queryClient.invalidateQueries({
                        queryKey: ["rawmats"],
                        type: "all",
                    });
                    setSyncingIds((prev) => {
                        const next = new Set(prev);
                        next.delete(id);
                        return next;
                    });
                }, 2500);
            },
        });
    },
    [resync, queryClient, syncingIds],
);
```

- [ ] **Step 4: Pass to columns**

Find the `useMemo(() => RawMaterialColumns({...}), [...])` block and add to the props:

```ts
onResync: handleResync,
syncingIds,
```

Add `handleResync` and `syncingIds` to the memo dependency list.

- [ ] **Step 5: Type-check passes**

Run: `cd app && rtk npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
cd app
rtk git add src/components/pages/rawmaterials/index.tsx
rtk git commit -m "feat(rawmats): per-row syncing badge with loader on resync

Mirrors the FG behavior: clicking '✗ failed' swaps the badge to amber
'syncing' with a spinner, then auto-refetches after 2.5s.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5.5: Remove bulk multi-select from RM list (rate-limit guard)

**Files:**
- Modify: `app/src/components/pages/rawmaterials/index.tsx` (same file as 5.4)
- Possibly: `app/src/app/(application)/rawmats/server/use.rawmats.ts` (remove `bulkStatus` mutation if present)

- [ ] **Step 1: Check whether RM currently has bulk multi-select**

```bash
cd app && rtk grep -rn "rowSelection\|bulkStatus\|enableMultiSelect" src/components/pages/rawmaterials src/app/\(application\)/rawmats 2>&1 | head -20
```

If no matches, **skip the rest of this task and commit nothing** — the bulk pattern was never present.

- [ ] **Step 2: If matches exist, remove them**

Mirror the FG cleanup pattern (already committed for FG):
- Delete `rowSelection`/`setRowSelection` state.
- Delete the bulk-action JSX (the "Aktifkan/Hapus terpilih" buttons).
- Remove `enableMultiSelect`, `getRowId`, and `state.rowSelection` props from `<DataTable />`.
- Remove the `bulkStatus` mutation from `useActionRawMaterial`.
- Remove the `bulkStatus` method from `RawMatService` if present.

- [ ] **Step 3: Type-check passes**

Run: `cd app && rtk npx tsc --noEmit`

- [ ] **Step 4: Commit (only if changes were made)**

```bash
cd app
rtk git add -A src/components/pages/rawmaterials src/app/\(application\)/rawmats
rtk git commit -m "refactor(rawmats): remove bulk multi-select; per-row actions only

Prevents bulk action storms from saturating the Google Sheet API
rate-limit. Mirrors the FG cleanup.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 6 — Verification

### Task 6.1: Full backend test + tsc sweep

- [ ] **Step 1: Run full backend test suite**

Run: `cd api && rtk npx vitest run`
Expected: all green (specifically the new `rawmat-sheet.mapper.test.ts` and `rawmat-sheet.service.test.ts` should appear with their respective counts).

- [ ] **Step 2: Backend type-check**

Run: `cd api && rtk npx tsc --noEmit`
Expected: `No errors found`.

- [ ] **Step 3: Frontend type-check**

Run: `cd app && rtk npx tsc --noEmit`
Expected: `No errors found`.

- [ ] **Step 4: Frontend test suite (if exists)**

Run: `cd app && rtk npx vitest run 2>&1 | tail -20`
Expected: green or "no tests run".

---

### Task 6.2: Production smoke test

> Only do this **after** Phase 0 key rotation. Before pushing the new code to production, make sure the FG sync is still working with the new key.

- [ ] **Step 1: Push branches**

```bash
cd api && rtk git push
cd app && rtk git push
```

- [ ] **Step 2: Deploy on VM**

```bash
cd /var/www/api-erp && git pull && npm run build && pm2 restart api-erp erp-worker
cd /var/www/app-erp && git pull && npm run build && pm2 restart app-erp
```

- [ ] **Step 3: Tail worker logs**

```bash
pm2 logs erp-worker --lines 50
```

Look for: `"RawMat sheet-sync worker listening"`. No `"Redis is already connecting"` errors.

- [ ] **Step 4: End-to-end test plan**

In the ERP UI:

1. **Create**: add a new RM with barcode `RM-SMOKE-001`, name `"SMOKE TEST"`, unit, category, one preferred supplier. → Open the spreadsheet. A new row should appear in B-K within ~5 seconds.
2. **Update — same barcode**: edit min_stock from 10 to 20. → Same row in sheet updates J cell.
3. **Update — barcode change**: edit barcode to `RM-SMOKE-002`. → Same physical row in sheet (no orphan), column B updates.
4. **Soft delete**: click delete. → Row removed from sheet entirely.
5. **Restore**: from trash view, click restore. → Row reappears (appended at the bottom, not in original position — known behavior).
6. **Resync failure path**: temporarily put a wrong tab name in `GOOGLE_RM_TAB_NAME`, restart `erp-worker`, edit any RM → after 3 retries → badge becomes `✗ failed` in UI. Restore env, click badge → badge swaps to `syncing` → after worker picks it up → `✓ synced`.

- [ ] **Step 5: Sanity check column A**

Manually put a UID value in column A of an existing row. Edit that RM. Confirm the UID in column A is **not** overwritten.

---

## Self-Review Summary

**Spec coverage check (against `2026-06-04-rawmat-sheet-sync-design.md`):**

| Spec section | Covered by task |
|---|---|
| §2 Sheet Layout (B-K, 10 cols, col A reserved) | 2.3 (EXPECTED_HEADERS + ranges) |
| §2 Preferred Supplier Resolution | 2.2 (`pickPreferredSupplier`) |
| §2 Identifier (skip if barcode null) | 3.1 (precondition in service.ts) + 2.3 (defense-in-depth in worker service) |
| §3 Triggers — create / update / softDelete / restore / changeStatus / no-enqueue-on-deleted-update / no-enqueue-without-barcode | 3.1 |
| §3 Resync endpoint | 3.1 + 3.2 |
| §4 Service logic (header validation, oldBarcode fallback) | 2.3 |
| §5 Mapper (10 cells, Decimal stringify) | 2.2 |
| §6 RawMaterialSheetSyncFailure model | 1.1 |
| §6 DTO additions sheet_sync_status / error | 4.1 + 5.1 |
| §7 Env + queue name constant | 1.2 |
| §8 Frontend hook + column + page state | 5.1–5.4 |
| §8 Bulk multi-select removal | 5.5 |
| §9 Tests (mapper + service) | 2.2 + 2.3 |
| §10 Risks (key rotation as gating step) | 0.1 |

**Placeholder scan:** no `TBD`/`TODO`/"appropriate error handling" left in tasks. Filename uncertainty (RM frontend folder slug) is acknowledged with a discovery step rather than a placeholder.

**Type consistency:** `rawMaterialId`, `oldBarcode`, `barcode`, `RawMatSheetSyncJob`, `enqueueRawMatSheetSync`, `RawMatSheetSyncService`, `createRawMatSheetSyncWorker`, `RAWMAT_SHEET_QUEUE_NAME` — names used consistently across tasks 2.1 → 2.5 → 3.1 → 4.1 → worker.ts.

---

## Plan complete and saved to `docs/superpowers/plans/2026-06-04-rawmat-sheet-sync.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
