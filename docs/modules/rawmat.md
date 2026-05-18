# 🧪 Module: Raw Material

**Path**: `/api/app/rawmat`
**Source**: `src/module/application/rawmat/`

Master data bahan baku (RM) + Supplier + Unit + Kategori + Import + Stock.

---

## Sub-modul

| Sub          | Path                       | Catatan                                  |
| :----------- | :------------------------- | :--------------------------------------- |
| Suppliers    | `/rawmat/suppliers`        | CRUD supplier                            |
| Units        | `/rawmat/units`            | satuan RM                                |
| Categories   | `/rawmat/categories`       | kategori (KA, PAPER, dll)                |
| Import       | `/rawmat/import`           | Excel/CSV import                         |
| Stocks       | `/rawmat/stocks`           | upsert stok manual (V1)                  |

---

## Endpoint Utama

| Method     | Path                | Catatan                                  |
| :--------- | :------------------ | :--------------------------------------- |
| GET        | `/`                 | List                                     |
| POST       | `/`                 | Create (`RequestRawMaterialSchema`)      |
| GET        | `/:id`              | Detail                                   |
| PUT/PATCH  | `/:id`              | Update partial                           |
| PATCH      | `/:id/restore`      | Restore soft-deleted                     |
| DELETE     | `/:id`              | Soft delete                              |
| PUT        | `/bulk-status`      | Bulk set status (`BulkStatusRawMaterialSchema`) |
| GET        | `/export`           | Export Excel                             |
| GET        | `/count-utils`      | Util count (kategori, supplier)          |
| GET        | `/utils`            | Util list                                |
| GET        | `/redis`            | Cache snapshot                           |
| DELETE     | `/clean`            | Hard purge                               |

---

## Catatan Schema

`RawMaterial` di Prisma punya field penting:

- `code` (unique).
- `material_type` enum (lihat `MaterialType`).
- `source` enum (`RawMaterialSource`).
- `unit_id` → `UnitRawMaterial`.
- `category_id` → `RawMatCategories`.
- Relasi N:N supplier via `SupplierMaterial`.

---

## Konversi Khusus

Lihat [`docs/rumus_kertas.md`](../../../docs/rumus_kertas.md) di root untuk rumus konversi paper (Absorb 0.4MM `sheetToKgFactor = (144 * 5000) / 2946120` kg per lembar). Recipe quantity dimasukkan sebagai `1/144` untuk 1 pcs produk Absorb.
