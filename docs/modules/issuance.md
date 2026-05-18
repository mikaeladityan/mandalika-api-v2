# 📤 Module: Product Issuance

**Path**: `/api/app/product-issuance`
**Source**: `src/module/application/issuance/`

Pencatatan distribusi produk ke outlet (kuantitas per produk per periode, dipakai untuk rekap & basis forecasting).

---

## Endpoint

| Method | Path                            | Catatan                                 |
| :----- | :------------------------------ | :-------------------------------------- |
| GET    | `/`                             | List                                    |
| POST   | `/`                             | Bulk save (`RequestIssuanceBulkSchema`) |
| PUT    | `/`                             | Bulk update (sama schema)               |
| GET    | `/:product_id`                  | Detail per produk                       |
| GET    | `/export`                       | Export                                  |
| GET    | `/rekap`                        | Rekap                                   |
| GET    | `/rekap/export`                 | Export rekap                            |
| —      | `/import/...`                   | sub-modul import                        |

---

## Schema

`RequestIssuanceBulkSchema` (array per item):

```ts
[
  {
    product_id: number,
    outlet_id: number,
    period: string (YYYY-MM atau YYYY-MM-DD),
    quantity: number,
    type: IssuanceType,    // enum prisma
  },
  ...
]
```

Model: `ProductIssuance` di Prisma.

---

## Use Case

- Input mingguan/bulanan oleh PIC distribusi.
- Sumber data untuk modul **Forecast** (sales trend) & **Recommendation V2**.
- Export rekap untuk laporan periodik.
