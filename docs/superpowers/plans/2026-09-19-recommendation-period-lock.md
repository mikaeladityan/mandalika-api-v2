# Recommendation Period Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bekukan hasil rekomendasi General, Discontinue FG × RM, dan Discontinue Material per bulan/tahun melalui snapshot berversi, sambil menjaga approval, consolidation status, MOQ, hide, dan alur RFQ/PO sesuai spec.

**Architecture:** Kalkulasi live tetap menjadi sumber snapshot. `RecommendationPeriodLockService` menyimpan header periode dan row snapshot dengan kolom SQL untuk filter/sort serta payload JSON untuk response lengkap. Resolver lock dipanggil oleh read path; service gate dipanggil sebelum mutation yang mengubah angka rekomendasi. Modul lock mengikuti schema → services → controller → routes → registration.

**Tech Stack:** Hono, Zod, Prisma, PostgreSQL, TypeScript, Vitest, Next.js/React, TanStack Query.

**Spec:** `api/docs/superpowers/specs/2026-09-19-recommendation-period-lock-design.md`

**Prerequisite:** Selesaikan `api/docs/superpowers/plans/2026-09-19-recommendation-calc-bugs.md` serta spec bug sebelum lock produksi pertama. Bug #1 dan #2 wajib selesai; Bug #3 wajib selesai sebelum snapshot Discontinue dianggap valid.

## Global Constraints

- Satu lock mencakup satu bulan + tahun, seluruh `type` (`ffo`, `impor`, `lokal`, `tester`) dan seluruh view.
- Snapshot tidak mengubah tabel sumber dan tidak melakukan backfill.
- Validasi request baru memakai pesan Bahasa Indonesia; update schema memakai `.partial()` bila ada update object.
- Services tidak boleh membaca HTTP Context atau mengembalikan status code.
- Gated mutation mengembalikan HTTP 409 dengan kode `PERIOD_LOCKED`.
- MOQ, kedua endpoint hide, approve, consolidation bulk-status, dan alur RFQ/PO tetap boleh sesuai pengecualian spec.
- Snapshot menyimpan `periods` pada header `meta`; locked read path memakai snapshot `hidden`, bukan `MaterialPurchaseDraft.hidden_at` live.
- Tidak menambah credential, secret, env var, atau dependency baru.

---

### Task 1: Selesaikan prerequisite kalkulasi

**Files:**
- Modify: files/tests dari `api/docs/superpowers/plans/2026-09-19-recommendation-calc-bugs.md`
- Modify: `api/CHANGELOG.md`
- Modify: TODO file yang mencatat tiga bug, bila ada

**Interfaces:**
- Produces: `list()`, `bulkSaveHorizon()`, dan `discontinue-loss` memakai physical stock, size multiplier, dan preferred supplier yang konsisten.

- [ ] **Step 1: Jalankan baseline**
  `cd api && ./node_modules/.bin/vitest run src/tests/recomendation-v2/bulk-horizon.postgres.test.ts src/tests/recomendation-v2/discontinue-loss.service.test.ts src/tests/recomendation-v2.service.test.ts`. Catat failure existing terpisah.

- [ ] **Step 2: Eksekusi plan bug**
  Ikuti exact SQL dan tests pada plan bug: inventory terakhir `<=` target, multiplier memakai `rec.use_size_calc`, preferred supplier memakai `supplier_id ASC`.

