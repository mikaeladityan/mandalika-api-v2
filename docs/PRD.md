# Product Requirements Document (PRD)
## Mandalika ERP — Inventory Control System

**Version:** 2.0.0
**Date:** 2026-03-18
**Author:** Engineering Team
**Status:** Active Development

---

## 1. Executive Summary

Mandalika ERP adalah sistem manajemen inventaris berbasis cloud yang dibangun khusus untuk industri fragrance/parfum. Sistem ini mengelola seluruh rantai pasokan — mulai dari pembelian bahan baku dari supplier, produksi, penyimpanan di gudang, distribusi ke outlet/toko, hingga penjualan di titik kasir (POS).

Sistem terdiri dari dua domain utama yang saling terhubung:

| Domain | Deskripsi |
|--------|-----------|
| **ERP Core** | Manajemen gudang, bahan baku, produk, forecast, procurement |
| **Outlet + POS Integration** | Manajemen toko, stok outlet real-time, integrasi sistem kasir |

---

## 2. Goals & Objectives

| Goal | Metric Target |
|------|---------------|
| Real-time stock visibility di gudang & outlet | Akurasi stok ≥ 99.5% |
| Kurangi stockout di outlet | Turunkan kejadian stockout ≥ 30% |
| Efisiensi Purchase Order | Waktu pembuatan PO berkurang 50% |
| Multi-outlet support | Support ≥ 50 outlet per akun |
| Forecasting akurat | Error forecast ≤ 15% dari aktual |
| POS Integration | Sync transaksi < 5 detik per batch |
| Audit trail penuh | 100% pergerakan stok tercatat |

---

## 3. User Personas

### 3.1 Owner / SUPER_ADMIN
- Pemilik bisnis yang ingin visibilitas penuh atas seluruh operasional
- Kebutuhan: Dashboard ringkasan semua gudang & outlet, laporan, setting sistem, kelola user

### 3.2 Warehouse Manager
- Manajer gudang yang mengelola stok bahan baku dan produk jadi
- Kebutuhan: Kelola PO, terima barang, proses transfer ke outlet, stock opname gudang

### 3.3 Outlet Manager
- Manajer toko yang mengelola operasional outlet harian
- Kebutuhan: Monitor stok outlet, request resupply dari gudang, stock opname toko

### 3.4 Purchasing Team
- Tim pembelian yang mengelola hubungan supplier
- Kebutuhan: Buat dan track purchase order, kelola data supplier, lihat procurement recommendation

### 3.5 Cashier / POS Operator
- Staff kasir di outlet yang melakukan transaksi penjualan via POS
- Kebutuhan: Tidak langsung berinteraksi dengan ERP — interaksi via POS device yang terintegrasi

### 3.6 DEVELOPER
- Internal developer yang mengelola sistem
- Kebutuhan: Akses penuh ke semua fitur termasuk konfigurasi sistem

---

## 4. Feature Requirements

### 4.1 Authentication & User Management (SUDAH ADA)
| ID | Feature | Priority | Status |
|----|---------|----------|--------|
| F01 | Login / Logout dengan session Redis | P0 | ✅ Done |
| F02 | Register akun baru | P0 | ✅ Done |
| F03 | Email verification | P0 | ✅ Done |
| F04 | Role-based access control (OWNER, SUPER_ADMIN, STAFF, DEVELOPER) | P0 | ✅ Done |
| F05 | CSRF protection | P0 | ✅ Done |
| F06 | Rate limiting & suspicious activity detection | P0 | ✅ Done |

### 4.2 Product Management (SUDAH ADA)
| ID | Feature | Priority | Status |
|----|---------|----------|--------|
| F07 | CRUD produk dengan kode, nama, ukuran, tipe, satuan | P0 | ✅ Done |
| F08 | Safety stock parameter (z_value, lead_time, review_period) | P0 | ✅ Done |
| F09 | Product status lifecycle (PENDING → ACTIVE → BLOCK → DELETE) | P0 | ✅ Done |
| F10 | Bulk import produk dari CSV/Excel | P1 | ✅ Done |
| F11 | Product variants (ukuran, warna) | P1 | ⬜ Planned |
| F12 | Bundle products (produk terdiri dari beberapa komponen) | P1 | ⬜ Planned |

