# Inventory V2 Module – ROADMAP

## Overview

Modul Inventory V2 mengelola semua pergerakan stok barang (Produk & Raw Material) di seluruh entitas (Gudang & Outlet). Modul ini merupakan inti dari sistem ERP untuk memastikan akurasi stok dan audit trail yang lengkap.

---

## Business Flows

### 1. Delivery Order (DO)
Aliran barang dari **Gudang (Warehouse)** ke **Outlet**.
- **Lifecycle**: `PENDING → APPROVED → SHIPMENT → RECEIVED → FULFILLMENT → COMPLETED`
- **Logic**:
  - `SHIPMENT`: Mengurangi stok di Gudang Asal.
  - `FULFILLMENT`: Menambah stok di Outlet Tujuan berdasarkan item yang diterima.
  - `REJECTION`: Jika ada barang ditolak saat fulfillment, otomatis membuat data **Return**.

### 2. Goods Receipt (GR)
Penerimaan barang masuk ke **Gudang**.
- **Lifecycle**: `PENDING → COMPLETED` (via Post)
- **Logic**:
  - `POST`: Menambah stok di Gudang tujuan dan mencatat movement.
  - Digunakan untuk penerimaan dari Supplier, hasil Produksi (QC FG), atau penyesuaian stok.

### 3. Transfer Gudang (TG)
Perpindahan barang antar **Gudang**.
- **Lifecycle**: `PENDING → APPROVED → SHIPMENT → RECEIVED → FULFILLMENT → COMPLETED/PARTIAL`
- **Logic**:
  - Mendukung pengiriman parsial jika stok dikirim dalam beberapa tahap.
  - `SHIPMENT`: Mengurangi stok Gudang Asal.
  - `FULFILLMENT`: Menambah stok Gudang Tujuan.

---

## Core Components

### `InventoryHelper`
Utility terpusat untuk memproses mutasi stok.
- **`deductWarehouseStock` / `addWarehouseStock`**: Mengelola tabel `ProductInventory` atau `RawMaterialInventory`.
- **`deductOutletStock` / `addOutletStock`**: Mengelola tabel `OutletInventory`.
- **`StockMovement`**: Setiap pemanggilan helper otomatis membuat record audit di tabel `StockMovement` dengan info `qty_before` dan `qty_after`.

### Monitoring
- **Stock Card**: Laporan kronologis mutasi stok per barang di lokasi tertentu.
- **Stock per Location**: Rekap saldo stok barang di seluruh lokasi (Gudang & Outlet).
- **Stock Total**: Total saldo stok konsolidasi.

---

## Database Schema (Key Tables)

```mermaid
erDiagram
    StockTransfer ||--|{ StockTransferItem : contains
    StockTransferItem ||--|| Product : references
    GoodsReceipt ||--|{ GoodsReceiptItem : contains
    StockMovement ||--|| Product : references
    ProductInventory ||--|| Warehouse : located_at
    OutletInventory ||--|| Outlet : located_at
```

---

## Movement Reference Types

| Type | Description |
|---|---|
| `STOCK_TRANSFER` | Aktivitas DO atau TG |
| `GOODS_RECEIPT` | Penerimaan barang (GR) |
| `PRODUCTION` | Pemakaian RM atau hasil FG produksi |
| `ADJUSTMENT` | Penyesuaian stok manual |
| `RETURN` | Pengembalian barang dari outlet/rejection |
