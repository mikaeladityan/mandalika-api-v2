# RFQ Module – Business Flow & Roadmap

## Overview

Modul RFQ (Request for Quotation) adalah tahap pengadaan yang berjalan **setelah Konsolidasi disetujui** dan **sebelum Open PO terbentuk**. Modul ini memungkinkan tim Purchasing untuk meminta penawaran harga dari vendor, menegosiasikan harga, lalu mengkonversi ke Purchase Order yang sesungguhnya.

---

## Business Flow

```
Consolidation (APPROVED)
        │
        ▼ auto / manual
  ┌─────────────┐
  │  RFQ: DRAFT │ ◄── Juga bisa dibuat manual (tanpa draft konsolidasi)
  └─────────────┘
        │  Send to vendor
        ▼
  ┌─────────────┐
  │  RFQ: SENT  │
  └─────────────┘
        │  Quote diterima, update unit_price di items
        ▼
  ┌──────────────────┐
  │  RFQ: RECEIVED   │
  └──────────────────┘
        │  Manager review & approve
        ▼
  ┌──────────────────┐
  │  RFQ: APPROVED   │
  └──────────────────┘
        │  Pilih items → convert ke Open PO
        ├─────────────────────────────────┐
        ▼                                 ▼
  ┌───────────────────────┐     ┌─────────────────────────┐
  │ RFQ: PARTIAL_CONVERTED│     │    RFQ: CONVERTED       │
  │ (sebagian item saja)  │     │  (semua item di-PO-kan) │
  └───────────────────────┘     └─────────────────────────┘
        │ Sisa items convert
        └──────────────────────────────────►┘
                                            ▼
                                   ┌─────────────────┐
                                   │  Open PO (OPEN) │
                                   └─────────────────┘
```

Di setiap tahap bisa menuju `CANCELLED` (terminal).

---

## Status Lifecycle

| Status | Makna | Edit Header? | Edit Items? |
|---|---|---|---|
| `DRAFT` | Baru dibuat, belum dikirim | ✅ | ✅ |
| `SENT` | Sudah dikirim ke vendor | ✅ | ✅ (update harga) |
| `RECEIVED` | Harga sudah diterima vendor | ✅ | ✅ (finalisasi harga) |
| `APPROVED` | Disetujui manager | ❌ | ❌ |
| `PARTIAL_CONVERTED` | Sebagian sudah jadi PO | ❌ | ❌ |
| `CONVERTED` | Semua jadi PO (terminal) | ❌ | ❌ |
| `CANCELLED` | Dibatalkan (terminal) | ❌ | ❌ |

---

## Relasi Antar Modul

```
MaterialPurchaseDraft (Consolidation)
    │ 1:1
    ▼
RFQItem ──────────────► RFQ (RequestForQuotation)
                              │
                    ▼─────────┘
         RawMaterialOpenPo (rfq_id FK)
                    │
                    ▼
        Goods Receipt / Inventory
```

- Satu `MaterialPurchaseDraft` ↔ satu `RFQItem` (`purchase_draft_id` unique)
- Satu RFQ bisa memiliki banyak items dari berbagai raw materials
- Convert menghasilkan satu `RawMaterialOpenPo` per item

---

## Database Tables

| Table | Deskripsi |
|---|---|
| `request_for_quotations` | Header RFQ (nomor, vendor, status, tanggal) |
| `rfq_items` | Line items (raw material, qty, harga, link ke draft) |
| `raw_material_open_pos` | Diperluas dengan kolom `rfq_id` (nullable FK) |

---

## Key Constraints

- `rfq_items.purchase_draft_id` — **unique**: satu draft hanya bisa masuk ke satu RFQ item
- Delete hanya untuk status `DRAFT`
- Edit (PUT) diblokir untuk `CONVERTED` dan `CANCELLED`
- Convert hanya dari `APPROVED` atau `PARTIAL_CONVERTED`
- RFQ Number di-generate otomatis: `RFQ-YYYYMMDD-XXXX`

---

## Frontend Pages

| Path | Komponen | Deskripsi |
|---|---|---|
| `/rfq` | `RFQListPage` | Tabel semua RFQ dengan filter status, vendor, periode |
| `/rfq/create` | `RFQCreatePage` | Form buat RFQ manual |
| `/rfq/[id]` | `RFQDetailPage` | Detail RFQ + timeline status + tombol aksi + tabel items |

---

## UI Components yang Dibutuhkan

| Komponen | Deskripsi |
|---|---|
| `RFQStatusBadge` | Badge berwarna per status |
| `RFQStatusStepper` | Stepper visual: DRAFT → SENT → RECEIVED → APPROVED → CONVERTED |
| `RFQItemsTable` | Tabel editable untuk items (quantity, unit_price) |
| `ConvertToPODialog` | Dialog pilih items + tanggal expected arrival |
| `RFQFormHeader` | Form header (vendor combobox, warehouse, date, notes) |

---

## Integration Points

### Dari Konsolidasi
Tombol "Buat RFQ" di halaman `/consolidation` → redirect ke `/rfq/create?draft_ids=1,2,3` dengan items pre-filled dari selected drafts, dikelompokkan per `supplier_id`.

### Ke Open PO
Setelah konversi, link ke Open PO muncul di halaman detail RFQ (`open_pos[]`). User bisa navigasi ke detail PO dari sana.

### Ke Goods Receipt  
Open PO yang sudah `RECEIVED` akan masuk ke alur GR di modul Inventory V2.
