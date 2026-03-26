# 📡 Consolidated API Endpoint Documentation

This document contains all API endpoints available in the ERP backend.

> **Base URL**: `http://localhost:3000/api`
> **Authentication**: All routes under `/app/**` require a valid session cookie.
> **Standard Response**: `{ query?, status: "success", data: T }`
> **Error Response**: `{ success: false, error: "Type", message: "...", requestId: "uuid" }`

---

## 🔐 Authentication (`/api/auth`)

| Method | Path | Description | Auth Required |
| --- | --- | --- | --- |
| `POST` | `/auth/login` | Login with credentials | ❌ |
| `POST` | `/auth/logout` | Logout and destroy session | ✅ |
| `POST` | `/auth/register` | Register new account | ❌ |
| `GET` | `/auth/me` | Fetch active session data | ✅ |
| `GET` | `/csrf` | Generate fresh CSRF token | ✅ |

---

## 📦 Products (`/api/app/products`)

### Master Product
- `GET /` — List products (pagination, filter, sorting).
- `GET /:id` — Detailed product view.
- `POST /` — Create new product.
- `PUT /:id` — Update product details.
- `PATCH /status/:id` — Change status (`PENDING`, `ACTIVE`, `INACTIVE`, `DELETE`).
- `DELETE /clean` — Wipe all soft-deleted records permanenently.

### Product Utilities
- `GET /sizes` — List available sizes.
- `POST /sizes` — Create new size value.
- `GET /types` — List product categories.
- `POST /types` — Create new product type.
- `GET /units` — List measurement units.
- `POST /units` — Create new unit.

---

## 🧱 Raw Materials (`/api/app/rawmat`)

### Master Inventory
- `GET /` — List raw materials (filter by `type`, `status`, `search`).
- `GET /:id` — Detailed material view.
- `POST /` — Create material.
- `PUT /:id` — Update material info.
- `DELETE /:id` — Soft-delete material.
- `POST /:id/restore` — Restore soft-deleted material.
- `DELETE /clean` — Wipe soft-deleted materials permanently.

### Raw Material Utilities
- `GET /utils` — Fetch categories, suppliers, and units for dropdowns.
- `GET /utils/count` — Get counts for categories, suppliers, and units.
- `GET /utils/redis` — Fetch material list from Redis cache.

### Categories (`/categories`)
- `GET /` — List material categories.
- `POST /` — Create category.
- `PUT /:id` — Update category name/slug.
- `PATCH /:id/status` — Change category visibility.

### Suppliers (`/suppliers`)
- `GET /` — List available suppliers.
- `POST /` — Create new supplier.
- `PUT /:id` — Update supplier contact/address.

---

## 📐 Recipes & Formulas (`/api/app/recipes`)

### Formula Management
- `GET /` — List all product recipes.
- `POST /` — Define a new recipe for a product.
- `PUT /:id` — Update recipe details.
- `DELETE /:id` — Bulk delete or individual removal.
- `PATCH /:id/active` — Set specific formula version as "Active".

---

## 📊 Forecasting Engine (`/api/app/forecast`)

### Forecast Targets (`/forecast-percentages`)
- `GET /` — List target percentages by month/year.
- `POST /` — Create target.
- `POST /bulk` — Upsert multiple targets.
- `PUT /:id` — Update target value.

### Computation Engine
- `POST /run` — Execute forecasting across a specific horizon (max 12 months).
- `GET /` — View computed forecasts with filtering.
- `GET /:product_id` — Historical forecast trends for a product.
- `PATCH /finalize` — Lock DRAFT forecasts into FINALIZED state for procurement.
- `DELETE /period` — Wipe all forecast data for a specific month/year.

---

## 📄 Bill of Materials (`/api/app/bom`)

### BOM Explosion
- `GET /` — List all products with their required materials, forecast needs, and sales history.
- `GET /:id` — Detailed explosion for one product (supports ID or Product Code).

### Material Implosion (Reverse BOM)
- `GET /:barcode` — View all products that consume a specific material (identified by barcode). Includes inventory status and global requirement summary across all products.

---

## 🛒 Procurement Recommendations (`/api/app/recomendations`)

### Procurement Planning
- `GET /` — Get recommended purchase quantities based on `Forecast - (Stock RM + Open PO + FG + Safety Stock)`. Supports filtering by material `type` (ffo, lokal, impor).
- `POST /save-order` — Update manual order quantity by PIC.
- `POST /approve` — Approve a recommendation for purchasing (Status: ACC).

---

## 📥 Bulk Import Systems

