# TODO — Development Backlog
## Mandalika ERP — Inventory Control System

**Last Updated:** 2026-03-19
**Fokus Sekarang:** Sprint 1 & 2 — Outlet + Inventory Control (Finish Goods Fokus)
**Catatan:** Warehouse to Warehouse (Raw Material) dipending karena flow custom.

---

## 📐 Status Schema Prisma

| Model | Status |
|-------|--------|
| `Outlet` + `OutletAddress` | ✅ Ditambahkan ke `schema.prisma` |
| `OutletInventory` | ✅ Ditambahkan ke `schema.prisma` |
| `StockMovement` | ✅ Ditambahkan ke `schema.prisma` |
| `StockTransfer` + `StockTransferItem` | ✅ Ditambahkan ke `schema.prisma` |
| `StockTransferPhoto` + `barcode` field | ✅ Ditambahkan ke `schema.prisma` |
| Enum `TransferStatus` (10 status) | ✅ Ditambahkan ke `schema.prisma` |
| Enum `TransferPhotoStage` | ✅ Ditambahkan ke `schema.prisma` |
| Relasi balik `Product` + `Warehouse` | ✅ Diupdate |
| `prisma db push` + `prisma generate` | ✅ Database & Client sync |

---

## 🔴 SPRINT 1 — Domain: Finish Goods (Foundation)
*(Target: 18 Mar – 7 Apr 2026)*

### ✅ Schema — SELESAI
- [x] Tambah enum & model Outlet, OutletInventory, StockMovement, StockTransfer, StockTransferPhoto ke `schema.prisma`
- [x] `prisma db push` + `prisma generate` ✅

---

### [S1-A] Outlet Module (Backend) ✅ SELESAI
**File:** `api/src/module/application/outlet/`

**Zod Schema** — `outlet.schema.ts`
- [x] `RequestOutletSchema` — name, code, phone, warehouse_id (optional), address (optional)
- [x] `UpdateOutletSchema` — partial dari RequestOutletSchema
- [x] `QueryOutletSchema` — search, is_active, warehouse_id, page, take, sort

**Service** — `outlet.service.ts`
- [x] `create(body)` — buat outlet + address, validasi code unik & warehouse exist
- [x] `update(id, body)` — update info + upsert address, validasi code unik jika berubah
- [x] `toggleStatus(id)` — toggle `is_active` true/false
- [x] `delete(id)` — soft delete (`deleted_at`)
- [x] `list(query)` — filter search (name/code), is_active, warehouse_id + pagination
- [x] `detail(id)` — include address + warehouse info + count inventories

**Controller** — `outlet.controller.ts`
- [x] Semua method terhubung ke service + `ApiResponse.sendSuccess`

**Routes** — `outlet.routes.ts` + daftarkan di `application.routes.ts`
- [x] `GET    /api/app/outlets`
- [x] `POST   /api/app/outlets`
- [x] `GET    /api/app/outlets/:id`
- [x] `PUT    /api/app/outlets/:id`
- [x] `PATCH  /api/app/outlets/:id/status`
- [x] `DELETE /api/app/outlets/:id`

**Testing** — `api/src/tests/outlet/` ✅ SELESAI
- [x] `outlet.service.test.ts` — 29 unit test: create (duplikat code 409, warehouse 404, warehouse type salah 422, sukses ±address), update (404, conflict 409, warehouse 404, type salah 422, upsert address), toggleStatus, delete (soft), list (semua filter), detail
- [x] `outlet.routes.test.ts` — 24 integration test: semua 6 endpoint, validasi 400/404/409/422
- [x] Global mock `prisma.outlet` + `prisma.outletAddress` + fixture RAW_MATERIAL (id=3) di `src/tests/setup.ts`
- [x] **Total: 53/53 tests passed** (↑ dari 50 setelah fix business rule)

---

### [S1-B] OutletInventory Module (Backend) ✅ SELESAI

**Catatan desain:**
- `OutletInventory` adalah stok **real-time** — tidak pakai snapshot per tanggal
- Di-init dengan qty = 0 saat produk baru didaftarkan ke outlet
- Hanya diubah oleh: StockTransfer (masuk) dan POS Transaction (keluar)

**Service** — `outlet-inventory.service.ts`
- [x] `getStock(outlet_id, product_id)` — stok satu produk + is_low_stock flag
- [x] `listStock(outlet_id, query)` — paginated list, filter search + low_stock, is_low_stock per item
- [x] `setMinStock(outlet_id, product_id, min_stock)` — set batas minimum
- [x] `initProducts(outlet_id, product_ids[])` — createMany skipDuplicates, return {initialized, total}
- [x] `adjustQuantity(outlet_id, product_id, delta, tx?)` — internal, throw 422 jika qty < 0

