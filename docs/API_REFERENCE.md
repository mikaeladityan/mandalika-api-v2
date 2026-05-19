# 📡 API Reference

Daftar lengkap endpoint backend ERP Mandalika.

**Base URL**: `{{BASE_URL}}/api`

**Auth**: semua endpoint di bawah `/api/app/*` butuh session (cookie `SESSION_COOKIE_NAME` atau header `Authorization: Bearer <sid>`). Endpoint mutation butuh `x-xsrf-header` header. Detail → [`AUTH.md`](./AUTH.md).

**Response shape**: `{ status: "success", data, query? }` atau `{ success: false, error, message, details?, requestId }`. Detail → [`ERROR_HANDLING.md`](./ERROR_HANDLING.md).

> ⚠ Bagian ini adalah **endpoint map**. Schema body/query lengkap ada di `*.schema.ts` masing-masing modul atau dokumen modul di [`./modules/`](./modules/).

---

## 0. Public Utilities

| Method | Path           | Auth | Catatan                                                  |
| :----- | :------------- | :--- | :------------------------------------------------------- |
| GET    | `/health`      | ❌   | DB + Redis + session metrics. 503 jika unhealthy.        |
| GET    | `/csrf`        | session | Generate CSRF token (cookie + body), TTL 15 menit.   |

---

## 1. Auth — `/api/auth`

| Method | Path                | Auth     | Body                                                      |
| :----- | :------------------ | :------- | :-------------------------------------------------------- |
| POST   | `/api/auth/register`| ❌       | `RegisterSchema`                                          |
| POST   | `/api/auth/`        | ❌       | `LoginSchema`                                             |
| GET    | `/api/auth/`        | session  | —                                                         |
| DELETE | `/api/auth/`        | session  | —                                                         |

Detail → [`modules/auth.md`](./modules/auth.md).

---

## 2. Global — `/api/global`

| Method | Path                       | Auth | Catatan                                |
| :----- | :------------------------- | :--- | :------------------------------------- |
| GET    | `/api/global/outlets`      | ❌*  | List outlet + inventaris (S2S/3rd party). Lihat `docs/api.md` root. |
| GET    | `/api/global/exchange-rate`| ❌*  | Kurs IDR vs major currencies.          |

\*GET tidak butuh CSRF tapi tetap melewati session middleware bila kebijakan org mengaktifkan auth global.

Detail → [`modules/global.md`](./modules/global.md).

---

## 3. Application — `/api/app/*`

> Semua dibawah `authMiddleware`. Mount di `module/application/application.routes.ts`.

### 3.1 Product — `/products`

| Method | Path                                  | Catatan                                |
| :----- | :------------------------------------ | :------------------------------------- |
| GET    | `/products/`                          | List + filter + paginate               |
| POST   | `/products/`                          | Create (`RequestProductSchema`)        |
| GET    | `/products/:id`                       | Detail                                 |
| PUT    | `/products/:id`                       | Update partial                         |
| PATCH  | `/products/status/:id`                | Toggle status                          |
| PUT    | `/products/bulk-status`               | Bulk set status                        |
| GET    | `/products/export`                    | Export Excel                           |
| DELETE | `/products/clean`                     | Hard delete soft-deleted records       |
| GET    | `/products/stocks/...`                | sub-modul stok produk                  |
| GET    | `/products/stock-locations/...`       | sub-modul lokasi stok                  |
| —      | `/products/import/...`                | sub-modul import (CSV/Excel)           |
| —      | `/products/units/...`                 | sub-modul Unit                         |
| —      | `/products/types/...`                 | sub-modul Type                         |
| —      | `/products/sizes/...`                 | sub-modul Size                         |

### 3.2 Raw Material — `/rawmat`

