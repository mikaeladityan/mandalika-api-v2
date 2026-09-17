# FG Discontinue Material Recommendation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ubah halaman FG Discontinue menjadi satu rekomendasi per raw material dengan agregasi lintas FG, breakdown audit, Work Order PENDING tunggal per RM, dan Consolidation yang konsisten.

**Architecture:** Reuse endpoint Recommendation-v2 dengan `product_status=PENDING`, tetapi branch PENDING mengaggregate kebutuhan recipe per RM sebelum stock/Open PO deduction. Work Order tetap memakai `material_purchase_drafts` dan `product_status`; UI memakai tabel Recommendation-v2 existing dengan detail breakdown.

**Tech Stack:** Hono, Prisma/PostgreSQL, TypeScript, Vitest, Next.js, React Query, TanStack Table.

**Spec:** `docs/superpowers/specs/2026-09-17-discontinue-material-recommendation-design.md`

## Global Constraints

- Backend tetap mengikuti layer schema → service → controller → routes.
- Backend TDD wajib: failing test sebelum production code.
- Stock/Open PO dikurangi satu kali setelah gross need semua FG diagregasi.
- `ACTIVE` Work Order General dan `PENDING` Work Order Discontinue tetap terpisah.
- Jangan memasukkan `FO-ALK` ke kebutuhan Discontinue.
- Jangan menyertakan `.env.local` dalam commit.

### Task 1: Aggregate Discontinue requirements

**Files:**
- Modify: `src/module/application/recomendation-v2/discontinue/discontinue.service.ts`
- Test: `src/tests/recomendation-v2/discontinue.service.test.ts`

**Interfaces:**
- Produce `aggregateDiscontinueNeeds(needs)` returning `Map<number, { total_needed: number; breakdown: ...[] }>`.
- Preserve `DiscontinueService.purchases(month, year)` gross aggregate behavior.

- [x] Write failing test: two pending FGs sharing RM 20 produce one RM total `90` from needs `50 + 40`, with two breakdown entries.
- [x] Run `./node_modules/.bin/vitest run src/tests/recomendation-v2/discontinue.service.test.ts` and confirm failure.
- [x] Implement decimal-safe aggregation helper and expose breakdown type.
- [x] Run targeted test and confirm pass.

### Task 2: Return one PENDING recommendation row per RM

**Files:**
- Modify: `src/module/application/recomendation-v2/recomendation-v2.service.ts`
- Modify: `src/module/application/recomendation-v2/recomendation-v2.schema.ts`
- Test: `src/tests/recomendation-v2.service.test.ts`

**Interfaces:**
- PENDING response adds `discontinue_breakdown` containing FG identity, anchor, and contribution quantity.
- ACTIVE response behavior remains unchanged.

- [x] Write failing test: PENDING list with rows for two FGs sharing RM returns one row, summed recommendation quantity, and both FG breakdown items.
- [x] Run targeted recommendation test and confirm failure.
- [x] Implement PENDING aggregation after SQL recipe/anchor calculation and before pagination/count/export mapping.
- [x] Ensure type filter applies before aggregation and stock/Open PO deduction occurs once per RM.
- [x] Run targeted tests and confirm pass.

### Task 3: Add transparent breakdown UI

**Files:**
- Modify: `app/src/app/(application)/recomendation-v2/server/recomendation-v2.schema.ts`
- Modify: `app/src/components/pages/recomendation-v2/table/column.tsx`
- Test: existing app typecheck and UI verification.

**Interfaces:**
- Consume `discontinue_breakdown` from API.
- Render compact FG count/details in Material cell or dedicated detail component without removing Work Order action.

- [x] Add response type for breakdown.
- [x] Render breakdown for PENDING rows; keep General table unchanged.
- [x] Run app `tsc --noEmit`.
- [ ] Verify Discontinue page visually: one shared RM row, FG contributors visible, Work Order button visible.

### Task 4: Align bulk Work Order and Consolidation

**Files:**
- Modify: `src/module/application/recomendation-v2/recomendation-v2.service.ts`
- Modify: `src/module/application/consolidation/consolidation.service.ts`
- Test: `src/tests/recomendation-v2.service.test.ts`
- Test: `src/tests/consolidation.service.test.ts`

- [x] Write failing tests for PENDING bulk horizon using aggregated RM rows and Consolidation filtering only PENDING drafts.
- [x] Run targeted tests and confirm failure.
- [x] Update bulk SQL conflict/update scope to `product_status=PENDING`.
- [x] Confirm Consolidation list, summary, and export use same PENDING scope.
- [x] Run targeted tests and confirm pass.

### Task 5: Documentation and gates

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `TODO.md`
- Modify: `docs/api-recomendation-v2.md`
- Modify: `docs/superpowers/specs/2026-09-17-discontinue-material-recommendation-design.md`

- [x] Document aggregate response and breakdown contract.
- [x] Run API typecheck, targeted tests, build, and Prisma validate.
- [ ] Full API suite (known unrelated failures remain outside this scope).
- [ ] Run app build/visual verification (blocked by local Turbopack process permission).
- [x] Review `git diff --check`, status, and ensure `.env.local` excluded.
- [ ] Commit backend and frontend changes separately, then push after verification.