**Controller + Routes**
- [x] `GET   /api/app/outlets/:id/inventory` — list stok outlet
- [x] `GET   /api/app/outlets/:id/inventory/:product_id` — stok satu produk
- [x] `POST  /api/app/outlets/:id/inventory/init` — inisialisasi produk ke outlet
- [x] `PATCH /api/app/outlets/:id/inventory/:product_id/min-stock` — set minimum stok

**Testing** — `api/src/tests/outlet/`
- [x] `outlet-inventory.service.test.ts` — 19 unit tests
- [x] `outlet-inventory.routes.test.ts` — 20 integration tests
- [x] Global mock `prisma.outletInventory` di `src/tests/setup.ts`
- [x] **Total: 39/39 tests passed** (402 total keseluruhan)

---

### [S1-C] StockMovement Module (Backend)
**Estimasi:** 2 hari

**Catatan desain:**
- `StockMovement` adalah **read-only** dari sisi API — tidak ada endpoint POST publik
- Hanya dipanggil via `StockMovementService.log()` oleh service lain
- Semua operasi yang mengubah stok wajib memanggil ini

**Service** — `stock-movement.service.ts`
- [x] `log(data)` — internal method, create record. Dipanggil oleh service lain, bukan controller
- [x] `list(query)` — filter: entity_type, entity_id, location_type, location_id, movement_type, reference_type, date range, pagination
- [x] `detail(id)`
- [ ] `summarizeByPeriod(entity_id, location_id, month, year)` — total IN/OUT per periode

**Controller + Routes** (READ ONLY)
- [x] `GET /api/app/stock-movements` — list log
- [x] `GET /api/app/stock-movements/:id` — detail log

**Testing** — ✅ SELESAI
- [x] Unit test: log() simpan benar, list() filter kombinasi
- [x] Integration test routes

---

---
 
 ## 🔴 SPRINT 2 — Domain: Raw Material & Operations
 *(Target: 8 Apr – 28 Apr 2026)*

### [S2-A] StockTransfer Module — Core
**Estimasi:** 6–7 hari (modul paling kompleks)

**Skenario Transfer yang Didukung (Fokus Finish Goods):**
- Warehouse → Outlet (W→O) — Resupply ke toko (Utama)
- Outlet → Outlet (O→O) — Redistribusi antar toko
- Outlet → Warehouse (O→W) — Return stok
- *Warehouse → Warehouse (W→W) — (PENDING/Custom Raw Material Flow)*

**Zod Schema** — `stock-transfer.schema.ts`
- [x] `CreateTransferSchema`:
  - `from_type`: WAREHOUSE | OUTLET
  - `from_id`: warehouse_id atau outlet_id
  - `to_type`: WAREHOUSE | OUTLET
  - `to_id`: warehouse_id atau outlet_id
  - `items[]`: array {product_id, quantity_requested}
  - `notes?`: string
- [x] `ShipmentSchema` — `items[]`: {transfer_item_id, quantity_packed}, `shipment_notes?`
- [x] `ReceiveSchema` — `items[]`: {transfer_item_id, quantity_received}, `received_notes?`
- [x] `FulfillmentSchema` — `items[]`: {transfer_item_id, quantity_fulfilled, quantity_missing, quantity_rejected}, `fulfillment_notes?`
- [x] `UploadPhotoSchema` — `stage`: TransferPhotoStage, `caption?`: string
- [x] `QueryTransferSchema` — status, from_type, from_id, to_type, to_id, date range, barcode (search by scan)

**Service** — `stock-transfer.service.ts`

- [x] `create(body, created_by)`:
  - Validasi: from ≠ to (tidak boleh self-transfer)
  - Validasi: stok sumber cukup untuk setiap item
  - Auto-generate `transfer_number` (`TRF-YYYYMM-XXXX`)
  - Auto-generate `barcode` (8 karakter alfanumerik uppercase, collision-safe, contoh: `TF3X9K2M`)
  - Buat `StockTransfer` PENDING + `StockTransferItem[]`

- [x] `approve(id, approved_by)`:
  - Guard: status harus PENDING
  - Update status → APPROVED, set `approved_at`

- [x] `startShipment(id, items[], account_id)`:
  - Guard: status harus APPROVED
  - Update `quantity_packed` per item
  - Kurangi stok sumber (Warehouse atau Outlet):
    - Jika sumber Warehouse: kurangi `ProductInventory` (snapshot bulan ini)
    - Jika sumber Outlet: kurangi `OutletInventory`
  - **Call `StockMovementService.log({type: TRANSFER_OUT, ...})` per item**
  - Update status → SHIPMENT, set `shipped_at`

