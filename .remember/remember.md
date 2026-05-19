<<<<<<< HEAD
=======
# Handoff

## State
Phase A (outlet_inventories month/year migration) + Phase B (stock-distribution module FG+RM at `inventory/monitoring/stock-distribution/`) shipped to branch `dev`. Both sub-services hardened per backend-code-review: helpers (xInclude, buildWhere, dbOrderBy, assembleMatrix), UNKNOWN_LABEL constant, `period` object, dedicated `listSortedByTotal()` path for cross-page total_stock ranking, Zod enums from Prisma (`z.enum(GENDER)`, `z.enum(MaterialType)`). Service-level tests 100% green (15/15 stock-distribution + 59/59 adjacent).

## Next
1. Apply outlet migration SQL: `prisma/migrations/20260519140000_outlet_inventory_period/migration.sql` once local Postgres version mismatch is resolved (gitignored, exists locally only).
2. Module docs via `module-documentation` skill for `inventory/monitoring/stock-distribution/` + Postman collection + frontend-integration registry.
3. Optional: investigate the 27 pre-existing 401 route test failures (`outlet.routes.test.ts`, `outlet-inventory.routes.test.ts`) — needs auth fixture in `src/tests/setup.ts`. Orthogonal to Phase A/B.

## Context
- Stock-distribution module pattern is the canonical template for any matrix-view monitoring module: separate sub-modules per item type, `_shared/` for csv + period helpers, ORM-only (no raw SQL), `listSortedByTotal()` for computed-column sorting.
- `prisma/migrations/` is gitignored — migrations are per-developer; commit `schema.prisma` only.
- Specs at `api/docs/superpowers/specs/2026-05-19-*.md`, plans at `api/docs/superpowers/plans/2026-05-19-*.md`.
- `inventory-v2` is slated for deprecation — keep new monitoring work under `inventory/monitoring/`.
>>>>>>> a379a2d (refactor(stock-distribution/rm): refactor category and unit routes, add indexes and unit tests)