| Method | Path                              | Catatan                                |
| :----- | :-------------------------------- | :------------------------------------- |
| GET    | `/rawmat/`                        | List                                   |
| POST   | `/rawmat/`                        | Create (`RequestRawMaterialSchema`)    |
| GET    | `/rawmat/:id`                     | Detail                                 |
| PUT/PATCH | `/rawmat/:id`                  | Update partial                         |
| PATCH  | `/rawmat/:id/restore`             | Restore dari soft delete               |
| DELETE | `/rawmat/:id`                     | Soft delete                            |
| PUT    | `/rawmat/bulk-status`             | Bulk set status                        |
| GET    | `/rawmat/export`                  | Export Excel                           |
| GET    | `/rawmat/count-utils`             | Count util                             |
| GET    | `/rawmat/utils`                   | List util                              |
| GET    | `/rawmat/redis`                   | Cache redis utils                      |
| DELETE | `/rawmat/clean`                   | Hard purge soft-deleted                |
| —      | `/rawmat/suppliers/...`           | sub-modul                              |
| —      | `/rawmat/units/...`               | sub-modul                              |
| —      | `/rawmat/categories/...`          | sub-modul                              |
| —      | `/rawmat/import/...`              | sub-modul                              |
| —      | `/rawmat/stocks/...`              | sub-modul                              |

### 3.3 Warehouse — `/warehouses`

| Method | Path                                       | Catatan                  |
| :----- | :----------------------------------------- | :----------------------- |
| GET    | `/warehouses/`                             | List                     |
| POST   | `/warehouses/`                             | Create                   |
| GET    | `/warehouses/:id`                          | Detail                   |
| PUT    | `/warehouses/:id`                          | Update partial           |
| PATCH  | `/warehouses/:id`                          | Toggle status            |
| DELETE | `/warehouses/:id`                          | Soft delete              |
| GET    | `/warehouses/:id/stock/:product_id`        | Stok produk di warehouse |

### 3.4 Outlet — `/outlets`

| Method | Path                                          | Catatan                  |
| :----- | :-------------------------------------------- | :----------------------- |
| GET    | `/outlets/`                                   | List                     |
| POST   | `/outlets/`                                   | Create                   |
| GET    | `/outlets/:id`                                | Detail                   |
| PUT    | `/outlets/:id`                                | Update                   |
| PATCH  | `/outlets/:id/status`                         | Toggle status            |
| POST   | `/outlets/bulk-status`                        | Bulk set status          |
| POST   | `/outlets/bulk-delete`                        | Bulk soft delete         |
| DELETE | `/outlets/clean`                              | Hard purge               |
| —      | `/outlets/:id/inventory/...`                  | sub-modul OutletInventory|
| —      | `/outlets/import/...`                         | sub-modul import         |

### 3.5 Product Issuance — `/product-issuance`

| Method | Path                              | Catatan                       |
| :----- | :-------------------------------- | :---------------------------- |
| GET    | `/`                               | List issuance per produk      |
| POST   | `/`                               | Bulk save (`RequestIssuanceBulkSchema`) |
| PUT    | `/`                               | Bulk update                   |
| GET    | `/:product_id`                    | Detail per produk             |
| GET    | `/export`                         | Export                        |
| GET    | `/rekap`                          | Rekap issuance                |
| GET    | `/rekap/export`                   | Export rekap                  |
| —      | `/import/...`                     | sub-modul                     |

### 3.6 Recipe — `/recipes`

| Method | Path           | Catatan                            |
| :----- | :------------- | :--------------------------------- |
| GET    | `/`            | List                               |
| POST   | `/`            | Upsert recipe (`RequestRecipeSchema`) |
| DELETE | `/`            | Delete (`RequestDeleteRecipeSchema`)  |
| GET    | `/:id`         | Detail                             |
| GET    | `/export`      | Export                             |
| —      | `/import/...`  | sub-modul import                   |

### 3.7 Forecast — `/forecasts`

