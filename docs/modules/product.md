# 📦 Module: Product

**Path**: `/api/app/products`
**Source**: `src/module/application/product/`

Manajemen master data produk jadi (FG).

---

## Sub-modul

| Sub                                | Path                          | Catatan                                  |
| :--------------------------------- | :---------------------------- | :--------------------------------------- |
| Stock per warehouse                | `/products/stocks`            | upsert stok manual (V1)                  |
| Stock location (lihat per gudang)  | `/products/stock-locations`   | read aggregate per location              |
| Import                             | `/products/import`            | Excel/CSV import                         |
| Unit                               | `/products/units`             | master Unit                              |
| Type                               | `/products/types`             | master ProductType                       |
| Size                               | `/products/sizes`             | master ProductSize                       |

---

## Endpoint Utama

| Method | Path                          | Catatan                          |
| :----- | :---------------------------- | :------------------------------- |
| GET    | `/`                           | List + filter + paginate         |
| POST   | `/`                           | Create (`RequestProductSchema`)  |
| GET    | `/:id`                        | Detail                           |
| PUT    | `/:id`                        | Update partial                   |
| PATCH  | `/status/:id`                 | Toggle status PENDING/ACTIVE     |
| PUT    | `/bulk-status`                | Bulk set status                  |
| GET    | `/export`                     | Export Excel                     |
| DELETE | `/clean`                      | Hard purge soft-deleted          |

---

## Schema (`product.schema.ts`)

`RequestProductSchema`:

```ts
{
  name: string (1-100),
  code: string (1-100, unique),
  unit_id?: number,
  type_id?: number,
  gender?: "MALE" | "FEMALE" | "UNISEX",
  status?: "PENDING" | "ACTIVE" | ...,
  description?: string,
  // ... lihat schema lengkap
}
```

`QueryProductSchema` mengikuti pola umum (page/take/search/status/sortBy/order).

---

## Business Rule

- `code` unik (case-sensitive). Throw 409 jika konflik.
- Soft delete (`deleted_at`). Endpoint list default filter `deleted_at: null`.
- `gender` enum `GENDER` di Prisma.
- Saat hapus, sub-relasi (Recipes, ProductInventory) tetap utuh — restore via PATCH atau `/clean` untuk hard purge.

---

## Stock Operasi

Stock manual diset via `/products/stocks/...`. Untuk operasi inventori yang transaksional (GR/DO/TG/Retur) gunakan modul **Inventory V2** (`/inventory-v2/*`).
