# 🏪 Module: Outlet

**Path**: `/api/app/outlets`
**Source**: `src/module/application/outlet/`

Master data toko (outlet) terpisah dari Warehouse. Disiapkan untuk integrasi POS.

---

## Endpoint Utama

| Method | Path                       | Catatan                                  |
| :----- | :------------------------- | :--------------------------------------- |
| GET    | `/`                        | List + filter + paginate                 |
| POST   | `/`                        | Create (`RequestOutletSchema`)           |
| GET    | `/:id`                     | Detail                                   |
| PUT    | `/:id`                     | Update (`UpdateOutletSchema`)            |
| PATCH  | `/:id/status`              | Toggle status                            |
| POST   | `/bulk-status`             | Bulk set (`BulkStatusSchema`)            |
| POST   | `/bulk-delete`             | Bulk soft delete (`BulkDeleteSchema`)    |
| DELETE | `/clean`                   | Hard purge soft-deleted                  |

## Sub-modul

| Sub                              | Path                                            |
| :------------------------------- | :---------------------------------------------- |
| OutletInventory                  | `/outlets/:id/inventory`                        |
| Import                           | `/outlets/import`                               |

---

## OutletInventory

Endpoint (mount di `outlet/inventory/outlet-inventory.routes.ts`):

| Method | Path                                            | Catatan                                |
| :----- | :---------------------------------------------- | :------------------------------------- |
| GET    | `/outlets/:id/inventory`                        | List stok per produk                   |
| GET    | `/outlets/:id/inventory/:product_id`            | Detail stok 1 produk                   |
| POST   | `/outlets/:id/inventory/init`                   | Init produk (set min_stock baseline)   |
| PATCH  | `/outlets/:id/inventory/:product_id/min-stock`  | Set min stock                          |

Service methods (`outlet-inventory.service.ts`):
- `getStock`, `listStock`, `initProducts`, `setMinStock`, `adjustQuantity(delta, tx?)`.
- `adjustQuantity` adalah internal method untuk StockTransfer + POS — throw 422 jika hasil `qty < 0`.

Field `is_low_stock` computed: `qty < min_stock`.
Query filter `low_stock=true` (in-memory).

---

## Business Rule

- `code` outlet unik.
- Tipe: `OutletType` (`RETAIL` / `MARKETPLACE`).
- Outlet hanya boleh terhubung ke warehouse `FINISH_GOODS` — throw 422 dengan pesan jelas jika tipe salah (`validateFinishGoodsWarehouse`).
- Soft delete (`deleted_at`).

---

## Schema

`RequestOutletSchema`:

```ts
{
  name: string,
  code: string,        // unique
  type: OutletType,
  warehouse_id?: number,  // wajib FINISH_GOODS
  address?: { ...OutletAddress }
}
```
