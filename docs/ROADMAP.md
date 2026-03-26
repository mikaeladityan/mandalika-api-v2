# 🗺️ Master Project Roadmap & Business Logic

This document consolidates the feature roadmaps, business logic, and future plans for all ERP modules.

---

## 📦 Product Lifecycle Management

- **Core Module**: Central repository for all fragrance products (`EDP`, `Perfume`, etc.).
- **Versioning**: Each product is tracked through multiple identity fields (Code, Name, Size, Type).
- **Find-or-Create Logic**: Flexible creation of product attributes (Units, Types, Sizes) during main product insertion via slugs.
- **Safety Stock Parameters**: Each product carries `z_value`, `lead_time`, and `review_period` which power inventory calculations.

---

## 🧱 Raw Material Inventory

- **Comprehensive Tracking**: Materials are classified by `type` (Fabric, Accessories, Packaging, Fragrance Oil).
- **Protective Integrity**: Categories and Suppliers cannot be deleted if they are actively referenced by raw materials.
- **Soft Delete Management**: Materials can be restored after deletion, with a secondary "Clean" operation for permanent removal.
- **Utility Support**: Specialized endpoints to provide fast dropdown and combobox data for frontend forms.

---

## 📐 Recipe & Formula Engineering

- **Formula Repository**: The heart of the production system, defining how products are composed of various raw materials.
- **Recipe Versioning**: Supports iterative improvements to fragrance formulas. Only one version can be "Active" per product-material pair at any time.
- **Multiplier Logic**: Automatic consumption scaling based on **Product Size** for Fragrance Oil and volume-based materials.
- **Consistency Guard**: Cascading deletions ensure that removing a product or material cleans up its associated recipes.

---

## 📊 Forecasting Engine

- **Targeted Growth**: Uses administrator-defined `ForecastPercentage` to project future needs based on `SalesActual`.
- **Intelligent Aggregation**: Implements specialized logic for fragrance sets (e.g., EDP 110ml vs 2ml) where smaller sizes can follow the forecast trends of parent products.
- **Execution Horizons**: Precomputes up to 12 months in advance, provided that growth targets are available for each period.
- **Draft to Finalization**: A two-stage process where computed values can be adjusted before being "locked" for procurement planning.

---

## 📄 Bill of Materials (BOM)

- **Deep Visibility**: Provides an integrated view of product composition, historical sales, and projected material needs.
- **Explosion & Implosion**: 
    - **Explosion**: Breaking a product down into its constituent materials.
    - **Implosion (Reverse BOM)**: Seeing all products that will be impacted by the availability (or shortage) of a specific material.
- **Inventory Sync**: Real-time comparison between current material stock and future needs across all active recipes.

---

## 🛒 Procurement Recommendations

- **Planning Tool**: A decision-support module for the procurement team.
- **Standard Formula**: `Recommendation = Forecast - (Stock RM + Open PO + FG Stock + Safety Stock)`.
- ** PIC Adjustments**: Procurement officers can override system recommendations with manual order quantities.
- **Approval Workflow**: A clear separation between "Draft" intent and "Approved" (ACC) orders.

---

## 📥 Mass Data Operations (Import)

- **Systematic Uploads**: Supports bulk ingestion for Products, Raw Materials, and Sales via a three-step cycle:
    1. **Parsing**: Reading the file content.
    2. **Preview/Validate**: Reviewing valid vs. invalid rows with specific error reporting.
    3. **Execute**: Atomically committing valid data to the database.

---

## 🏬 Retail & Outlet Management

Outlet adalah **lokasi toko fisik** tempat produk jadi (Finish Goods) dijual ke konsumen akhir. Berbeda dengan Warehouse yang berfungsi sebagai gudang penyimpanan, Outlet mewakili titik distribusi ritel yang dapat terhubung langsung ke sistem POS.

### Relasi Tabel

```
Outlet (1) ──── (0..1) Warehouse [type: FINISH_GOODS only]
Outlet (1) ──── (0..1) OutletAddress
Outlet (1) ──── (0..N) OutletInventory  [Sprint 1-B]
```

### Business Rules

- **FINISH_GOODS Only**: Outlet **hanya dapat dikaitkan** dengan Warehouse bertipe `FINISH_GOODS`. Jika `warehouse_id` diisi dengan gudang bertipe `RAW_MATERIAL` atau lainnya, sistem menolak dengan HTTP `422`.
- **Soft Delete Pattern**: `DELETE /:id` tidak menghapus data permanen — hanya mengisi `deleted_at = now()`. Outlet yang di-soft-delete tidak muncul di list.
- **is_active Toggle**: `PATCH /:id/status` membalik nilai `is_active` antara `true` dan `false`. Status ini independen dari soft-delete.
- **Permanent Clean**: `DELETE /clean` hanya menghapus outlet yang **sekaligus** `is_active = false` DAN `deleted_at IS NOT NULL`.
- **Code Uniqueness**: `code` outlet harus unik di seluruh sistem, uppercase, hanya mengandung `A-Z`, `0-9`, dan `-`.

### Method Service

| Method | Input | Output | Business Rule |
|--------|-------|--------|---------------|
| `create(body)` | `RequestOutletDTO` | `{ id, name, code }` | Cek duplikat code (409), validasi warehouse type (422 jika bukan FG), create dengan optional address |
| `update(id, body)` | `UpdateOutletDTO` | `{ id, name, code }` | Cek outlet exist (404), cek code conflict dengan outlet lain (409), validasi warehouse type (422), upsert address jika ada |
| `toggleStatus(id)` | outlet id | `{ id, name, code, is_active }` | Cek outlet exist & tidak di-delete (404), flip nilai `is_active` |
| `delete(id)` | outlet id | `{ id, name, code }` | Cek outlet exist & tidak di-delete (404), set `deleted_at = now()` |
| `clean()` | — | `{ message }` | Cek ada outlet target (400 jika 0), `deleteMany` di mana `is_active: false` DAN `deleted_at != null` |
| `list(query)` | `QueryOutletDTO` | `{ data[], len }` | Pagination + filter `is_active`, `warehouse_id`, `search` (name/code). Sort by `name`/`code`/`created_at`/`updated_at`. |
| `detail(id)` | outlet id | `ResponseOutletDTO` | Cek outlet exist & tidak di-delete (404), return dengan relasi `warehouse` + `address` + `_count` |

### Rencana Sprint

| Sprint | Fitur | Status |
|--------|-------|--------|
| S1-A | CRUD Outlet + alamat + toggle status + clean | ✅ Done |
| S1-B | OutletInventory — stok barang jadi per outlet | ✅ Done |
| S1-C | StockMovement — log mutasi stok (read-only) | 🔲 Planned |
| S2-A | StockTransfer — transfer stok antar outlet/gudang | 🔲 Planned |
| S2-B | POS Integration — endpoint untuk sistem kasir | 🔲 Planned |
