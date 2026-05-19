# Inventory / Monitoring

Sub-modul read-only untuk visibility stok dan reporting matrix di dalam Inventory.

**Base path**: `/api/app/inventory/monitoring`
**Source**: `src/module/application/inventory/monitoring/`
**Routes aggregator**: `monitoring.routes.ts` (mount sub-modul monitoring di bawah `/inventory/monitoring`).
**Frontend integration**: lihat [../frontend-integration.md](../frontend-integration.md) — schema mirror, service, hooks, component map untuk seluruh sub-modul inventory (termasuk monitoring).

---

## Sub-modul

| Sub                          | Mount path                                                    | Source                                                                          | Status   | Dok                                                                |
| :--------------------------- | :------------------------------------------------------------ | :------------------------------------------------------------------------------ | :------- | :----------------------------------------------------------------- |
| Stock Distribution / FG      | `/api/app/inventory/monitoring/stock-distribution/fg`         | `src/module/application/inventory/monitoring/stock-distribution/fg`             | ✅ Ready | [stock-distribution/README.md](./stock-distribution/README.md)     |
| Stock Distribution / RM      | `/api/app/inventory/monitoring/stock-distribution/rm`         | `src/module/application/inventory/monitoring/stock-distribution/rm`             | ✅ Ready | [stock-distribution/README.md](./stock-distribution/README.md)     |

> Modul matrix view existing di `inventory-v2/monitoring/stock-total` masih hidup berdampingan. Setelah FE migrasi ke `stock-distribution`, modul `stock-total` di-deprecate.

---

## Konvensi modul monitoring

- **Read-only**: semua endpoint hanya `GET`. Mutasi inventory dilakukan di modul mutasi (FG, RM, GR, DO, TG, Return).
- **ORM-first**: monitoring di-folder ini wajib pakai Prisma ORM (`findMany`, `groupBy`, `count`). Hindari raw SQL kecuali ada batasan teknis yang dibuktikan via PR review (lihat [backend-code-review §sqlalchemy-rule "Prefer Prisma methods over Raw SQL"](../../../../.claude/skills/backend-code-review/references/sqlalchemy-rule.md)).
- **Period filter**: query `?month=&year=` opsional, default ke bulan & tahun berjalan via helper `resolvePeriod(month, year)` di `stock-distribution/_shared/matrix.helpers.ts`.
- **Matrix view SOP**: untuk modul "rows × dynamic location columns" (mis. stock-distribution), pakai pattern:
  - Service helpers private statis: `xInclude()`, `buildWhere()`, `dbOrderBy()`, `assembleMatrix()`.
  - Dedicated path `listSortedByTotal()` saat `sortBy=total_stock` (fetch all IDs → `groupBy` → sort → slice page → load detail in order). Sort dalam memory per-page TIDAK cukup karena pagination dilakukan DB sebelum kolom terkomputasi diketahui.
  - Enum filter via `z.enum(<PrismaEnum>)` dari `generated/prisma/client`, **bukan** hardcoded literal.
- **Status code**: semua endpoint return `200`. Tidak ada create/enqueue di sub-modul monitoring.
- **CSV export**: pakai `buildDynamicCsv` dari `stock-distribution/_shared/csv.helpers.ts` untuk kolom statis + dinamis (per lokasi).

---

## Frontend integration

Frontend modul monitoring mirror struktur backend:

- Module folder: `app/src/app/(application)/inventory/monitoring/`
- Components: `app/src/components/pages/inventory/monitoring/`

Status saat ini: **🚧 FE belum diimplementasikan** (per 2026-05-19). Schema mirror, service registry, hooks registry, dan component map ada di [../frontend-integration.md](../frontend-integration.md).