- [x] `confirmReceived(id, items[], account_id)`:
  - Guard: status harus SHIPMENT
  - Update `quantity_received` per item
  - Update status → RECEIVED, set `received_at`

- [x] `processFulfillment(id, items[], account_id)`:
  - Guard: status harus RECEIVED
  - Update `quantity_fulfilled`, `quantity_missing`, `quantity_rejected` per item
  - Validasi: `fulfilled + missing + rejected = received` per item
  - Tambah stok tujuan sebesar `quantity_fulfilled` (Warehouse atau Outlet)
  - **Call `StockMovementService.log({type: TRANSFER_IN, ...})` per item**
  - Update status → COMPLETED | PARTIAL | MISSING | REJECTED:
    - COMPLETED: semua item `fulfilled = requested`, `missing = 0`, `rejected = 0`
    - PARTIAL: ada item dengan `fulfilled < requested` tapi tidak ada missing/rejected
    - MISSING: ada item dengan `quantity_missing > 0`
    - REJECTED: ada item dengan `quantity_rejected > 0`
  - Set `fulfilled_at`

- [x] `cancel(id, account_id)`:
  - Guard: status harus PENDING atau APPROVED (tidak bisa cancel setelah SHIPMENT)
  - Update status → CANCELLED

- [ ] `uploadPhoto(id, stage, file, caption, account_id)`:
  - Simpan file ke storage, dapat URL
  - Buat record `StockTransferPhoto`
  - Foto boleh diupload di stage: SHIPMENT, RECEIVED, FULFILLMENT
- [ ] `deletePhoto(photo_id, account_id)` — hapus foto jika salah upload
- [ ] `getByBarcode(barcode)` — lookup transfer via scan barcode → return detail transfer
- [x] `list(query)` — filter status, from/to location, barcode search
- [x] `detail(id)` — include items (semua qty), photos (grouped by stage), info from/to

**Controller** — `stock-transfer.controller.ts`

**Routes** — `stock-transfer.routes.ts`
- [x] `GET    /api/app/stock-transfers` — list transfer (support filter + barcode search)
- [x] `POST   /api/app/stock-transfers` — create transfer (auto-generate barcode)
- [x] `GET    /api/app/stock-transfers/:id` — detail transfer + items + photos
- [ ] `GET    /api/app/stock-transfers/scan/:barcode` — lookup by barcode scan ⭐
- [x] `PATCH  /api/app/stock-transfers/:id/status` — update status (menggantikan spesifik approve/shipment/received/fulfillment route)
- [ ] `POST   /api/app/stock-transfers/:id/photos` — upload foto bukti fisik (multipart/form-data)
- [ ] `DELETE /api/app/stock-transfers/:id/photos/:photo_id` — hapus foto
- [ ] `DELETE /api/app/stock-transfers/:id` — cancel (PENDING|APPROVED → CANCELLED)

**Testing** — `api/src/tests/stock-transfer/` ✅ SELESAI
- [x] Unit test skenario W→O (warehouse ke outlet)
- [x] Unit test skenario O→O (antar outlet)
- [x] Unit test fulfillment PARTIAL (qty fulfilled < requested)
- [x] Unit test fulfillment MISSING (ada qty missing)
- [x] Unit test fulfillment REJECTED (ada qty rejected)
- [x] Unit test cancel setelah PENDING
- [x] Unit test cancel setelah APPROVED
- [x] Unit test error: cancel setelah SHIPMENT (harus 400)
- [x] Unit test error: stok sumber tidak cukup (harus 400)
- [x] Integration test semua endpoint
- [x] **Semua unit & integration test lulus (SOP Refactor verified)**

---

## 🟡 SPRINT 3 – POS Integration (Target: 29 Apr – 12 Mei 2026)

- [ ] Model `PosDevice` — registrasi POS device + device token JWT
- [ ] Middleware `posAuthMiddleware` — validasi `X-POS-Token` header
- [ ] Model `SalesTransaction` + `SalesTransactionItem` — data transaksi dari POS
- [ ] `POST /api/pos/auth` — auth device
- [ ] `POST /api/pos/sync/transactions` — sync batch transaksi (idempotent via `transaction_uuid`)
  - Auto-deduct `OutletInventory` per item
  - Log `StockMovement` (type: POS_SALE) per item
- [ ] `GET /api/pos/products` — katalog produk untuk POS
- [ ] `GET /api/pos/outlet/stock` — stok real-time outlet untuk POS display
- [ ] Buat `api/docs/POS-INTEGRATION.md`

---

## 🟡 SPRINT 4 — Alerts & Reports (Target: 13–28 Mei 2026)