### 4.3 Raw Material Management (SUDAH ADA)
| ID | Feature | Priority | Status |
|----|---------|----------|--------|
| F13 | CRUD bahan baku dengan kategori, supplier, satuan | P0 | ✅ Done |
| F14 | Soft delete + restore bahan baku | P0 | ✅ Done |
| F15 | Klasifikasi material (FO = Fragrance Oil, PCKG = Packaging) | P0 | ✅ Done |
| F16 | Bulk import bahan baku | P1 | ✅ Done |
| F17 | Supplier management | P0 | ✅ Done |

### 4.4 Recipe / Bill of Materials (SUDAH ADA)
| ID | Feature | Priority | Status |
|----|---------|----------|--------|
| F18 | CRUD resep produk dari bahan baku | P0 | ✅ Done |
| F19 | Recipe versioning — hanya satu versi aktif per produk-material | P0 | ✅ Done |
| F20 | Multiplier otomatis berdasarkan ukuran produk (untuk FO) | P1 | ✅ Done |
| F21 | BOM explosion (breakdown produk ke semua bahan baku) | P1 | ✅ Done |
| F22 | BOM implosion / reverse BOM (material → produk yang menggunakannya) | P1 | ✅ Done |

### 4.5 Forecasting Engine (SUDAH ADA)
| ID | Feature | Priority | Status |
|----|---------|----------|--------|
| F23 | Input sales aktual per produk per bulan | P0 | ✅ Done |
| F24 | Bulk import sales aktual dari POS | P1 | ✅ Done |
| F25 | Setting target persentase pertumbuhan per bulan | P0 | ✅ Done |
| F26 | Komputasi forecast hingga 12 bulan ke depan | P0 | ✅ Done |
| F27 | Draft → Finalized forecast workflow | P0 | ✅ Done |
| F28 | Safety stock calculation (z_value × lead_time) | P0 | ✅ Done |
| F29 | Procurement recommendation (Forecast - Stock - OpenPO - Safety Stock) | P0 | ✅ Done |

### 4.6 Warehouse & Inventory Management (SEBAGIAN ADA)
| ID | Feature | Priority | Status |
|----|---------|----------|--------|
| F30 | CRUD gudang dengan alamat | P0 | ✅ Done |
| F31 | Snapshot stok produk & bahan baku di gudang per tanggal | P0 | ✅ Done |
| F32 | Stock Movement Log — audit trail semua pergerakan stok | P0 | ⬜ Sprint 1 |
| F33 | Purchase Order lengkap (Draft → Approved → Received) | P0 | ⬜ Sprint 2 |
| F34 | Partial fulfillment pada penerimaan PO | P1 | ⬜ Sprint 2 |
| F35 | Stock Adjustment / Opname gudang | P0 | ⬜ Sprint 2 |

### 4.7 Outlet Management (BELUM ADA)
| ID | Feature | Priority | Status |
|----|---------|----------|--------|
| F36 | CRUD outlet/toko dengan alamat | P0 | ⬜ Sprint 1 |
| F37 | Assign staff/manager ke outlet | P0 | ⬜ Sprint 1 |
| F38 | Stok real-time per produk per outlet (OutletInventory) | P0 | ⬜ Sprint 1 |
| F39 | Set minimum stok per produk per outlet | P0 | ⬜ Sprint 1 |
| F40 | Stock Transfer — Warehouse ke Outlet (resupply) | P0 | ⬜ Sprint 2 |
| F41 | Stock Transfer — Outlet ke Outlet | P1 | ⬜ Sprint 2 |
| F42 | Stock Adjustment / Opname outlet | P0 | ⬜ Sprint 2 |

