# 🏭 Module: Warehouse

**Path**: `/api/app/warehouses`
**Source**: `src/module/application/warehouse/`

Master data gudang. Tipe ditentukan oleh enum `WarehouseType`: `FINISH_GOODS` / `RAW_MATERIAL` / dll.

---

## Endpoint

| Method | Path                                   | Catatan                                       |
| :----- | :------------------------------------- | :-------------------------------------------- |
| GET    | `/`                                    | List                                          |
| POST   | `/`                                    | Create (`RequestWarehouseSchema`)             |
| GET    | `/:id`                                 | Detail                                        |
| PUT    | `/:id`                                 | Update partial                                |
| PATCH  | `/:id`                                 | Toggle status                                 |
| DELETE | `/:id`                                 | Soft delete                                   |
| GET    | `/:id/stock/:product_id`               | Saldo stok produk di warehouse                |

---

## Schema

`RequestWarehouseSchema` (`warehouse.schema.ts`):

```ts
{
  name: string,
  code: string,   // unique
  type: WarehouseType,
  address?: { ...WarehouseAddress }
}
```

`.partial()` dipakai di PUT (update).

---

## Business Rule

- `code` unik.
- `type` salah satu enum `WarehouseType`. Outlet wajib terhubung ke warehouse `FINISH_GOODS` (lihat modul Outlet).
- Soft delete via `deleted_at`.

---

## Konvensi Code

Project memakai prefix code seperti:

| Prefix     | Tipe Konsep                                       |
| :--------- | :------------------------------------------------ |
| `GRM-*`    | Gudang Raw Material (mis. `GRM-KDG`, `GRM-PRD`)   |
| `GFG-*`    | Gudang Finish Goods (mis. `GFG-SBY`)              |

Code bukan hardcoded di service — kirim dari client / set di seed. Lihat catatan `CHANGELOG.md` "Hardcode warehouse 'GFG-SBY' telah dihapus".
