# System Summary & Architecture Overview

## Mandalika ERP — Inventory Control System

**Version:** 2.0
**Last Updated:** 2026-03-18
**Status:** Active Development

---

## 1. Tentang Sistem

Mandalika ERP adalah sistem manajemen inventaris berbasis cloud untuk industri fragrance/parfum. Sistem mengelola seluruh rantai pasokan: pembelian bahan baku → produksi → gudang → distribusi ke toko → penjualan via POS.

**Tech Stack:**

| Layer           | Teknologi          |
| --------------- | ------------------ |
| Runtime         | Node.js LTS        |
| Framework       | Hono (TypeScript)  |
| ORM             | Prisma v6          |
| Database        | PostgreSQL         |
| Cache & Session | Redis              |
| Testing         | Vitest             |
| Validation      | Zod                |
| POS Auth        | JWT (device token) |

---

## 2. Arsitektur Dua Domain

```
┌─────────────────────────────────────────────────────────────┐
│                        ERP CORE                             │
│                                                             │
│  Supplier → PurchaseOrder → Warehouse → StockTransfer       │
│                                │                            │
│  Forecasting ← SalesActual     │ (Resupply)                 │
│       ↓                        ↓                            │
│  Procurement Recommendation  Outlet (Toko)                  │
│                                │                            │
└────────────────────────────────┼────────────────────────────┘
                                 │
┌────────────────────────────────┼────────────────────────────┐
│               POS INTEGRATION  │                            │
│                                ↓                            │
│            POS Device → SalesTransaction                    │
│                                │                            │
│                    Auto-deduct OutletInventory              │
│                                │                            │
│                    Log StockMovement (POS_SALE)             │
│                                │                            │
│                    → SalesActual → Forecasting              │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Konsep Kunci: Outlet ≠ Warehouse

|                    | Outlet (Toko)                       | Warehouse (Gudang)                     |
| ------------------ | ----------------------------------- | -------------------------------------- |
| **Definisi**       | Titik penjualan retail / toko fisik | Tempat penyimpanan stok sentral        |
| **Tabel stok**     | `OutletInventory` — real-time       | `ProductInventory` — snapshot historis |
| **Penambah stok**  | Stock Transfer dari Warehouse (Finish Good) | Purchase Order dari Supplier           |
| **Pengurang stok** | POS Transaction (otomatis)                  | Stock Transfer ke Outlet (Finish Good) |
| **Integrasi**      | POS System                                  | Procurement & Forecasting              |
| **Auth**           | Device Token (X-POS-Token)                  | Session Cookie (user login)            |
| **Note**           | Fokus: Produk Jadi (Finish Goods)           | Fokus: Bahan Baku & Produk Jadi        |

---

### 🟢 Domain 1: Finish Goods (Warehouse → Outlet)
*Fokus: Distribusi, Penjualan POS, Stok Toko.*

| Modul | Backend | Test | Frontend | Sprint |
|-------|---------|------|----------|--------|
| **Outlet Management** | ✅ | ✅ | ✅ | Sprint 1 |
| **OutletInventory** | ✅ | ✅ | ❌ | Sprint 1 |
| **StockMovement Log (FG)** | ✅ | ✅ | ❌ | Sprint 1 |
| **Stock Transfer (W→O)** | ✅ | ✅ | ❌ | Sprint 1 |
| **POS Integration** | ❌ | ❌ | ❌ | Sprint 3 |

### 🔵 Domain 2: Raw Material & Production (Supplier → Warehouse)
*Fokus: Pengadaan, Stok Gudang, Produksi.*

| Modul | Backend | Test | Frontend | Sprint |
|-------|---------|------|----------|--------|
| **Raw Material Master** | ✅ | ✅ | ✅ | Done |
| **Supplier Management** | ✅ | ✅ | ✅ | Done |
| **Recipe / BOM** | ✅ | ✅ | ✅ | Done |
| **Procurement Recommendation** | ✅ | ✅ | ✅ | Done |
| **Purchase Order (full)** | ❌ | ❌ | ❌ | Sprint 2 |
| **W→W Transfer (RM)** | ❌ | ❌ | ❌ | Pending |

### 🟡 Domain 3: Intelligence & Others

| Modul | Backend | Test | Frontend | Sprint |
|-------|---------|------|----------|--------|
| Auth & User | ✅ | ✅ | ✅ | Done |
| Forecasting Engine | ✅ | ✅ | ✅ | Done |
| Safety Stock | ✅ | ✅ | ✅ | Done |
| Stock Adjustment | ❌ | ❌ | ❌ | Sprint 2 |
| Stock Alert | ❌ | ❌ | ❌ | Sprint 4 |
| Reports | ❌ | ❌ | ❌ | Sprint 4 |


**Test Coverage (2026-03-18):** 402 tests / 26 test files — semua passing.

---

## 5. Timeline Solo Developer + AI

```
SPRINT 1  │ Foundation          │ 3 minggu │ 18 Mar – 7 Apr 2026
SPRINT 2  │ Operations          │ 3 minggu │ 8 Apr – 28 Apr 2026
SPRINT 3  │ POS Integration     │ 2 minggu │ 29 Apr – 12 Mei 2026
SPRINT 4  │ Alerts & Reports    │ 1.5 mgg  │ 13 Mei – 20 Mei 2026
SPRINT 5  │ Product Enrichment  │ 1.5 mgg  │ 21 Mei – 28 Mei 2026
SPRINT 6  │ Frontend            │ 5 minggu │ 29 Mei – 2 Jul 2026
─────────────────────────────────────────────────────────────
TOTAL     │                     │ 17 minggu│ Estimasi ~4 bulan
```

---

## 6. Prinsip Arsitektur Wajib

### 6.1 StockMovement sebagai Universal Audit Log

Setiap operasi yang mengubah stok **wajib** membuat satu record di `StockMovement`. Tidak ada pengecualian.

```
PO Received      → StockMovement (IN, entity: RAW_MATERIAL, location: WAREHOUSE)
Transfer Dispatch → StockMovement (TRANSFER_OUT, location: sumber)
Transfer Receive  → StockMovement (TRANSFER_IN, location: tujuan)
Adjustment Apply  → StockMovement (OPNAME, per item)
POS Sale         → StockMovement (POS_SALE, location: OUTLET)
```

### 6.2 Idempotency untuk POS

Setiap transaksi POS harus memiliki `transaction_uuid` yang di-generate oleh POS device. ERP akan skip transaksi yang uuid-nya sudah ada. Ini memastikan tidak ada duplikasi data saat POS retry sync setelah offline.

### 6.3 Pemisahan Endpoint Auth

- `/api/app/**` — autentikasi via session cookie (user ERP)
- `/api/pos/**` — autentikasi via `X-POS-Token` header (POS device)

### 6.4 Data Flow: SalesTransaction → SalesActual → Forecasting

```
SalesTransaction (detail per transaksi dari POS)
        ↓ aggregasi per bulan
SalesActual (total penjualan per produk per bulan)
        ↓ input forecasting
Forecast → SafetyStock → Procurement Recommendation
```

---

## 7. Inventory Flow Optimization (Warehouse → Outlet)

Sistem saat ini dioptimalkan khusus untuk pergerakan **Finish Goods (Produk Jadi)** dari Warehouse ke Outlet.

*   **Stock Transfer**: Fokus pada distribusi stok ke toko retail.
*   **Stock Movement**: Log mutasi produk secara detail (IN/OUT/TRANSFER).
*   **W→W Transfer**: Skenario pindah stok antar gudang (Raw Material) ditangguhkan (PENDING) karena memerlukan flow custom/manual.


---

## 7. Referensi Dokumen

| Dokumen              | Isi                                                      |
| -------------------- | -------------------------------------------------------- |
| `PRD.md`             | Feature requirements lengkap, user personas, role matrix |
| `ERD.md`             | Entity relationship diagram semua tabel                  |
| `FLOW.md`            | Flowchart semua alur bisnis (Mermaid)                    |
| `SCHEMA.md`          | Kode Prisma schema siap pakai untuk semua sprint         |
| `TODO.md`            | Checklist task detail per sprint + timeline              |
| `ENDPOINT.md`        | Dokumentasi semua API endpoint                           |
| `ROADMAP.md`         | Business logic summary per modul                         |
| `FRONTEND_INTEGRATION_GUIDE.md` | Panduan integrasi UI untuk Outlet & Transfer |
| `RAW_MATERIAL_GUIDE.md` | **Panduan Lengkap Pengadaan & Stok Bahan Baku** |
| `architecture.md`    | Arsitektur teknis & request lifecycle                    |
| `POS-INTEGRATION.md` | Panduan integrasi POS (dibuat di Sprint 3)               |

---

## 8. Gap yang Harus Diperhatikan

### Gap Kritis (Harus diselesaikan Sprint 1 & 2)

1. **Audit trail stok selesai** — `StockMovement` (✅ Selesai) _(S1-C)_
2. ~~Tidak ada model Outlet~~ — **✅ Selesai** (S1-A + S1-B)
3. **PO hanya versi minimal** — `RawMaterialOpenPo` tidak punya approval workflow dan item detail _(Sprint 2)_

### Keputusan Teknis yang Perlu Dijaga

1. **`ProductInventory` (existing) jangan diubah pola snapshot-nya** — forecasting engine bergantung padanya
2. **`OutletInventory` adalah real-time** — tidak pakai snapshot per tanggal
3. **`RawMaterialOpenPo` akan di-deprecate** setelah modul `PurchaseOrder` baru selesai
4. **`MaterialType (FO, PCKG)`** adalah domain-specific untuk industri fragrance — dokumentasikan untuk developer baru
