# 🌐 Module: Global Endpoints

**Path**: `/api/global`
**Source**: `src/module/global/`

Endpoint untuk komunikasi antar layanan (S2S) atau integrasi pihak ketiga.

---

## 1. Outlets — `/api/global/outlets`

| Method | Path  | Auth | CSRF |
| :----- | :---- | :--- | :--- |
| GET    | `/`   | session | ❌ (GET) |

Query params:

| Param           | Tipe   | Default       | Catatan                                                |
| :-------------- | :----- | :------------ | :----------------------------------------------------- |
| `page`          | number | 1             |                                                        |
| `take`          | number | 25 (max 100)  |                                                        |
| `search`        | string | —             | match parsial `name` / `code` case-insensitive          |
| `status`        | enum   | —             | `active` (deleted_at null) / `deleted`                  |
| `type`          | enum   | —             | `RETAIL` / `MARKETPLACE` (`OutletType`)                 |
| `warehouse_id`  | number | —             | filter relasi via `OutletWarehouse`                     |
| `sortBy`        | enum   | `updated_at`  | `name` / `code` / `created_at` / `updated_at`           |
| `sortOrder`     | enum   | `asc`         | `asc` / `desc`                                          |

Response:

```json
{
  "query": { "total": 10, "page": 1, "take": 25 },
  "status": "success",
  "data": [
    {
      "code": "OTL-001",
      "name": "Outlet Jakarta",
      "type": "RETAIL",
      "inventories": [
        {
          "min_stock": 10,
          "quantity": 50,
          "product": { "id": 1, "code": "PROD-001", "name": "Produk A", "unit": "PCS" }
        }
      ]
    }
  ]
}
```

Endpoint ini di-mirror dari root [`docs/api.md`](../../../docs/api.md). Untuk panduan integrasi step-by-step ke konsumer eksternal, lihat dokumen tersebut.

---

## 2. Exchange Rate — `/api/global/exchange-rate`

| Method | Path | Catatan                                          |
| :----- | :--- | :----------------------------------------------- |
| GET    | `/`  | Ambil kurs IDR vs major currencies (USD/EUR/dst) |

Source service mengakses provider eksternal (lihat `src/module/global/exchange-rate/exchange-rate.service.ts`).

Response (contoh):

```json
{
  "status": "success",
  "data": {
    "base": "IDR",
    "rates": { "USD": 0.0000615, "EUR": 0.0000570, "..." : "..." },
    "updated_at": "2026-05-13T08:00:00Z"
  }
}
```

---

## CSRF & Method

- GET tidak butuh CSRF.
- Endpoint global TIDAK boleh mutation publik. Jika butuh write, lakukan via `/api/app/*` dengan session penuh.
