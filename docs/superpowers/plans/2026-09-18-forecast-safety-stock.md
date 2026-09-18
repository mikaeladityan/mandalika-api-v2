# Forecast Safety Stock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Forecast Safety Stock with ERP sales, persisted service-level selection, outlet detail and product summary.

**Architecture:** Read-only Hono module over OutletIssuance, with pure sample-SD calculations and server-side grouping/sorting. Next.js page uses React Query and client localStorage; no DB migration or forecast-engine mutation.

**Tech Stack:** TypeScript, Zod 4, Hono, Prisma/PostgreSQL, Vitest, Next.js 16, React 19, TanStack Query/Table.

**Spec:** `../specs/2026-09-18-forecast-safety-stock-design.md`

## Global Constraints

- Follow schema.ts → services.ts → controller.ts → routes.ts → registration; write failing tests before each production layer.
- Services have no HTTP Context, response status, or HTTP ApiError.
- Indonesian validation and UI; default service level 80; preset values exactly as spec.
- Day 1–28 only; sample SD; CEIL per outlet before summary; Discontinue=PENDING always below ACTIVE before pagination.
- No snapshot, migration, export, stock mutation, Product.z_value mutation, or environment change.
- Preserve untracked App `.env.local` and unrelated edits. Execute inline; no delegation required.
- Paths below are relative to workspace `erp/`; commands run inside indicated repository.

## Task 1: Query/response schemas and numerical engine

**Create:** `api/src/module/application/forecast/safety-stock/schema.ts`, `calculation.ts`, `services.ts`; `api/src/tests/forecast/safety-stock.schema.test.ts`, `safety-stock.calculation.test.ts`, `safety-stock.service.test.ts`.

**Interfaces:** `QuerySafetyStockSchema`, `QuerySafetyStockSummarySchema`, inferred `QuerySafetyStockDTO` / `QuerySafetyStockSummaryDTO`, detail/summary response schemas matching spec. `SERVICE_LEVEL_Z` numeric lookup; `calculateSafetyStock(weeks: [number,number,number,number], serviceLevel: number)` returns `total_sales`, `weekly_average`, `standard_deviation`, `z_value`, `safety_stock`, `buffer_weeks`. `SafetyStockService.list(query)` and `.summary(query)` return spec payload.

- [x] Write schema tests: month 0/13, noninteger year, nonpositive IDs, service level 100/81 rejected; 97.5 accepted; default service_level 80, page 1, take 50; take >100 rejected. Run `./node_modules/.bin/vitest run src/tests/forecast/safety-stock.schema.test.ts` in api; confirm expected missing-module failure.
- [x] Implement schema first, including response nullable fields, Indonesian messages and sort whitelists. Rerun schema test green.
- [ ] Write numerical tests before helper implementation:

```ts
expect(calculateSafetyStock([11, 9, 15, 10], 80)).toMatchObject({
  total_sales: 45, weekly_average: 11.25, safety_stock: 3,
});
expect(calculateSafetyStock([11, 9, 15, 10], 80).buffer_weeks).toBeCloseTo(3 / 11.25);
expect(calculateSafetyStock([2, 2, 2, 2], 80).safety_stock).toBe(0);
expect(calculateSafetyStock([0, 0, 0, 0], 80).buffer_weeks).toBeNull();
expect(calculateSafetyStock([-4, 0, 0, 0], 80).buffer_weeks).toBeNull();
expect(calculateSafetyStock([11, 9, 15, 10], 80).standard_deviation)
  .toBeCloseTo(Math.sqrt(20.75 / 3));
```

- [x] Run `./node_modules/.bin/vitest run src/tests/forecast/safety-stock.calculation.test.ts`; confirm red. Implement exact lookup and formula from spec, then rerun green.
- [ ] Write service fixtures: two outlets each `[11,9,15,10]` → summary sales 90, SS 6, ratio 15, buffer percentage `6/90*100`; filtering detail to one outlet does not reduce summary. Missing records yields has_data false; explicit zero record yields true. ACTIVE low SS must precede PENDING high SS for descending SS and take=1.
- [ ] Add date fixtures day 7/8, 14/15, 21/22, 28/29 and February 29; only 1–28 contribute. Assert query uses UTC bounds and filters nondeleted ACTIVE/PENDING products. Assert selected master pair with no transactions remains a zero row.
- [x] Run service tests red, implement DB aggregation using batched Prisma reads (no per-pair queries), calculate rows, status-first sort and paginate. Build summary from all outlet results before pagination. Rerun all three files green.

## Task 2: HTTP controller, routes and registration

**Create:** `api/src/module/application/forecast/safety-stock/controller.ts`, `routes.ts`; `api/src/tests/forecast/safety-stock.routes.test.ts`.
**Modify:** `api/src/module/application/forecast/forecast.routes.ts`.
**Interfaces:** `SafetyStockController.list/summary(c: Context)`; `SafetyStockRoutes` mounted at `/safety-stock`; GET `/` and `/summary`.

- [x] Reuse route harness pattern and mock new service at HTTP boundary. Test detail/summary success, invalid month 400, and route registration separately in existing Forecast suite.
- [x] Run `./node_modules/.bin/vitest run src/tests/forecast/safety-stock.routes.test.ts` red.
- [x] Implement controller as query parse → service → `ApiResponse.sendSuccess(c,result,200,params)`. Implement routes using `validate(QuerySafetyStockSchema)` / summary schema; register before `/:product_id`.