- [ ] **Step 3: Jalankan gate prerequisite**
  `cd api && pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Lock implementation tidak dimulai bila bug baru masih gagal.

- [ ] **Step 4: Commit**
  `git -C api add src CHANGELOG.md docs/superpowers/plans/2026-09-19-recommendation-calc-bugs.md && git -C api commit -m "fix: align recommendation calculations before period lock"`

---

### Task 2: Tambah model Prisma dan migration lock

**Files:**
- Modify: `api/prisma/schema.prisma`
- Create: Prisma-generated migration directory `api/prisma/migrations/<generated>_add_recommendation_period_lock/migration.sql` created by the command in Step 3
- Test: `api/src/tests/recomendation-v2/recommendation-period-lock.service.test.ts`

**Interfaces:**
- Produces: `RecommendationLockStatus`, `RecommendationLockView`, `RecommendationPeriodLock`, `RecommendationLockRow`.
- Consumes: period, version, view, material, product status, filter/sort columns, `hidden`, `payload`, and header `meta` from lock spec.

- [ ] **Step 1: Tulis failing persistence test**
  Create lock row, then insert duplicate GENERAL row with same `lock_id`, `view`, `raw_mat_id`, `fg_id_key = 0`; assert DB rejects it. Test DISCONTINUE_FG uses `fg_id_key = fg_id`.

- [ ] **Step 2: Tambah schema**
  Add two enums and two models. Use `@@unique([month, year, version])`, `@@index([month, year, status])`, `@@unique([lock_id, view, raw_mat_id, fg_id_key])`, and `@@index([lock_id, view, type_tag, product_status])`. Keep nullable `fg_id`; derive non-null `fg_id_key`.

- [ ] **Step 3: Generate and validate migration**
  `cd api && npx prisma migrate dev --name add_recommendation_period_lock --create-only && npx prisma validate && npx prisma generate`. Check SQL contains only two enums, two tables, relation cascade, constraints, and indexes.

- [ ] **Step 4: Run test**
  `cd api && ./node_modules/.bin/vitest run src/tests/recomendation-v2/recommendation-period-lock.service.test.ts`.

- [ ] **Step 5: Commit**
  `git -C api add prisma/schema.prisma prisma/migrations src/tests/recomendation-v2/recommendation-period-lock.service.test.ts && git -C api commit -m "feat: add recommendation period lock snapshot schema"`

---

### Task 3: Buat lock module sesuai SOP layer

**Files:**
- Create: `api/src/module/application/recomendation-v2/period-lock/schema.ts`
- Create: `api/src/module/application/recomendation-v2/period-lock/services.ts`
- Create: `api/src/module/application/recomendation-v2/period-lock/controller.ts`
- Create: `api/src/module/application/recomendation-v2/period-lock/routes.ts`
- Modify: `api/src/module/application/recomendation-v2/recomendation-v2.routes.ts`
- Test: `api/src/tests/recomendation-v2/recommendation-period-lock.routes.test.ts`
- Test: `api/src/tests/recomendation-v2/recommendation-period-lock.service.test.ts`

**Interfaces:**
- `schema.ts`: `LockPeriodRequestSchema`, `UnlockPeriodRequestSchema`, `ListLocksQuerySchema`, response DTOs.
- `services.ts`: `createLock(input, actorId)`, `releaseLock(input, actorId)`, `listLocks(input)`, `findActiveLock(month, year)`, `getLockState(month, year)`, `assertPeriodUnlocked(month, year)`.
- `controller.ts`: HTTP adapter only; `routes.ts`: path + validation only.

- [ ] **Step 1: Tulis failing service tests**
  Assert active duplicate returns `PERIOD_LOCKED`; release retains rows; next lock gets version +1; `meta.periods` persists; actor fields persist.

- [ ] **Step 2: Implement schemas**
  Validate integer month `1..12`, year `>= 2000`, note max 255, strict body keys, and Indonesian messages. Use `.partial()` only for update objects.

- [ ] **Step 3: Implement service transaction**
  `createLock` must reject active lock, run live list without pagination for GENERAL, DISCONTINUE_FG, DISCONTINUE_MATERIAL, calculate `max(version) + 1`, and save header/rows/meta in one Prisma transaction. Service gets actor id as argument, never Context. `releaseLock` updates status/timestamps only; rows remain.

- [ ] **Step 4: Implement controller/routes**
  Use existing actor lookup pattern. Register `POST /lock`, `POST /unlock`, `GET /locks` under recommendation routes. Map `PERIOD_LOCKED` to 409 through project error adapter.

- [ ] **Step 5: Run tests**
  `cd api && ./node_modules/.bin/vitest run src/tests/recomendation-v2/recommendation-period-lock.routes.test.ts src/tests/recomendation-v2/recommendation-period-lock.service.test.ts`.

- [ ] **Step 6: Commit**
  `git -C api add src/module/application/recomendation-v2/period-lock src/module/application/recomendation-v2/recomendation-v2.routes.ts src/tests/recomendation-v2/recommendation-period-lock.*.test.ts && git -C api commit -m "feat: add recommendation period lock endpoints"`

---

### Task 4: Tambah snapshot resolver dan locked read path

**Files:**
- Modify: `api/src/module/application/recomendation-v2/period-lock/services.ts`
- Modify: `api/src/module/application/recomendation-v2/recomendation-v2.service.ts`
- Modify: `api/src/module/application/recomendation-v2/discontinue/material-recommendation.service.ts`
- Modify: `api/src/module/application/recomendation-v2/recomendation-v2.controller.ts`
- Modify: `api/src/module/application/recomendation-v2/recomendation-v2.schema.ts`
- Test: `api/src/tests/recomendation-v2.service.test.ts`
- Test: `api/src/tests/recomendation-v2/discontinue-material-recommendation.service.test.ts`
- Test: `api/src/tests/recomendation-v2/recommendation-period-lock.service.test.ts`

**Interfaces:**
- `resolveLockedRows(params, view)` returns `{ data, len, periods, lock }` in live list shape.
- `getLockState(month, year)` returns locked metadata or `{ locked: false, last_version? }`.
- Existing render DTO remains unchanged apart from additive `lock` block.

- [ ] **Step 1: Tulis failing locked-read tests**
  Lock period, mutate recipe/issuance/stock/supplier/MOQ, then assert list/export/Discontinue Material retain payload and metadata. Assert unlocked period reads live values. Cover all five sortBy values, filters, and SQL pagination.

- [ ] **Step 2: Implement snapshot mapper**
  Store live response fields in `payload`, plus SQL fields `material_name`, `barcode`, `category_name`, supplier fields, `type_tag`, `sort_sales`, `sort_current_stock`, `sort_forecast_needed`, `sort_recommendation`, `hidden`, `fg_id`, and `fg_id_key`. Preserve `discontinue_breakdown` and `override_needs`.

- [ ] **Step 3: Implement SQL sort map**
  Map `material_name → material_name`, `barcode → barcode`, `current_stock → sort_current_stock`, `forecast_needed → sort_forecast_needed`, `recommendation_quantity → sort_recommendation`; default `sort_sales DESC`. Never sort JSON in memory.

- [ ] **Step 4: Resolve lock at read start**
  Add resolver before live calculation in `RecomendationV2Service.list`, `export`, and `DiscontinueMaterialRecommendationService.list`. Locked mode uses header `meta.periods`, not current horizon defaults.

- [ ] **Step 5: Run tests**
  `cd api && ./node_modules/.bin/vitest run src/tests/recomendation-v2.service.test.ts src/tests/recomendation-v2/discontinue-material-recommendation.service.test.ts src/tests/recomendation-v2/recommendation-period-lock.service.test.ts`.

- [ ] **Step 6: Commit**
  `git -C api add src/module/application/recomendation-v2 src/tests/recomendation-v2 && git -C api commit -m "feat: read recommendation snapshots for locked periods"`

---

### Task 5: Pasang semua write gates dan resolusi periode by id

**Files:**
- Modify: `api/src/module/application/recomendation-v2/recomendation-v2.service.ts`
- Modify: `api/src/module/application/recomendation-v2/discontinue/discontinue.service.ts`
- Modify: `api/src/module/application/recomendation-v2/discontinue/material-recommendation.service.ts`
- Modify: `api/src/module/application/consolidation/consolidation.service.ts`
- Modify: `api/src/tests/recomendation-v2.routes.test.ts`
- Modify: `api/src/tests/consolidation.routes.test.ts`

**Interfaces:**
- Gated mutations call `assertPeriodUnlocked(month, year)` before state changes.
- ID-only mutations resolve period from `MaterialPurchaseDraft.month/year` or `PurchaseOrderItem.po.po_date`; open PO gate applies only to `DRAFT/SUBMITTED`.

- [ ] **Step 1: Tulis endpoint matrix tests**
  Locked → 409 for bulk-horizon, order, draft delete, bulk-reset, need override, open-po create/update/delete, Discontinue materials bulk, and anchor create/delete. Locked → normal for reset preview, approve, MOQ, both hide endpoints, consolidation bulk-status/hide, and approved/ordered RFQ/PO.

- [ ] **Step 2: Add direct gates**
  Gate body/query period for bulk-horizon, order, bulk-reset, need override, open-po create, Discontinue material bulk, and anchor. Keep preview ungated.

- [ ] **Step 3: Add by-id resolution**
  Resolve draft period before delete. Resolve open PO period from `po_date` using same logic as `listOpenPoCell`; gate only `DRAFT/SUBMITTED`.

- [ ] **Step 4: Preserve exclusions**
  Do not gate MOQ, hide, approve, consolidation status/hide, or RFQ/PO flow. Locked reads use snapshot `hidden`.

- [ ] **Step 5: Run tests**
  `cd api && ./node_modules/.bin/vitest run src/tests/recomendation-v2.routes.test.ts src/tests/recomendation-v2/bulk-horizon.postgres.test.ts src/tests/consolidation.routes.test.ts`.

- [ ] **Step 6: Commit**
  `git -C api add src/module/application/recomendation-v2 src/module/application/consolidation src/tests && git -C api commit -m "feat: enforce recommendation period lock writes"`

---

### Task 6: Integrasikan API client dan UI lock state

**Files:**
- Modify: `app/src/app/(application)/recomendation-v2/server/recomendation-v2.service.ts`
- Modify: `app/src/app/(application)/recomendation-v2/server/recomendation-v2.schema.ts`
- Modify: `app/src/app/(application)/recomendation-v2/server/use.recomendation-v2.ts`
- Modify: `app/src/components/pages/recomendation-v2/index.tsx`
- Modify: `app/src/components/pages/recomendation-v2/print-report.tsx`
- Modify: discontinue Material server files under `app/src/app/(application)/recomendation-v2/discontinue/material/server/`
- Modify: `app/src/components/pages/consolidation/index.tsx`
- Test: focused app logic/query tests for lock state and mutation disabling

**Interfaces:**
- Client exposes `lockRecommendationPeriod`, `unlockRecommendationPeriod`, `listRecommendationLocks`.
- Query result exposes additive `lock`; row rendering DTO stays same.
- One selected month/year lock state controls General, Discontinue, and Consolidation UI.

- [ ] **Step 1: Tulis failing client/state tests**
  Assert metadata mapping, Indonesian `PERIOD_LOCKED` toast, and exact control exceptions.

- [ ] **Step 2: Add API schemas/client methods**
  Use bodies `{ month, year, note? }` and `{ month, year }`; preserve current API base URL and invalidation patterns.

- [ ] **Step 3: Add header controls**
  Unlocked: `Lock Periode`; locked: `Buka Kunci`. Confirmation shows month/year and row counts. History shows version/status/actor/time/note.

- [ ] **Step 4: Apply controls**
  Disable Bulk Save, Bulk Reset, Open PO draft/submitted, anchor, Work Order while locked. Keep approve, MOQ, hide enabled. Show badge `Terkunci v{version} · {actorName} · {formattedLockedAt}`; show same in Consolidation.

- [ ] **Step 5: Verify export/print**
  Existing calls must consume locked response shape and snapshot periods; no live recalculation from current UI defaults.

- [ ] **Step 6: Run frontend checks**
  `cd app && ./node_modules/.bin/vitest run && ./node_modules/.bin/tsc --noEmit && pnpm build`.

- [ ] **Step 7: Commit**
  `git -C app add src && git -C app commit -m "feat: add recommendation period lock controls"`

---

### Task 7: Dokumentasi, full verification, dan handoff

**Files:**
- Modify: `api/README.md`
- Modify: `api/CHANGELOG.md`
- Modify: `app/CHANGELOG.md` bila UI masuk changelog app
- Modify: lock spec, calc spec, calc plan, dan TODO file yang relevan
- Create/modify: API docs file mengikuti format existing module

- [ ] **Step 1: Update API docs**
  Document method/path, session auth, Indonesian validation, response `lock`, `PERIOD_LOCKED` 409, version history, exceptions, and by-id open PO resolution.

- [ ] **Step 2: Update CHANGELOG/TODO/cross-links**
  Add Added period lock, Changed locked read/write behavior, Fixed three prerequisite bugs, and follow-up for generic RFQ/PO bypass if field evidence later requires it. Link all three source docs to this plan.

- [ ] **Step 3: Run all gates**
  `cd api && pnpm typecheck && pnpm lint && pnpm test && pnpm build`; then `cd ../app && ./node_modules/.bin/tsc --noEmit && pnpm build`. Record exact existing failures separately; new lock tests and affected checks must pass.

- [ ] **Step 4: Browser-path verification**
  Start local API/app. Via Playwright, select period, lock, inspect Network response, refresh, verify badge/disabled controls, mutate source data, verify unchanged rows, unlock, verify live values, and verify Consolidation badge. Capture lock, unlock, 409 gate, export, and print evidence.

- [ ] **Step 5: Review diff**
  `git diff --check && git status --short`. Confirm no secrets, accidental env edits, generated churn, or unrelated changes.

- [ ] **Step 6: Commit docs**
  `git -C api add docs README.md CHANGELOG.md && git -C app add CHANGELOG.md && git -C api commit -m "docs: document recommendation period lock"`

## Self-Review Checklist

- [ ] Calc prerequisite precedes first production lock.
- [ ] Data model, all views, versioning, release history, and `fg_id_key` covered.
- [ ] List, export, print response, Discontinue Material, Consolidation, and RFQ/PO badge behavior covered.
- [ ] All write gates and exceptions covered.
- [ ] By-id period resolution covered.
- [ ] Five sort options use dedicated SQL columns.
- [ ] Locked hidden state uses snapshot value.
- [ ] Indonesian validation and standard 409 response covered.
- [ ] Tests, typecheck, lint/check, build, docs, and browser proof covered.