### Stock Alert
- [ ] Model `StockAlert` + enum AlertType (LOW_STOCK, OVERSTOCK) + AlertStatus (ACTIVE, RESOLVED, DISMISSED)
- [ ] `StockAlertService.check()` — dipanggil setiap stok berubah
  - Integrasi di `StockTransfer.processFulfillment()` ✓
  - Integrasi di `OutletInventory.adjustQuantity()` ✓
- [ ] `GET /api/app/stock-alerts` — list alert
- [ ] `GET /api/app/stock-alerts/summary` — count badge untuk dashboard
- [ ] `PATCH /api/app/stock-alerts/:id/dismiss`

### Reports
- [ ] `GET /api/app/reports/stock-summary` — stok semua lokasi (warehouse + outlet)
- [ ] `GET /api/app/reports/stock-movements` — log pergerakan stok per periode
- [ ] `GET /api/app/reports/slow-moving` — produk jarang bergerak
- [ ] `GET /api/app/reports/transfer-summary` — ringkasan transfer per periode

---

## 🟢 SPRINT 5 — Purchase Order Full + Product Enrichment (Target: 29 Mei – 11 Jun 2026)

- [ ] `PurchaseOrder` + `PurchaseOrderItem` (gantikan `RawMaterialOpenPo` yang minimal)
- [ ] Fix enum `RawMaterialOpenPo.status` dari String → `OpenPoStatus` enum
- [ ] `ProductVariant` — varian produk dengan SKU berbeda
- [ ] `BundleItem` — produk bundle dari beberapa komponen
- [ ] Aktifkan relasi `MaterialRecommendationOrder.pic_id` → `Account`

---

## 🔵 SPRINT 6 — Frontend (Target: 12 Jun – 2 Jul 2026)

### Outlet ✅ SELESAI
- [x] `app/src/app/(application)/outlets/` — routing setup ✅
- [x] `server/outlet.schema.ts` + `server/outlet.service.ts` + `server/use.outlet.ts` ✅
- [x] `pages/outlets/index.tsx` — card list outlet + status badge ✅
- [x] `pages/outlets/[id]/page.tsx` — detail outlet + edit form integration ✅
- [x] `pages/outlets/form/outlet-form.tsx` — unified Create/Edit form with custom UI components ✅

### OutletInventory ✅ SELESAI
- [x] `pages/outlets/[id]/inventory.tsx` — tabel stok real-time outlet
- [ ] Set min stock per produk (inline edit)

### Stock Transfer ✅ SELESAI
- [x] `server/stock-transfer.schema.ts` + service + hooks
- [x] `pages/stock-transfers/index.tsx` — list transfer + status flow badge + barcode search input
- [x] `pages/stock-transfers/detail.tsx` — detail + qty tracker per stage + foto gallery per stage
- [x] `pages/stock-transfers/form/create.tsx` — form buat transfer (pilih from/to + items)
- [ ] Barcode display: tampilkan QR code / barcode dari field `barcode` di halaman detail & print label
- [ ] Upload foto per stage: drag & drop / camera capture (mobile-friendly)
- [x] Action buttons: Approve, Start Shipment, Confirm Received, Process Fulfillment

### Stock Movement Log ✅ SELESAI
- [x] `pages/stock-movements/index.tsx` — tabel log dengan filter
- [x] Filter: entity_type, location, movement_type, date range

---

## 📋 Definition of Done

Sebuah task dianggap selesai jika:
- [ ] `prisma migrate dev` berhasil tanpa error
- [ ] `prisma generate` menghasilkan types yang benar
- [ ] Unit test service lulus semua kasus (happy path + semua error case)
- [ ] Integration test routes lulus (200, 400, 404, 409)
- [ ] `ENDPOINT.md` diupdate
- [ ] Redis cache invalidation ditambahkan untuk operasi write
- [ ] RBAC (role check) diterapkan di route baru
- [ ] `StockMovementService.log()` dipanggil di semua operasi yang mengubah stok

---

## ⚠️ Aturan Tidak Boleh Dilanggar

1. **StockMovement adalah immutable** — tidak ada endpoint DELETE atau UPDATE
2. **Setiap perubahan stok = satu record StockMovement** — tidak ada pengecualian
3. **Cancel transfer hanya boleh sebelum SHIPMENT** — setelah barang keluar tidak bisa di-cancel, harus buat transfer baru untuk return
4. **`ProductInventory` (snapshot warehouse) jangan diubah pola-nya** — forecasting engine bergantung padanya
5. **`OutletInventory.quantity` tidak boleh < 0** — validasi wajib di `adjustQuantity()`
6. **Idempotency POS wajib** — cek `transaction_uuid` sebelum proses (Sprint 3)