| Method | Path                              | Catatan                                |
| :----- | :-------------------------------- | :------------------------------------- |
| GET    | `/`                               | List forecast                          |
| POST   | `/`                               | Run forecast (`RunForecastSchema`)     |
| POST   | `/run`                            | Alias                                  |
| PATCH  | `/finalize`                       | Finalize (`FinalizeForecastSchema`)    |
| PATCH  | `/manual-update`                  | Manual override                        |
| DELETE | `/period`                         | Delete by period                       |
| DELETE | `/reset/:product_id`              | Reset per produk                       |
| GET    | `/:product_id`                    | Detail per produk                      |
| DELETE | `/:id`                            | Hapus 1 record                         |
| GET    | `/export`                         | Export                                 |
| —      | `/forecast-percentages/...`       | sub-modul presentase                   |

### 3.8 Recommendation V2 — `/recomendations-v2`

| Method | Path                            | Catatan                              |
| :----- | :------------------------------ | :----------------------------------- |
| GET    | `/`                             | List rekomendasi                     |
| GET    | `/export`                       | Export                               |
| GET    | `/open-po`                      | List open PO cells                   |
| POST   | `/open-po`                      | Create open PO cell                  |
| PATCH  | `/open-po/:itemId`              | Update qty                           |
| DELETE | `/open-po/:itemId`              | Delete                               |
| POST   | `/order`                        | Save WO                              |
| POST   | `/approve`                      | Approve WO                           |
| POST   | `/bulk-horizon`                 | Set horizon massal                   |
| POST   | `/need-override`                | Override kebutuhan                   |
| DELETE | `/need-override`                | Hapus override                       |
| PATCH  | `/moq`                          | Update MOQ                           |
| PATCH  | `/hide`                         | Bulk toggle hide                     |
| GET    | `/suppliers`                    | Supplier kandidat untuk material     |
| DELETE | `/:id`                          | Hapus WO                             |

### 3.9 Consolidation — `/consolidation`

| Method | Path              | Catatan                              |
| :----- | :---------------- | :----------------------------------- |
| GET    | `/`               | List draft purchase                  |
| GET    | `/summary`        | Ringkasan per supplier               |
| GET    | `/export`         | Export                               |
| PATCH  | `/bulk-status`    | Bulk update status                   |

### 3.10 BOM — `/bom`

| Method | Path     | Catatan |
| :----- | :------- | :------ |
| GET    | `/`      | List    |
| GET    | `/:id`   | Detail  |

### 3.11 Stock Transfer V1 (Legacy) — `/stock-transfers`

| Method | Path             | Catatan                              |
| :----- | :--------------- | :----------------------------------- |
| GET    | `/`              | List                                 |
| POST   | `/`              | Create                               |
| GET    | `/:id`           | Detail                               |
| PATCH  | `/:id/status`    | Update status                        |

### 3.12 Stock Movement (Audit) — `/stock-movements`

| Method | Path     | Catatan                            |
| :----- | :------- | :--------------------------------- |
| GET    | `/`      | List dengan filter (entity/ref/...)|
| GET    | `/:id`   | Detail                              |

### 3.13 Inventory V2 — `/inventory-v2`

#### GR — `/inventory-v2/gr`

| Method | Path              | Catatan                  |
| :----- | :---------------- | :----------------------- |
| GET    | `/`               | List GR                  |
| GET    | `/stats`          | Statistik                |
| GET    | `/export`         | Export                   |
| GET    | `/:id`            | Detail                   |
| POST   | `/`               | Create (`RequestGoodsReceiptSchema`) |
| PATCH  | `/:id`            | Update                   |
| POST   | `/:id/post`       | Posting → stok+          |
| PATCH  | `/:id/cancel`     | Cancel                   |

#### DO — `/inventory-v2/do`

| Method | Path             | Catatan                       |
| :----- | :--------------- | :---------------------------- |
| GET    | `/`              | List                          |
| GET    | `/stock`         | Cek stok                      |
| GET    | `/export`        | Export                        |
| GET    | `/:id`           | Detail                        |
| POST   | `/`              | Create (`RequestDeliveryOrderSchema`) |
| PATCH  | `/:id`           | Update                        |
| PATCH  | `/:id/status`    | Update status                 |

#### TG — `/inventory-v2/tg`