### 4.8 POS Integration (BELUM ADA)
| ID | Feature | Priority | Status |
|----|---------|----------|--------|
| F43 | Registrasi POS device per outlet (generate device token) | P0 | ⬜ Sprint 3 |
| F44 | Autentikasi POS via device token (X-POS-Token header) | P0 | ⬜ Sprint 3 |
| F45 | Sync batch transaksi penjualan dari POS ke ERP | P0 | ⬜ Sprint 3 |
| F46 | Idempotency — mencegah duplikasi transaksi saat offline sync | P0 | ⬜ Sprint 3 |
| F47 | Auto-deduct OutletInventory dari setiap transaksi POS | P0 | ⬜ Sprint 3 |
| F48 | Sync katalog produk dari ERP ke POS | P1 | ⬜ Sprint 3 |
| F49 | Cek stok outlet secara real-time dari POS | P1 | ⬜ Sprint 3 |
| F50 | Aggregate SalesTransaction → SalesActual (untuk forecasting) | P1 | ⬜ Sprint 3 |

### 4.9 Alerts & Notifications (BELUM ADA)
| ID | Feature | Priority | Status |
|----|---------|----------|--------|
| F51 | Low stock alert otomatis (stok < min_stock) | P0 | ⬜ Sprint 4 |
| F52 | Alert berlaku di level gudang maupun outlet | P0 | ⬜ Sprint 4 |
| F53 | Auto-resolve alert saat stok kembali normal | P1 | ⬜ Sprint 4 |
| F54 | Dismiss alert dengan alasan | P1 | ⬜ Sprint 4 |
| F55 | Riwayat semua alert | P2 | ⬜ Sprint 4 |

### 4.10 Reports & Analytics (BELUM ADA)
| ID | Feature | Priority | Status |
|----|---------|----------|--------|
| F56 | Stock summary — ringkasan stok semua lokasi | P0 | ⬜ Sprint 4 |
| F57 | Stock movement report per periode | P0 | ⬜ Sprint 4 |
| F58 | Slow moving product report | P1 | ⬜ Sprint 4 |
| F59 | Purchase report per supplier/periode | P1 | ⬜ Sprint 4 |
| F60 | Outlet sales report dari data POS | P1 | ⬜ Sprint 4 |

---

## 5. Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| Performance | API response time < 200ms untuk 95% request |
| Availability | Uptime ≥ 99.9% |
| Security | Session-based auth (Redis), CSRF protection, RBAC |
| POS Auth | Device token (JWT) dengan expiry 1 tahun, revocable |
| Offline POS | POS harus bisa beroperasi offline dan sync saat online |
| Idempotency | Semua operasi sync POS menggunakan `transaction_uuid` |
| Scalability | Horizontal scaling ready, stateless API |
| Audit Trail | 100% perubahan stok tercatat di `StockMovement` |
| Data Integrity | Database transactions untuk semua operasi yang mempengaruhi stok |

---

## 6. Role & Permission Matrix

| Permission | OWNER | SUPER_ADMIN | STAFF | DEVELOPER |
|-----------|-------|-------------|-------|-----------|
| Dashboard semua lokasi | ✅ | ✅ | ❌ | ✅ |
| Kelola produk & bahan baku | ✅ | ✅ | ❌ | ✅ |
| Buat & approve PO | ✅ | ✅ | ❌ | ✅ |
| Terima barang PO | ✅ | ✅ | ✅ | ✅ |
| Kelola outlet | ✅ | ✅ | ❌ | ✅ |
| Stock transfer | ✅ | ✅ | ✅ | ✅ |
| Stock adjustment | ✅ | ✅ | ✅ | ✅ |
| Registrasi POS device | ✅ | ✅ | ❌ | ✅ |
| Lihat laporan | ✅ | ✅ | ❌ | ✅ |
| Kelola user | ✅ | ✅ | ❌ | ✅ |
| Setting forecast | ✅ | ✅ | ❌ | ✅ |

---

## 7. Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js LTS |
| Framework | Hono (TypeScript) |
| ORM | Prisma v6 |
| Database | PostgreSQL |
| Cache & Session | Redis |
| Testing | Vitest |
| Logging | Winston |
| Validation | Zod |
| POS Auth | JWT (device token) |
