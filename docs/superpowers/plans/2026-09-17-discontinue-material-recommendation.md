# Separate FG Discontinue Material Recommendation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pulihkan list FG Discontinue existing dan sediakan module/page baru untuk rekomendasi serta Work Order raw material Discontinue yang diagregasi per RM.

**Architecture:** `RecomendationV2Service.list()` kembali menghasilkan list FG × RM tanpa agregasi. Module baru `discontinue-material-recommendation` memanggil list PENDING tanpa pagination, mengaggregate kebutuhan per RM, mengurangi stock/Open PO sekali, lalu melakukan pagination sendiri. Frontend page baru memakai tabel existing melalui data-source khusus tanpa mengubah page Discontinue lama.

**Tech Stack:** Hono, Prisma/PostgreSQL, Zod, TypeScript, Vitest, Next.js, React Query, TanStack Table.

**Spec:** `docs/superpowers/specs/2026-09-17-discontinue-material-recommendation-design.md`

## Global Constraints

- Backend mengikuti `schema.ts` → `service.ts` → `controller.ts` → `routes.ts` → registration.
- Backend TDD wajib: test gagal sebelum production code.
- Page `/recomendation-v2/discontinue` tetap list FG × RM.
- Page `/recomendation-v2/discontinue/material` satu row per RM.
- Gross need seluruh FG dijumlahkan sebelum stock/Open PO dikurangi satu kali.
- Work Order agregat memakai `product_status=PENDING`; Work Order General tetap `ACTIVE`.
- `FO-ALK` tidak masuk rekomendasi Discontinue.
- `.env.local` tidak boleh masuk commit.

---

### Task 1: Restore existing FG Discontinue list contract

**Files:**
- Modify: `src/module/application/recomendation-v2/recomendation-v2.service.ts`
- Modify: `src/module/application/recomendation-v2/recomendation-v2.schema.ts`
- Test: `src/tests/recomendation-v2.service.test.ts`

**Interfaces:**
- Produces: `RecomendationV2Service.list({ product_status: "PENDING" })` returning one row per `FG + RM`, `row_id = "<fg_id>_<material_id>"`.
- Preserves: SQL pagination and count behavior for existing endpoint.

- [ ] **Step 1: Change existing test expectation back to FG × RM**

```ts
expect(result.data.map((row) => row.row_id)).toEqual(["1_7", "2_7"]);
expect(result.data[0]?.finished_goods).toEqual([{ id: 1, code: "FG-1", name: "VAMO" }]);
expect(result.data[1]?.finished_goods).toEqual([{ id: 2, code: "FG-2", name: "Discontinue 2" }]);
```

- [ ] **Step 2: Run RED test**

Run: `./node_modules/.bin/vitest run src/tests/recomendation-v2.service.test.ts --reporter=dot`

Expected: FAIL because current code returns one aggregated row with `row_id="7"`.

- [ ] **Step 3: Restore existing list implementation**

Restore final SQL `LIMIT ${limit} OFFSET ${skip}`, `COUNT(rm.id)`, direct `rows.map(...)` return, and remove RM aggregation from `RecomendationV2Service.list()`. Keep `aggregateDiscontinueNeeds()` for new module.

- [ ] **Step 4: Run GREEN test and commit**

Run: `./node_modules/.bin/vitest run src/tests/recomendation-v2.service.test.ts --reporter=dot`

```bash
git add src/module/application/recomendation-v2/recomendation-v2.service.ts src/module/application/recomendation-v2/recomendation-v2.schema.ts src/tests/recomendation-v2.service.test.ts
git commit -m "fix(recommendation): restore discontinue FG list"
```

### Task 2: Add dedicated material recommendation module

**Files:**
- Create: `src/module/application/recomendation-v2/discontinue/material-recommendation.schema.ts`
- Create: `src/module/application/recomendation-v2/discontinue/material-recommendation.service.ts`
- Create: `src/module/application/recomendation-v2/discontinue/material-recommendation.controller.ts`
- Create: `src/tests/recomendation-v2/discontinue-material-recommendation.service.test.ts`

**Interfaces:**
- Consumes: `RecomendationV2Service.list(query)` FG × RM rows.
- Produces: `DiscontinueMaterialRecommendationService.list(query)` returning `{ data, len, periods }`.
- Output row extends recommendation row with `row_id=String(material_id)`, all `finished_goods`, and `discontinue_breakdown`.