| Module | Preview Path | Execution Path | Description |
| --- | --- | --- | --- |
| Products | `/api/app/products/import` | (integrated) | CSV/Excel product bulk upload. |
| Raw Materials | `/api/app/rawmat/import/preview` | `/execute` | Multi-step validation for materials. |
| Sales Actual | `/api/app/sales/import/preview` | `/execute` | Upload POS sales data to power forecasting. |
| Outlets      | `/api/app/outlets/import/preview` | `/execute` | (Planned) Bulk outlet creation. |

---

## 🏬 Outlets (`/api/app/outlets`)

> Outlet adalah **lokasi toko fisik** (bukan gudang). Setiap outlet dapat dikaitkan dengan satu Gudang Barang Jadi (FINISH_GOODS) sebagai sumber stok. Dirancang untuk integrasi POS ke depannya.

---

### `GET /api/app/outlets` — List Outlets

**Query Params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | 1 | Halaman |
| `take` | number | 25 | Jumlah per halaman (max 100) |
| `search` | string | — | Cari nama atau kode outlet |
| `is_active` | `"true"` \| `"false"` | — | Filter status aktif |
| `warehouse_id` | number | — | Filter berdasarkan gudang |
| `sortBy` | `name` \| `code` \| `created_at` \| `updated_at` | `updated_at` | Kolom sort |
| `sortOrder` | `asc` \| `desc` | `asc` | Arah sort |

**Response 200:**
```json
{
  "status": "success",
  "data": {
    "data": [
      {
        "id": 1,
        "name": "Toko Mandalika Bali",
        "code": "MND-BALI-01",
        "phone": "081234567890",
        "is_active": true,
        "warehouse_id": 2,
        "warehouse": { "id": 2, "name": "Gudang FG Jakarta", "type": "FINISH_GOODS" },
        "address": {
          "street": "Jl. Sunset Road No. 100",
          "city": "Badung",
          "province": "Bali",
          "postal_code": "80361",
          "country": "Indonesia",
          "notes": null,
          "url_google_maps": null
        },
        "_count": { "inventories": 0 },
        "created_at": "2026-03-18T07:00:00.000Z",
        "updated_at": null,
        "deleted_at": null
      }
    ],
    "len": 1
  }
}
```

---

### `GET /api/app/outlets/:id` — Detail Outlet

**Response 200:** Sama seperti satu item dari list.

**Response Error:**
- `404` — Outlet tidak ditemukan atau sudah dihapus

---

### `POST /api/app/outlets` — Create Outlet

**Request Body:**
```json
{
  "name": "Toko Mandalika Bali",
  "code": "MND-BALI-01",
  "phone": "081234567890",
  "warehouse_id": 2,
  "address": {
    "street": "Jl. Sunset Road No. 100",
    "district": "Kuta",
    "sub_district": "Seminyak",
    "city": "Badung",
    "province": "Bali",
    "country": "Indonesia",
    "postal_code": "80361",
    "notes": null,
    "url_google_maps": "https://goo.gl/maps/..."
  }
}
```

**Validasi:**
- `code` harus unik, uppercase, hanya `A-Z 0-9 -`
- `warehouse_id` opsional, jika diisi maka warehouse harus **bertipe `FINISH_GOODS`** dan tidak dihapus
- `address` opsional — dapat ditambah setelah create

**Response 201:**
```json
{ "status": "success", "data": { "id": 1, "name": "Toko Mandalika Bali", "code": "MND-BALI-01" } }
```

**Response Error:**
- `400` — Validasi Zod gagal
- `404` — `warehouse_id` tidak ditemukan
- `409` — Kode outlet sudah digunakan
- `422` — Gudang bukan tipe Barang Jadi (Finish Goods)

---

### `PUT /api/app/outlets/:id` — Update Outlet

**Request Body:** Sama seperti POST, semua field opsional (partial update).

**Response 200:**
```json
{ "status": "success", "data": { "id": 1, "name": "...", "code": "..." } }
```

**Response Error:**
- `404` — Outlet tidak ditemukan
- `409` — Kode baru sudah dipakai outlet lain
- `422` — Warehouse bukan tipe FINISH_GOODS

---

### `PATCH /api/app/outlets/:id/status` — Toggle Status Aktif

Toggle `is_active` dari `true` → `false` atau sebaliknya.

**Response 200:**
```json
{ "status": "success", "data": { "id": 1, "name": "...", "code": "...", "is_active": false } }
```

**Response Error:**
- `404` — Outlet tidak ditemukan atau sudah dihapus

---

### `DELETE /api/app/outlets/:id` — Soft Delete Outlet

Set `deleted_at = now()`. Outlet tidak akan muncul di list.

**Response 200:**
```json
{ "status": "success", "data": { "id": 1, "name": "...", "code": "..." } }
```

**Response Error:**
- `404` — Outlet tidak ditemukan atau sudah dihapus

---

### `DELETE /api/app/outlets/clean` — Permanent Delete (Sampah)

