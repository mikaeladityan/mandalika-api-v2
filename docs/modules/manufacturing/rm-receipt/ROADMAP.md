# RM Receipt (Automated Transfers) – ROADMAP

## Overview

Modul RM Receipt (Penerimaan RM) mengelola transfer otomatis bahan baku dari gudang pasokan (**GRM-KDG**) ke gudang produksi (**GRM-PRD**) yang dipicu saat pembuatan *Production Order* jika terjadi kekurangan stok.

Modul ini menggunakan tabel `StockTransfer` dengan nomor dokumen berawalan `TRM-YYYYMMDD-XXXX`.

---

## Business Logic: Automated Trigger

Proses transfer otomatis dipicu di dalam `ManufacturingService.create`:

1.  **Pengecekan Stok**: Sistem mengecek stok bahan baku di Gudang Produksi (**GRM-PRD**) secara independen.
2.  **Identifikasi Shortfall**: Jika `stock_at_prd < quantity_planned`, sistem menghitung selisihnya (*shortfall*).
3.  **Pengecekan Pasokan**: Sistem mengecek ketersediaan bahan baku tersebut di Gudang Kandangan (**GRM-KDG**).
4.  **Pembuatan Transfer**: Jika ada stok di Kandangan, sistem membuat record `StockTransfer` dengan status `PENDING`.
    *   `quantity_requested` = MIN(*shortfall*, `stock_at_kdg`)
    *   `production_order_id` dihubungkan untuk traceability.

---

## Lifecycle Status (StockTransfer)

| Status | Deskripsi |
|---|---|
| **PENDING** | Dokumen baru dibuat, kuantitas permintaan masih bisa diubah (Draft). |
| **APPROVED** | Permintaan disetujui untuk diproses. |
| **SHIPMENT** | Barang dalam perjalanan dari Kandangan (deduct stok asal). |
| **RECEIVED** | Barang telah sampai di Produksi (siap diverifikasi). |
| **COMPLETED** | Stok berhasil dipindahkan secara penuh (Final). |
| **PARTIAL** | Transaksi selesai namun ada barang hilang/reject. |
| **CANCELLED** | Transaksi dibatalkan (stok dikembalikan jika sudah dikirim). |

---

## Method Service (`RmReceiptService`)

### `list(query)`
- Menampilkan daftar `StockTransfer` yang memiliki `production_order_id`.
- Filter: `status`, `fromDate`, `toDate`, `search` (transfer_number, mfg_number).
- Order: Terbaru di atas (`created_at DESC`).

### `detail(id)`
- Mengambil detail transfer termasuk item bahan baku, satuan (`unit`), info gudang, dan foto bukti.

### `updateItems(id, payload, userId)`
- Hanya diizinkan jika status masih `PENDING`.
- Memungkinkan penyesuaian `quantity_requested` sebelum transfer diproses.

### `updateStatus(id, payload, userId)`
- Menangani transisi status: `APPROVED`, `SHIPMENT`, `RECEIVED`, `FULFILLMENT`.
- Mengelola mutasi stok di gudang asal/tujuan secara transaksional.
- Mendukung pencatatan barang hilang (*missing*) dan rusak (*rejected*).

---

## Relasi Tabel

```
ProductionOrder
  └── stock_transfer (One-to-Many - but usually 1 TRM per order)
        ├── from_warehouse_id (GRM-KDG)
        ├── to_warehouse_id   (GRM-PRD)
        └── items[] (StockTransferItem)
              └── raw_material_id
```

---

## Frontend Integration

### 1. Hook: `useRmReceipts(query)`
- Fetching data list untuk tabel utama.

### 2. Hook: `useActionRmReceipt()`
- `updateItems`: Mutasi untuk menyesuaikan kuantitas permintaan.

### 3. Page Structure
- `RmReceiptPage`: Lokasi `/manufacturing-v2/inventory/rm-receipt`.
- Menampilkan `DataTable` dengan informasi No. Transfer, No. Produksi, dan Status.
- Dialog Edit untuk menyesuaikan kuantitas jika status `PENDING`.
