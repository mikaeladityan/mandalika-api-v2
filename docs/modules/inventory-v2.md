# 📦 Module: Inventory V2

**Path**: `/api/app/inventory-v2`
**Source**: `src/module/application/inventory-v2/`

Sistem inventory modern untuk Goods Receipt (GR), Delivery Order (DO), Transfer Gudang (TG), Return, dan Monitoring stok. Menggantikan beberapa peran Stock Transfer V1 (lihat [`./stock-legacy.md`](./stock-legacy.md)).

---

## 1. Mount

`InventoryV2Routes` mount di `application.routes.ts`:

```
/inventory-v2/gr           → GRRoutes
/inventory-v2/do           → DORoutes
/inventory-v2/tg           → TGRoutes
/inventory-v2/return       → ReturnRoutes
/inventory-v2/monitoring   → MonitoringRoutes
```

---

## 2. Goods Receipt — `/inventory-v2/gr`

Penerimaan barang masuk (dari supplier untuk RM, dari produksi untuk FG, atau adjustment).

| Method | Path           | Catatan                                |
| :----- | :------------- | :------------------------------------- |
| GET    | `/`            | List GR                                |
| GET    | `/stats`       | Statistik (per type/status/periode)   |
| GET    | `/export`      | Export Excel                           |
| GET    | `/:id`         | Detail                                 |
| POST   | `/`            | Create (`RequestGoodsReceiptSchema`)   |
| PATCH  | `/:id`         | Update (`RequestUpdateGoodsReceiptSchema`) |
| POST   | `/:id/post`    | Posting → tambah stok                  |
| PATCH  | `/:id/cancel`  | Cancel                                 |

Status: `GoodsReceiptStatus` (DRAFT / POSTED / CANCELLED).
Tipe: `GoodsReceiptType` (PURCHASE / PRODUCTION / ADJUSTMENT / dll).

### Posting Flow

`POST /:id/post`:
1. `prisma.$transaction` mulai.
2. Per item: `productInventory.update({ increment: qty })` atau `rawMaterialInventory.update`.
3. Tulis `StockMovement` (`ref_type = GR`, `ref_id = gr.id`).
4. Set `status = POSTED`.

---

## 3. Delivery Order — `/inventory-v2/do`

Pengiriman barang keluar dari gudang ke outlet (atau gudang→customer).

| Method | Path             | Catatan                                  |
| :----- | :--------------- | :--------------------------------------- |
| GET    | `/`              | List                                      |
| GET    | `/stock`         | Cek availability stok                     |
| GET    | `/export`        | Export                                    |
| GET    | `/:id`           | Detail                                    |
| POST   | `/`              | Create (`RequestDeliveryOrderSchema`)     |
| PATCH  | `/:id`           | Update (`RequestUpdateDeliveryOrderSchema`)|
| PATCH  | `/:id/status`    | Update status (`UpdateDeliveryOrderStatusSchema`) |

Status lifecycle: DRAFT → READY → SHIPPING → RECEIVED → COMPLETED (atau CANCELLED).

### Status Transition

- `SHIPPING`: deduct stok warehouse (source).
- `RECEIVED`: add stok outlet (target). Auto → COMPLETED.
- `CANCELLED` dari `SHIPPING`: revert stok warehouse.

---

## 4. Transfer Gudang — `/inventory-v2/tg`

Perpindahan barang antar warehouse (warehouse↔warehouse).

| Method | Path             | Catatan                                  |
| :----- | :--------------- | :--------------------------------------- |
| GET    | `/`              | List                                      |
| GET    | `/export`        | Export                                    |
| GET    | `/stock`         | Cek stok source                           |
| GET    | `/:id`           | Detail                                    |
| POST   | `/`              | Create (`RequestTransferGudangSchema`)    |
| PATCH  | `/:id`           | Update (`RequestUpdateTransferGudangSchema`) |
| PATCH  | `/:id/status`    | Update status (`UpdateTransferGudangStatusSchema`) |

Status lifecycle: serupa DO (DRAFT → SHIPPING → RECEIVED → COMPLETED).

---

## 5. Return — `/inventory-v2/return`

Pengembalian stok bermasalah (dari outlet/warehouse → warehouse sumber).

| Method | Path             | Catatan                                  |
| :----- | :--------------- | :--------------------------------------- |
| GET    | `/`              | List                                      |
| GET    | `/export`        | Export                                    |
| POST   | `/`              | Create (`RequestReturnSchema`)            |
| GET    | `/:id`           | Detail                                    |
| PATCH  | `/:id/status`    | Update status (`UpdateReturnStatusSchema`)|
| PATCH  | `/:id`           | Update (`RequestUpdateReturnSchema`)      |

Status enum: `ReturnStatus`.

Service `ReturnService`:
- `create`: validasi items.
- `createFromRejection`: generate dari rejected items (DO/TG), filter rejected only, generate `RTN-...` number.
- `updateStatus SHIPPING`: deduct outlet/warehouse asal.
- `updateStatus RECEIVED → COMPLETED` (auto): add warehouse target.
- `updateStatus CANCELLED` dari SHIPPING: revert.

> Hardcode warehouse `"GFG-SBY"` dihapus — rejected items kembali ke gudang asal DO/TG asal (lihat `docs/TODO.md` catatan teknis).

---

## 6. Monitoring — `/inventory-v2/monitoring`

| Sub                                       | Path                                       |
| :---------------------------------------- | :----------------------------------------- |
| Stock Total (global view)                 | `/monitoring/stock-total`                  |
| Stock Card (movement per produk)          | `/monitoring/stock-card`                   |
| Stock Location (per gudang/toko)          | `/monitoring/stock-location`               |
| Discrepancy                               | `/monitoring/discrepancy`                  |

### Stock Total

Query gabungan `ProductInventory` (semua gudang FG) + `OutletInventory` (semua toko aktif). Filter: search FG, kategori, date range. Tabel dinamis kolom per gudang + kolom per toko.

### Stock Card

Audit movement per produk dengan running balance (Saldo). Filter: search by produk/dokumen/referensi. Mode `Recap` (sum per dokumen) vs `Table` (per movement). Export CSV/Excel (max 5000 rows).

### Stock Location

Filter: location type (Gudang/Toko), pilih lokasi, kategori. Data dari `ProductInventory` + `OutletInventory`.

### Discrepancy

Selisih antara stok sistem vs stok fisik (saat stock opname).

---

## 7. InventoryHelper

`src/module/application/inventory-v2/inventory.helper.ts` — utility class shared untuk operasi stok. **Wajib** dipakai daripada inline deduct/add di service. Method utama:

- `deductStock(tx, entity, locationType, locationId, qty)`.
- `addStock(tx, entity, locationType, locationId, qty)`.
- `writeMovement(tx, payload)` — log ke `StockMovement`.

Lihat `CONVENTIONS.md` §13 untuk pattern transaksi inventaris yang aman.

---

## 8. Export Limit

Semua endpoint `/export` dibatasi **5000 baris** untuk hindari OOM. Untuk dataset besar, gunakan filter periode/lokasi.

---

## 9. Test

Lokasi: `src/tests/inventory-v2/`. Mencakup unit test service & integration test routes (lihat [`docs/TODO.md`](../../../docs/TODO.md) Phase 1 untuk daftar test yang sudah passed).