- [ ] **Step 1: Write failing shared-RM test**

```ts
it("aggregates shared RM into one purchase recommendation", async () => {
  vi.spyOn(RecomendationV2Service, "list").mockResolvedValue(fgRows as never);
  const result = await DiscontinueMaterialRecommendationService.list({ page: 1, take: 25, month: 9, year: 2026 });
  expect(result.data).toHaveLength(1);
  expect(result.data[0]).toMatchObject({ row_id: "7", material_id: 7, recommendation_quantity: 60 });
  expect(result.data[0]?.finished_goods).toHaveLength(2);
  expect(result.data[0]?.discontinue_breakdown).toHaveLength(2);
});
```

Fixture: contributions `50 + 40`, stock `20`, Open PO `10`; recommendation `60`.

- [ ] **Step 2: Run RED test**

Run: `./node_modules/.bin/vitest run src/tests/recomendation-v2/discontinue-material-recommendation.service.test.ts --reporter=dot`

Expected: FAIL because module does not exist.

- [ ] **Step 3: Add Indonesian Zod schemas**

Define `QueryDiscontinueMaterialRecommendationSchema` with pagination, period, search, type, sort/order. Define `DiscontinueBreakdownSchema` with `product_id`, `fg_code`, `fg_name`, `contribution_quantity`, `anchor_material_id`, `anchor_material_name`.

- [ ] **Step 4: Implement aggregation service**

```ts
static async list(query: QueryDiscontinueMaterialRecommendationDTO) {
  const source = await RecomendationV2Service.list({ ...query, page: 1, take: 1_000_000, product_status: "PENDING" });
  const rows = aggregateRowsByMaterial(source.data);
  const skip = (query.page - 1) * query.take;
  return { ...source, data: rows.slice(skip, skip + query.take), len: rows.length };
}
```

`aggregateRowsByMaterial` sums valid `discontinue_anchor.total_needed`, merges unique FG, and computes `max(0, grossNeed - current_stock - open_po)` once.

- [ ] **Step 5: Add HTTP-only controller**

Controller parses query, calls service, wraps `ApiResponse.sendSuccess(c, result, 200)`.

- [ ] **Step 6: Run GREEN test, typecheck, commit**

Run: `./node_modules/.bin/vitest run src/tests/recomendation-v2/discontinue-material-recommendation.service.test.ts --reporter=dot`

Run: `./node_modules/.bin/tsc --noEmit`

```bash
git add src/module/application/recomendation-v2/discontinue/material-recommendation.* src/tests/recomendation-v2/discontinue-material-recommendation.service.test.ts
git commit -m "feat(recommendation): add discontinue material module"
```

### Task 3: Register dedicated route

**Files:**
- Modify: `src/module/application/recomendation-v2/discontinue/discontinue.routes.ts`
- Test: `src/tests/recomendation-v2.routes.test.ts`

**Interfaces:**
- Produces: `GET /api/app/recomendations/discontinue/materials`.

- [ ] **Step 1: Write failing route test**

```ts
const response = await app.request("/recommendations/discontinue/materials?page=2&take=25&month=9&year=2026&type=ffo");
expect(response.status).toBe(200);
expect(listMaterials).toHaveBeenCalledWith(expect.objectContaining({ page: 2, take: 25, type: "ffo" }));
```

- [ ] **Step 2: Run RED test**

Run: `./node_modules/.bin/vitest run src/tests/recomendation-v2.routes.test.ts --reporter=dot`

Expected: FAIL with 404 or controller spy not called.

- [ ] **Step 3: Register route and run GREEN**

```ts
routes.get("/materials", DiscontinueMaterialRecommendationController.list);
```

Run: `./node_modules/.bin/vitest run src/tests/recomendation-v2.routes.test.ts --reporter=dot`

- [ ] **Step 4: Commit route**

```bash
git add src/module/application/recomendation-v2/discontinue/discontinue.routes.ts src/tests/recomendation-v2.routes.test.ts
git commit -m "feat(recommendation): expose discontinue material endpoint"
```

### Task 4: Add frontend page and data source

