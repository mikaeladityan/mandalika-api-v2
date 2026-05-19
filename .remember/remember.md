# Handoff

## State
Phase A (outlet_inventories month/year migration) + Phase B (stock-distribution module FG+RM at `inventory/monitoring/stock-distribution/`) shipped to branch `staging`. Per-scope FE integration docs (10 files) split into kontrak BE→FE format: §0-§8 with schema verbatim, routing endpoint table, service FULL CODE, hooks FULL CODE, Mermaid flows, edge cases. Components/testing delegated to `frontend-dev-flow` & `frontend-testing` skills. Module-doc skill updated to match.

## Next
1. Apply outlet migration SQL: `prisma/migrations/20260519140000_outlet_inventory_period/migration.sql` (gitignored — exists locally only) once Postgres version mismatch resolved.
2. Push staging: branch is `ahead 24` of `origin/staging` after rebase.
3. Optional: investigate the 27 pre-existing 401 route test failures (`outlet.routes.test.ts`, `outlet-inventory.routes.test.ts`) — needs auth fixture in `src/tests/setup.ts`.
4. Anomaly found by subagent during retrofit: `PUT /api/app/inventory/rm/:id` (update) returns **201** instead of 200 — controller deviation flagged in `rm/frontend-integration.md` §7.

## Context
- Stock-distribution module pattern is canonical template for matrix-view monitoring: separate sub-modules per item type, `_shared/` helpers, ORM-only, `listSortedByTotal()` for computed-column sort.
- `prisma/migrations/` and `.claude/` and `.remember/` all gitignored — local only.
- Specs: `api/docs/superpowers/specs/2026-05-19-*.md`. Plans: `api/docs/superpowers/plans/2026-05-19-*.md`.
- Per-scope FE doc structure (skill §6.6): §0 meta, §1 schema BE verbatim, §2 FE mirror, §3 routing table, §4 service FULL CODE, §5 hooks 5-split, §6 Mermaid, §7 edge cases, §8 cross-link. **No** component snippets, **no** testing stubs — those live in frontend skills.
- Module-level `frontend-integration.md` is TIPIS (~127 lines) — path mirror, global conventions, per-scope index. **No** schema/code detail there.
- `inventory-v2` slated for deprecation — keep new work under `inventory/`.
