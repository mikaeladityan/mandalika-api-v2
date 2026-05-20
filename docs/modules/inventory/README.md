# Inventory Module

Sub-modul inventaris terpadu untuk ERP Mandalika.

**Base path**: `/api/app/inventory`
**Source**: `src/module/application/inventory/`
**Routes aggregator**: `inventory.routes.ts` (mengelompokkan FG dan RM di bawah `/inventory`)
**Frontend integration**: [frontend-integration.md](./frontend-integration.md) — schema mirror, service, hooks, component map untuk seluruh sub-modul inventory.

---

## Sub-modul

| Sub          | Mount path                              | Source                                              | Status   | Dok                                      |
| :----------- | :-------------------------------------- | :-------------------------------------------------- | :------- | :--------------------------------------- |
| FG           | `/api/app/inventory/fg`                 | `src/module/application/inventory/fg`               | ✅ Ready | [fg/README.md](./fg/README.md)           |
| FG / Import  | `/api/app/inventory/fg/import`          | `src/module/application/inventory/fg/import`        | ✅ Ready | [fg/import/README.md](./fg/import/README.md) |
| FG / Sizes   | `/api/app/inventory/fg/sizes`           | `src/module/application/inventory/fg/size`          | ✅ Ready | [fg/size/README.md](./fg/size/README.md) |
| FG / Types   | `/api/app/inventory/fg/types`           | `src/module/application/inventory/fg/type`          | ✅ Ready | [fg/type/README.md](./fg/type/README.md) |
| RM           | `/api/app/inventory/rm`                 | `src/module/application/inventory/rm`               | ✅ Ready | [rm/README.md](./rm/README.md)           |
| RM / Import  | `/api/app/inventory/rm/import`          | `src/module/application/inventory/rm/import`        | ✅ Ready | [rm/import/README.md](./rm/import/README.md) |
| RM / Suppliers | `/api/app/inventory/rm/suppliers`     | `src/module/application/inventory/rm/supplier`      | ✅ Ready | [rm/supplier/README.md](./rm/supplier/README.md) |
| RM / Categories | `/api/app/inventory/rm/categories`   | `src/module/application/inventory/rm/category`      | ✅ Ready | [rm/category/README.md](./rm/category/README.md) |
| RM / Units      | `/api/app/inventory/rm/units`        | `src/module/application/inventory/rm/unit`          | ✅ Ready | [rm/unit/README.md](./rm/unit/README.md)         |
| Monitoring                       | `/api/app/inventory/monitoring`                              | `src/module/application/inventory/monitoring`                              | ✅ Ready | [monitoring/README.md](./monitoring/README.md)                                       |
| Monitoring / Stock Distribution  | `/api/app/inventory/monitoring/stock-distribution/{fg\|rm}`  | `src/module/application/inventory/monitoring/stock-distribution`           | ✅ Ready | [monitoring/stock-distribution/README.md](./monitoring/stock-distribution/README.md) |
| Monitoring / Stock Movement      | `/api/app/inventory/monitoring/stock-movement`               | `src/module/application/inventory/monitoring/stock-movement`               | ✅ Ready | [monitoring/stock-movement/README.md](./monitoring/stock-movement/README.md)         |
| Monitoring / Stock Discrepancy   | `/api/app/inventory/monitoring/stock-discrepancy`            | `src/module/application/inventory/monitoring/stock-discrepancy`            | ✅ Ready | [monitoring/stock-discrepancy/README.md](./monitoring/stock-discrepancy/README.md)   |

> Dokumen flat lama `fg.md` masih ada untuk referensi; sumber kebenaran tunggal sekarang `fg/README.md` + sub-modul.

---

## Konvensi modul inventory

- **Layer SOP**: schema (Zod) → service (Prisma + transaksi) → controller (Hono Context) → routes (Hono). Lihat [CONVENTIONS.md](../../CONVENTIONS.md).
- **Type safety**: tidak boleh ada `any`/`unknown` implisit. Cast `as` hanya diperbolehkan untuk `c.get("body")`/`c.get("session")` (di-narrow oleh middleware).
- **Cache**: FG **tidak** memakai Redis cache (pencarian/list langsung query DB; indeks trigram GIN sudah dipasang). Redis dipakai khusus untuk **import session** (preview cache + lock).
- **Error handling**: lempar `ApiError(status, message)`. Tangkap `Prisma.PrismaClientKnownRequestError` kode `P2002` (unique) / `P2003` (FK) / `P2025` (record not found).
- **Soft delete**: lewat kolom `deleted_at`. Hapus permanen via endpoint `/clean` (transaksional + cek FK RESTRICT).
- **Export**: ExcelJS CSV writer, dibatasi `EXPORT_MAX_ROWS = 50_000`.
- **Bulk import**: async via BullMQ. Worker terpisah di `src/worker.ts` (PM2 process `api-erp-worker`). Lock per `import_id` di Redis. Lihat [fg/import/README.md](./fg/import/README.md).
- **Master data sub-modul** (`product_size`, `product_types`) di-upsert otomatis oleh FG create/update/import lewat `getOrCreateSize` / `getOrCreateSlug` — endpoint dedicated tetap tersedia untuk CRUD manual.
- **Status code SOP** (lihat [`dev-flow §1.G`](../../../.claude/skills/dev-flow/SKILL.md)): 201 create (POST /, /sizes, /types, /import/preview), 202 async enqueue (POST /import/execute), 200 read/update/status/bulk/clean/export.
- **CSV export ↔ Import header consistency** (lihat [`dev-flow §1.I`](../../../.claude/skills/dev-flow/SKILL.md)): header CSV import & header CSV export FG harus disinkronkan ke single source of truth (`PRODUCT CODE`, `PRODUCT NAME`, `TYPE`, `GENDER`, `SIZE`, `EDAR`, `SAFETY`). Status saat ini: header export memakai label display (`Kode`, `Nama Produk`, dst.) — perlu unifikasi. <!-- verify -->

---

## Frontend integration

Frontend modul `inventory` mirror struktur backend:

- Module folder: `app/src/app/(application)/inventory/`
- Components: `app/src/components/pages/inventory/`
- Schema/Service/Hooks: di folder `server/` masing-masing sub-module (dot-chain naming: `inventory.fg.schema.ts`, `inventory.fg.import.schema.ts`, dst.).

Status saat ini: **🚧 FE belum diimplementasikan** (per 2026-05-19; BE sudah lengkap untuk FG + RM + sub-modul). Dokumen [`./frontend-integration.md`](./frontend-integration.md) menyiapkan rencana lengkap mengikuti SOP [`frontend-dev-flow`](../../../.claude/skills/frontend-dev-flow/SKILL.md) — schema mirror per scope, service registry, hooks registry (5 hook split), component map, end-to-end flow Mermaid.