Hapus permanen semua outlet yang `is_active = false` **DAN** `deleted_at IS NOT NULL`.

**Response 200:**
```json
{ "status": "success", "data": { "message": "Data outlet yang non aktif berhasil dihapus" } }
```

**Response Error:**
- `400` — Tidak ada outlet non-aktif yang perlu dihapus

---

**Contoh curl:**
```bash
# List outlets
curl -X GET "http://localhost:3000/api/app/outlets?is_active=true&search=bali" -H "Cookie: session=..."

# Create outlet
curl -X POST "http://localhost:3000/api/app/outlets" \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: TOKEN" \
  -d '{"name":"Toko Bali","code":"MND-BALI-01","warehouse_id":2}'

# Toggle status
curl -X PATCH "http://localhost:3000/api/app/outlets/1/status" -H "x-csrf-token: TOKEN"
```

---

## 📦 Outlet Inventory (`/api/app/outlets/:id/inventory`)

> Stok **real-time** produk jadi (Finish Goods) di setiap outlet. Di-init dengan qty = 0. Hanya diubah oleh StockTransfer (masuk) dan POS Transaction (keluar).

### `GET /api/app/outlets/:id/inventory` — List Stok Outlet

**Query Params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | 1 | Halaman |
| `take` | number | 25 | Jumlah per halaman (max 100) |
| `search` | string | — | Cari nama atau kode produk |
| `low_stock` | `"true"` \| `"false"` | — | Filter hanya item stok rendah (qty < min_stock) |
| `sortBy` | `quantity` \| `min_stock` \| `updated_at` | `updated_at` | Kolom sort |
| `sortOrder` | `asc` \| `desc` | `asc` | Arah sort |

**Response 200:**
```json
{
  "status": "success",
  "data": {
    "data": [
      {
        "id": 1,
        "outlet_id": 1,
        "product_id": 1,
        "quantity": 10,
        "min_stock": 5,
        "is_low_stock": false,
        "updated_at": "2026-03-18T07:00:00.000Z",
        "product": { "id": 1, "name": "EDP 110ml", "code": "EDP_110" }
      }
    ],
    "len": 1
  }
}
```

**Response Error:**
- `404` — Outlet tidak ditemukan

---

### `GET /api/app/outlets/:id/inventory/:product_id` — Detail Stok Produk

**Response 200:** Sama seperti satu item dari list.

**Response Error:**
- `404` — Outlet tidak ditemukan
- `404` — Stok produk tidak ditemukan di outlet ini

---

### `POST /api/app/outlets/:id/inventory/init` — Inisialisasi Produk ke Outlet

Mendaftarkan satu atau lebih produk ke outlet dengan qty = 0. Idempotent (duplikat dilewati).

**Request Body:**
```json
{ "product_ids": [1, 2, 3] }
```

**Response 201:**
```json
{ "status": "success", "data": { "initialized": 3, "total": 3 } }
```

**Response Error:**
- `400` — `product_ids` kosong atau tidak valid
- `404` — Outlet tidak ditemukan
- `404` — Satu atau lebih produk tidak ditemukan

---

### `PATCH /api/app/outlets/:id/inventory/:product_id/min-stock` — Set Batas Minimum Stok

**Request Body:**
```json
{ "min_stock": 10 }
```

**Response 200:**
```json
{ "status": "success", "data": { "id": 1, "min_stock": 10, "product": { ... } } }
```

**Response Error:**
- `400` — `min_stock` negatif atau tidak dikirim
- `404` — Inventory entry tidak ditemukan

---

**Contoh curl:**
```bash
# List stok outlet
curl -X GET "http://localhost:3000/api/app/outlets/1/inventory?low_stock=true" -H "Cookie: session=..."

# Init produk ke outlet
curl -X POST "http://localhost:3000/api/app/outlets/1/inventory/init" \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: TOKEN" \
  -d '{"product_ids":[1,2,3]}'

# Set minimum stok
curl -X PATCH "http://localhost:3000/api/app/outlets/1/inventory/1/min-stock" \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: TOKEN" \
  -d '{"min_stock":10}'
```

---

## 📦 Stock Transfers (`/api/app/stock-transfers`)

> **Note:** Implementasi saat ini dioptimalkan untuk pergerakan **Finish Goods** dari Warehouse ke Outlet. Transfer antar Warehouse (Raw Material) ditangguhkan.

Modul untuk mencatat dan mengatur pergerakan barang dari Warehouse ke Outlet, antar Warehouse, atau antar Outlet.

### `GET /api/app/stock-transfers` — List Stock Transfers

**Query Params:**
- `page`, `take`, `sortBy`, `sortOrder`
- `search`: cari berdasarkan `transfer_number` atau `barcode`
- `status`: filter (PENDING, APPROVED, SHIPMENT, dll)
- `from_type` & `to_type`: WAREHOUSE | OUTLET