| Method | Path             | Catatan                          |
| :----- | :--------------- | :------------------------------- |
| GET    | `/`              | List                              |
| GET    | `/export`        | Export                            |
| GET    | `/stock`         | Cek stok                          |
| GET    | `/:id`           | Detail                            |
| POST   | `/`              | Create (`RequestTransferGudangSchema`) |
| PATCH  | `/:id`           | Update                            |
| PATCH  | `/:id/status`    | Update status                     |

#### Return — `/inventory-v2/return`

| Method | Path             | Catatan                            |
| :----- | :--------------- | :--------------------------------- |
| GET    | `/`              | List                                |
| GET    | `/export`        | Export                              |
| POST   | `/`              | Create (`RequestReturnSchema`)      |
| GET    | `/:id`           | Detail                              |
| PATCH  | `/:id/status`    | Update status                       |
| PATCH  | `/:id`           | Update                              |

#### Monitoring — `/inventory-v2/monitoring`

Sub-mount: `/stock-total`, `/stock-card`, `/stock-location`, `/discrepancy`.

### 3.14 Manufacturing — `/manufacturing`

| Method | Path                                       | Catatan                                |
| :----- | :----------------------------------------- | :------------------------------------- |
| GET    | `/`                                        | List production order                  |
| POST   | `/`                                        | Create                                 |
| GET    | `/wastes`                                  | List waste                             |
| GET    | `/bom-preview`                             | Preview BOM untuk PO baru              |
| GET    | `/:id`                                     | Detail                                 |
| PATCH  | `/:id`                                     | Update                                 |
| PATCH  | `/:id/status`                              | Change status (PLANNING→COMPLETED dll) |
| POST   | `/:id/result`                              | Submit actual result                   |
| POST   | `/:id/qc`                                  | QC action                              |
| PATCH  | `/:id/items/:itemId/override`              | Override qty item                      |
| DELETE | `/:id/items/:itemId/override`              | Hapus override                         |
| DELETE | `/:id`                                     | Delete PO                              |
| DELETE | `/clean/cancelled`                         | Bulk purge PO cancelled                |
| —      | `/inventory/rm-movement/...`               | sub                                    |
| —      | `/inventory/rm-receipt/...`                | sub                                    |
| —      | `/inventory/rm-transfer/...`               | sub                                    |
| —      | `/inventory/rm-usage/...`                  | sub                                    |
| —      | `/inventory/rm-sku-transfer/...`           | sub                                    |
| —      | `/inventory/manual-waste-rm/...`           | sub                                    |

### 3.15 Purchase — `/purchase`

#### RFQ — `/purchase/rfq`

| Method | Path                       | Catatan                                |
| :----- | :------------------------- | :------------------------------------- |
| GET    | `/consolidation-items`     | Item draft yang available di-RFQ-kan   |
| GET    | `/`                        | List RFQ                                |
| GET    | `/:id`                     | Detail                                  |
| POST   | `/`                        | Create (`CreateRFQSchema`)              |
| PUT    | `/:id`                     | Update                                  |
| PATCH  | `/:id/status`              | Update status (DRAFT/SENT/ACCEPTED/REJECTED/CONVERTED) |
| POST   | `/:id/convert`             | Convert ke PO                           |
| DELETE | `/:id`                     | Hapus                                   |

#### PO — `/purchase/po`

| Method | Path                | Catatan                            |
| :----- | :------------------ | :--------------------------------- |
| GET    | `/`                 | List PO                            |
| GET    | `/open-po`          | List PO yang masih open            |
| GET    | `/:id`              | Detail                             |
| GET    | `/:id/receipts`     | Receipt terkait                    |
| POST   | `/`                 | Create                             |
| PUT    | `/:id`              | Update                             |
| PATCH  | `/:id/status`       | Update status                      |
| PATCH  | `/:id/tracking`     | Update tracking                    |
| DELETE | `/:id`              | Hapus                              |

#### Receipt — `/purchase/receipt`