```ts
SafetyStockRoutes.get('/summary', validate(QuerySafetyStockSummarySchema), SafetyStockController.summary);
SafetyStockRoutes.get('/', validate(QuerySafetyStockSchema), SafetyStockController.list);
// forecast.routes.ts, before parameterized routes:
ForecastRoutes.route('/safety-stock', SafetyStockRoutes);
```

- [x] Rerun routes plus Task 1 tests green. Verify services import neither Hono nor HTTP error helpers.

## Task 3: Frontend contracts, persistence and queries

**Create:** `app/src/app/(application)/forecasts/safety-stock/server/safety-stock.schema.ts`, `safety-stock.service.ts`, `safety-stock.preferences.ts`, `use.safety-stock.ts`; `app/src/tests/forecast/safety-stock.preferences.test.ts`, `safety-stock.query.test.ts`, `app/vitest.config.ts`.
**Modify:** `app/package.json` and its existing lockfile only for Vitest dev dependency and `test` script; do not mix package managers.
**Interfaces:** mirror API query/row DTOs; `SafetyStockService.list/summary` use existing Axios client/envelope convention; `readServiceLevel(storage: Pick<Storage,'getItem'>): number`, `writeServiceLevel(storage: Pick<Storage,'setItem'>, level: number): void`; `buildSafetyStockQuery(state, tab)` strips outlet_id for summary; `useSafetyStockPreferences()` exposes serviceLevel, setServiceLevel, ready; queries disabled until ready.

- [ ] Add minimal Vitest config using Node environment for pure logic tests. Write tests first with injected storage: absent→80, saved 95→95, JSON corrupt/81/100→80, throwing storage→80, write 99.5→JSON number, summary excludes outlet_id and detail retains it.

```ts
expect(readServiceLevel({ getItem: () => '95' })).toBe(95);
expect(readServiceLevel({ getItem: () => '81' })).toBe(80);
expect(readServiceLevel({ getItem: () => { throw new Error('blocked'); } })).toBe(80);
const setItem = vi.fn();
writeServiceLevel({ setItem }, 99.5);
expect(setItem).toHaveBeenCalledWith('forecast.safety-stock.service-level.v1', '99.5');
```

- [ ] Run frontend test script red; implement contract, API service and storage helpers. Use try/catch around storage; only persist user changes after hydration. Rerun green.
- [ ] Implement query hooks following `inventory-turnover/server/use.forecast.inventory-turnover.ts`: keys include tab and effective params, filters reset page, summary excludes outlet, use state readiness to avoid initial request at wrong Z.
- [ ] Validate schema parity and test query-param construction for all service levels, month/year, pagination and sorting. Run App typecheck.

## Task 4: Page, tables and browser proof

**Create:** `app/src/app/(application)/forecasts/safety-stock/page.tsx`; `app/src/components/pages/forecast/safety-stock/index.tsx`, `filters.tsx`, `detail-columns.tsx`, `summary-columns.tsx`.
**Modify:** `app/src/components/layouts/sidebar/config.tsx`.
**Consumes:** Task 3 hooks/DTOs; API owns ordering and pagination.

- [x] Build page using existing Forecast page/auth/layout pattern; add sidebar child `Safety Stock` at `/forecasts/safety-stock`.
- [x] Add two tabs and filters. Service select labels include percentage and Z four decimals. Show explicit day 1–28 period, all-outlet summary scope, and simulation caveat. No date-start input.
- [x] Render integer SS, decimal metrics and null em dash. Style PENDING rows pale red with readable dark-mode equivalent and Discontinue badge. Do not let client sorting override server status grouping.
- [x] Add loading, retry/error, empty and no-record row states. Distinguish request failure from zero sales.
- [ ] Use webapp-testing skill for browser checks through frontend origin. Confirm menu navigation, month/year request bounds, product/outlet filters, both tabs, zero data label and Discontinue placement across pages and descending SS.
- [ ] Change service level to 95, refresh, verify select and Network request remain 95. Set malformed storage, refresh, verify 80. Compare API/visible PMS fixture SS=3 and two-outlet summary SS=6; inspect console and Network for failures. Capture evidence without modifying production sales.

## Task 5: Documentation and full quality gates

**Create:** `api/docs/api-forecast-safety-stock.md`.
**Modify:** `api/TODO.md`, `api/CHANGELOG.md`, `app/CHANGELOG.md`, `app/README.md` for new test script. This spec records architectural choice; no environment documentation change required.

- [ ] Document GET paths, inherited auth, no body, every query/default, envelope, row schemas and 400/auth/500 behavior. Explicitly document summary all-outlet scope, CEIL-per-outlet and local browser persistence.
- [ ] Mark implementation checklist done only as completed; changelogs describe shipped behavior only. Keep planning completion separate from feature completion.
- [x] In api run `./node_modules/.bin/tsc --noEmit`, direct Vitest, and `./node_modules/.bin/tsc` build. Typecheck/build pass; targeted 15/15 pass. Full suite remains baseline red (1,161 pass, 165 fail, 19 skip). API has no lint configuration.
- [x] App typecheck passed before environment dependency reinstall was attempted. Lint/build/browser remain blocked after pnpm attempted a network install and failed with no-TTY/network errors; no pass claim made.
- [x] Run diff checks and inspect tracked changes. `.env.local` remains untracked and unstaged. Mandatory gates remain partially blocked as recorded above.
- [x] Review spec coverage and prepare branch changes for review. Browser evidence is blocked by App dependency state. No commit/push performed.

## Planning review

Each approved requirement maps to Tasks 1–4; documentation and gates map to Task 5. Scope assumptions: default current month, all nondeleted ACTIVE/PENDING FG and outlet master pairs, no export, storage per browser. These are explicit so review can adjust them before execution.