**Files:**
- Create: `app/src/app/(application)/recomendation-v2/discontinue/material/page.tsx`
- Create: `app/src/app/(application)/recomendation-v2/discontinue/material/server/discontinue-material.schema.ts`
- Create: `app/src/app/(application)/recomendation-v2/discontinue/material/server/discontinue-material.service.ts`
- Create: `app/src/app/(application)/recomendation-v2/discontinue/material/server/use.discontinue-material.ts`
- Modify: `app/src/components/pages/recomendation-v2/index.tsx`
- Modify: `app/src/components/pages/recomendation-v2/table/column.tsx`
- Modify: `app/src/app/(application)/recomendation-v2/discontinue/layout.tsx`

**Interfaces:**
- Produces: `DiscontinueMaterialService.list(query)` calling `/recomendations/discontinue/materials`.
- Produces: `RecomendationV2` prop `dataSource?: "default" | "discontinue-material"`.
- Existing page omits prop and remains on default endpoint.

- [ ] **Step 1: Add response/query types, service, and React Query hook**

`DiscontinueMaterialRecommendationRow` extends existing row with required `discontinue_breakdown`. Query key: `["recomendation-v2", "discontinue-material", query]`.

- [ ] **Step 2: Wire dedicated data source into reusable table**

When `dataSource === "discontinue-material"`, read dedicated hook. Existing `/discontinue` keeps `useRecomendationV2` unchanged. Work Order mutations remain shared and send `product_status=PENDING`.

- [ ] **Step 3: Render breakdown only on material page**

Pass `showDiscontinueBreakdown` to columns; render `Kebutuhan: <quantity>` beside contributor only when true.

- [ ] **Step 4: Create page and navigation tab**

```tsx
<RecomendationV2
  title="Rekomendasi RM FG Discontinue"
  description="Kebutuhan gabungan raw material seluruh FG Discontinue."
  productStatus="PENDING"
  dataSource="discontinue-material"
/>
```

Add tab `Rekomendasi RM` linking `/recomendation-v2/discontinue/material`; exact pathname determines active tab.

- [ ] **Step 5: Run typecheck and commit**

Run: `./node_modules/.bin/tsc --noEmit`

```bash
git add src/app/'(application)'/recomendation-v2/discontinue/material src/app/'(application)'/recomendation-v2/discontinue/layout.tsx src/components/pages/recomendation-v2/index.tsx src/components/pages/recomendation-v2/table/column.tsx
git commit -m "feat(recommendation): add discontinue material page"
```

### Task 5: Verify Work Order, Consolidation, docs, and release

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `TODO.md`
- Modify: `docs/api-recomendation-v2.md`
- Test: `src/tests/recomendation-v2.service.test.ts`
- Test: `src/tests/consolidation.service.test.ts`

**Interfaces:**
- Work Order remains `POST /api/app/recomendations/order` with `product_status=PENDING`.
- Consolidation remains `GET /api/app/consolidation?product_status=PENDING`.

- [ ] **Step 1: Verify PENDING scope assertions**

```ts
expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
  where: { raw_mat_id_month_year_product_status: expect.objectContaining({ product_status: "PENDING" }) },
}));
expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
  where: expect.objectContaining({ product_status: "PENDING" }),
}));
```

- [ ] **Step 2: Run targeted backend suite**

Run: `./node_modules/.bin/vitest run src/tests/recomendation-v2.service.test.ts src/tests/recomendation-v2.routes.test.ts src/tests/recomendation-v2/discontinue.service.test.ts src/tests/recomendation-v2/discontinue-material-recommendation.service.test.ts src/tests/consolidation.service.test.ts src/tests/consolidation.routes.test.ts --reporter=dot`

- [ ] **Step 3: Update docs**

Document existing FG list, material endpoint/page, aggregate formula, PENDING Work Order, and PENDING Consolidation.

- [ ] **Step 4: Run gates**

API: `./node_modules/.bin/tsc --noEmit`, `./node_modules/.bin/tsc`, `./node_modules/.bin/prisma validate`, targeted tests, full test with unrelated failures reported separately.

App: `./node_modules/.bin/tsc --noEmit`, targeted lint if config works, build if sandbox allows Turbopack process binding.

- [ ] **Step 5: Review, commit docs, push**

Run `git diff --check` in both repos. Confirm app only leaves `.env.local` untracked.

```bash
git add CHANGELOG.md TODO.md docs/api-recomendation-v2.md docs/superpowers/plans/2026-09-17-discontinue-material-recommendation.md
git commit -m "docs(recommendation): document discontinue material module"
git push origin main
```