| Method | Path             | Catatan                                  |
| :----- | :--------------- | :--------------------------------------- |
| GET    | `/`              | List                                      |
| GET    | `/open-pos`      | PO yang siap di-receipt-kan              |
| GET    | `/:id`           | Detail                                    |
| POST   | `/`              | Create                                    |
| PUT    | `/:id`           | Update                                    |
| POST   | `/:id/post`      | Posting → stok+ + buat AP                |
| POST   | `/:id/approve`   | Approve                                   |
| DELETE | `/:id`           | Hapus (jika belum posted)                |

#### Tracking — `/purchase/tracking`

| Method | Path           | Catatan                          |
| :----- | :------------- | :------------------------------- |
| GET    | `/`            | List tracking                    |
| GET    | `/:po_id`      | Tracking 1 PO                    |
| PATCH  | `/:po_id`      | Update tracking                  |

#### Vendor Return — `/purchase/vendor-return`

| Method | Path             | Catatan                  |
| :----- | :--------------- | :----------------------- |
| GET    | `/`              | List                      |
| GET    | `/:id`           | Detail                    |
| POST   | `/`              | Create                    |
| PUT    | `/:id`           | Update                    |
| POST   | `/:id/post`      | Posting (stok-)           |
| POST   | `/:id/approve`   | Approve                   |
| DELETE | `/:id`           | Hapus                     |

### 3.16 Finance — `/finance`

#### AP — `/finance/ap`

| Method | Path                | Catatan                              |
| :----- | :------------------ | :----------------------------------- |
| GET    | `/`                 | List AP (`QueryAPSchema`)            |
| GET    | `/:id`              | Detail                                |
| PATCH  | `/:id/payment`      | Record payment (`PayAPSchema`)        |

#### AR — `/finance/ar`

| Method | Path                | Catatan                              |
| :----- | :------------------ | :----------------------------------- |
| GET    | `/`                 | List AR                              |
| POST   | `/`                 | Create (`CreateARSchema`)            |
| GET    | `/:id`              | Detail                                |
| PATCH  | `/:id/receipt`      | Record receipt (`ReceiveARSchema`)   |

#### Cash — `/finance/cash`

| Method | Path             | Catatan                          |
| :----- | :--------------- | :------------------------------- |
| GET    | `/`              | List                              |
| POST   | `/`              | Create (`CreateCashSchema`)       |
| GET    | `/:id`           | Detail                            |
| PATCH  | `/:id/post`      | Posting                           |

#### Journal — `/finance/journal`

| Method | Path             | Catatan                          |
| :----- | :--------------- | :------------------------------- |
| GET    | `/`              | List                              |
| POST   | `/`              | Create (`CreateJournalSchema`)    |
| GET    | `/:id`           | Detail                            |
| PATCH  | `/:id/post`      | Posting                           |

#### KPI — `/finance/kpi`

| Method | Path | Catatan                                |
| :----- | :--- | :------------------------------------- |
| GET    | `/`  | Summary KPI (cash flow, AP/AR aging)   |

---

## 4. Konvensi Query Pagination

Hampir semua endpoint list pakai pola:

| Param      | Tipe   | Default | Catatan                                    |
| :--------- | :----- | :------ | :----------------------------------------- |
| `page`     | number | 1       | Halaman                                    |
| `take`     | number | 25/50   | Per page (max 100/200 di Finance)          |
| `search`   | string | —       | Substring case-insensitive di field utama  |
| `status`   | enum   | —       | Sesuai enum modul                          |
| `sortBy`   | enum   | varies  | Lihat schema per modul                     |
| `order`    | enum   | `asc`/`desc` |                                      |

Response menyertakan `query: { total, page, take }`.

---

## 5. Konvensi Mutation

- `POST /` → 201 + body data record baru.
- `PUT /:id` → 200 + body data updated (full replace / partial via `.partial()`).
- `PATCH /:id` atau `/:id/<aksi>` → 200 + data updated (untuk perubahan state spesifik: status, posting, payment).
- `DELETE /:id` → 200 (umumnya soft delete; hard purge via `/clean`).

---

_Lihat dokumen per modul di [`./modules/`](./modules/) untuk schema body & response shape detail._