**Response 200:**
```json
{
  "status": "success",
  "data": {
    "data": [
      {
        "id": 1,
        "transfer_number": "TRF-20260318-0001",
        "barcode": "BCODE-001",
        "from_type": "WAREHOUSE",
        "from_warehouse_id": 1,
        "from_outlet_id": null,
        "to_type": "OUTLET",
        "to_warehouse_id": null,
        "to_outlet_id": 2,
        "status": "PENDING",
        "notes": "Weekly resupply",
        "shipped_at": null,
        "received_at": null,
        "fulfilled_at": null,
        "created_at": "2026-03-18T07:00:00.000Z",
        "updated_at": null,
        "items": []
      }
    ],
    "len": 1
  }
}
```

---

### `POST /api/app/stock-transfers` — Create Stock Transfer

Membuat transfer baru dengan status `PENDING`. Mengurangi stok belum dilakukan. Kode unik (barcode & transfer_number) dibuat otomatis.

**Request Body:**
```json
{
  "from_type": "WAREHOUSE",
  "from_warehouse_id": 1,
  "to_type": "OUTLET",
  "to_outlet_id": 2,
  "notes": "Resupply reguler outlet B",
  "items": [
    { "product_id": 1, "quantity_requested": 50 },
    { "product_id": 2, "quantity_requested": 30 }
  ]
}
```

---

### `GET /api/app/stock-transfers/:id` — Detail Stock Transfer
Termasuk array `items` (dengan breakdown qty diminta, dikirim, diterima, dll) dan relasi sumber/tujuan.

---

### `PATCH /api/app/stock-transfers/:id/status` — Update Status Transfer

Menggerakkan state machine dari Stock Transfer. Setiap stage mensyaratkan data payload spesifik:

**Stage 1:** `PENDING` -> `APPROVED`
```json
{ "status": "APPROVED", "notes": "Approved by supervisor" }
```

**Stage 2:** `APPROVED` -> `SHIPMENT`
*Saat ini stok sumber DIPAOTONG.*
```json
{
  "status": "SHIPMENT",
  "notes": "Packed and given to courier",
  "items": [
    { "id": 101, "quantity_packed": 50 } // id merujuk ke StockTransferItem.id
  ]
}
```

**Stage 3:** `SHIPMENT` -> `RECEIVED`
```json
{
  "status": "RECEIVED",
  "items": [
    { "id": 101, "quantity_received": 50 }
  ]
}
```

**Stage 4:** `RECEIVED` -> `FULFILLMENT` (Resolusi Akhir)
*Saat ini stok tujuan DITAMBAH dan system bisa auto-route ke status akhir.*
```json
{
  "status": "FULFILLMENT",
  "items": [
    { "id": 101, "quantity_fulfilled": 48, "quantity_missing": 1, "quantity_rejected": 1 }
  ]
}
```
> **Catatan:** Backend akan otomatis menyetel final status menjadi `COMPLETED`, `PARTIAL`, `MISSING`, atau `REJECTED` berdasarkan selisih fulfillment yang terlaporkan.

---

## 🧾 Stock Movements (`/api/app/stock-movements`)

> **Note:** Log ini saat ini difokuskan untuk memantau mutasi **Produk Jadi (Finish Goods)** secara akurat.

Audit log universal (Read Only) untuk seluruh mutasi stok, memastikan traceabilitas inventory berubah dengan tepat.

### `GET /api/app/stock-movements` — List Stock Movement Log

**Query Params:**
- `page`, `take`, `sortBy`, `sortOrder`
- `entity_type`: `PRODUCT` | `RAW_MATERIAL`
- `entity_id`: ID produk spesifik
- `location_type`: `WAREHOUSE` | `OUTLET`
- `location_id`: ID gudang/toko
- `movement_type`: filter pergerakan tertentu (`IN`, `OUT`, `TRANSFER_IN`, `TRANSFER_OUT`, `POS_SALE`, dll)
- `reference_type` & `reference_id`: tracing mutasi via ID relasi (mis. ke StockTransfer_ID)

### `GET /api/app/stock-movements/:id` — Detail Stock Movement
**Response 200:**
```json
{
  "status": "success",
  "data": {
    "id": 1,
    "entity_type": "PRODUCT",
    "entity_id": 101,
    "location_type": "WAREHOUSE",
    "location_id": 1,
    "movement_type": "TRANSFER_OUT",
    "quantity": -10,
    "qty_before": 100,
    "qty_after": 90,
    "reference_id": 501,
    "reference_type": "STOCK_TRANSFER",
    "created_at": "2026-03-18T07:30:00.000Z",
    "created_by": "system"
  }
}
```
