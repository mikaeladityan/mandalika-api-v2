# 🛒 Module: Purchasing

**Path**: `/api/app/purchase`
**Source**: `src/module/application/purchase/`

Procure-to-Pay (Consolidation → RFQ → PO → Receipt → AP, + Vendor Return).

---

## 1. Mount

```
/purchase/rfq             → RFQRoutes
/purchase/po              → PORoutes
/purchase/receipt         → ReceiptRoutes
/purchase/tracking        → TrackingRoutes
/purchase/vendor-return   → VendorReturnRoutes
```

---

## 2. Alur Bisnis

```
Recommendation V2 ──► Consolidation (Daftar Pengajuan)
                              │
                              ▼
                            RFQ (multi-vendor / tender)
                              │ approve & convert
                              ▼
                            PO (Purchase Order, kontrak resmi ke 1 vendor)
                              │ track shipping & payment
                              ▼
                       Purchase Receipt (terima fisik)
                              │ posting
                       ┌──────┴──────────────────────┐
                       ▼                             ▼
            RawMaterialInventory (stok+)    AccountPayable (AP)
                       │                             │
                       │ (jika ada masalah)          │ payment
                       ▼                             ▼
                  VendorReturn                 Cash / Journal
```

Flag status item (sesuai [`docs/purchasing.md`](../../../docs/purchasing.md) root):

| Tahap         | Modul Asal     | Status/Flag   |
| :------------ | :------------- | :------------ |
| Drafting      | Recommendation | `Draft`       |
| Grouping      | Consolidation  | `Waiting`     |
| Quotation     | Purchase RFQ   | `RFQ Posted`  |
| Ordering      | Purchase PO    | `PO Released` |
| Closed        | Purchase Receipt | `Completed` |

---

## 3. RFQ — `/purchase/rfq`

| Method | Path                       | Catatan                                |
| :----- | :------------------------- | :------------------------------------- |
| GET    | `/consolidation-items`     | Item draft yang available di-RFQ-kan   |
| GET    | `/`                        | List RFQ                                |
| GET    | `/:id`                     | Detail                                  |
| POST   | `/`                        | Create (`CreateRFQSchema`)              |
| PUT    | `/:id`                     | Update (`UpdateRFQSchema`)              |
| PATCH  | `/:id/status`              | Update status (`UpdateRFQStatusSchema`) |
| POST   | `/:id/convert`             | Convert ke PO (`ConvertToPOSchema`)     |
| DELETE | `/:id`                     | Hapus                                   |

Status: `RFQStatus` (DRAFT / SENT / ACCEPTED / REJECTED / CONVERTED).

**Konversi RFQ → PO**:
- Validasi RFQ status `ACCEPTED`.
- Pilih supplier pemenang (bisa hanya 1 dari beberapa di tender).
- Generate `PO-YYYYMMDD-NNN`.
- Update RFQ status → `CONVERTED`.

Nomor RFQ: `RFQ-YYYYMMDD-NNN` (via `generateRFQNumber`).

---

## 4. PO — `/purchase/po`

| Method | Path                | Catatan                                  |
| :----- | :------------------ | :--------------------------------------- |
| GET    | `/`                 | List PO                                  |
| GET    | `/open-po`          | List PO outstanding (belum 100% diterima)|
| GET    | `/:id`              | Detail                                   |
| GET    | `/:id/receipts`     | Receipt terkait PO                       |
| POST   | `/`                 | Create (`CreatePOSchema`)                |
| PUT    | `/:id`              | Update (`UpdatePOSchema`)                |
| PATCH  | `/:id/status`       | Update status (`UpdatePOStatusSchema`)   |
| PATCH  | `/:id/tracking`     | Update tracking (`UpdatePOTrackingSchema`)|
| DELETE | `/:id`              | Hapus (jika belum receipt)               |

Status: `POStatus` (DRAFT / RELEASED / IN_DELIVERY / RECEIVED / CLOSED / CANCELLED).
Tipe: `POType` (`LOCAL` / `IMPORT` / `FO`).
Item type: `POItemType`.

Tracking: `POTrackingOrderStatus` + `POTrackingPaymentStatus`.
Payment term: `PurchasePaymentTerm` (DP, TOP30, dll).

Nomor PO: `PO-YYYYMMDD-NNN` (via `generatePONumber`).

---

## 5. Receipt — `/purchase/receipt`

| Method | Path             | Catatan                                  |
| :----- | :--------------- | :--------------------------------------- |
| GET    | `/`              | List                                      |
| GET    | `/open-pos`      | PO yang siap di-receipt-kan              |
| GET    | `/:id`           | Detail                                    |
| POST   | `/`              | Create (`CreateReceiptSchema`)            |
| PUT    | `/:id`           | Update (`UpdateReceiptSchema`)            |
| POST   | `/:id/post`      | Posting → stok+ + buat AP                |
| POST   | `/:id/approve`   | Approve                                   |
| DELETE | `/:id`           | Hapus (jika belum posted)                |

Status: `ReceiptStatus`.
Nomor: `RCV-RM-YYYYMMDD-NNN` (via `generateReceiptNumber`).

### Posting Flow (terbesar di Procure-to-Pay)

`POST /:id/post`:
1. `prisma.$transaction` mulai.
2. Validasi receipt `DRAFT` & item qty.
3. Per item: `rawMaterialInventory.update({ increment: qty })`.
4. Tulis `StockMovement` (`ref_type = PURCHASE_RECEIPT`).
5. Update outstanding qty di `PurchaseOrderItem`. Jika 100% terima → PO status `RECEIVED`.
6. Generate AP: `generateAPNumber()` + create `AccountPayable` record (`ap_type` sesuai term — `DP` / `GOODS_RECEIPT` / `TERM` / `FULL`).
7. Set receipt status `POSTED`.

---

## 6. Tracking — `/purchase/tracking`

| Method | Path           | Catatan                                  |
| :----- | :------------- | :--------------------------------------- |
| GET    | `/`            | List tracking                             |
| GET    | `/:po_id`      | Tracking 1 PO                             |
| PATCH  | `/:po_id`      | Update tracking (`UpdateTrackingSchema`) |

Model: `PurchaseTracking`. Fields: order status, payment status, shipping ETA, dokumen pengiriman.

---

## 7. Vendor Return — `/purchase/vendor-return`

Retur ke supplier (defect, salah barang, kelebihan).

| Method | Path             | Catatan                                  |
| :----- | :--------------- | :--------------------------------------- |
| GET    | `/`              | List                                      |
| GET    | `/:id`           | Detail                                    |
| POST   | `/`              | Create (`CreateVendorReturnSchema`)       |
| PUT    | `/:id`           | Update (`UpdateVendorReturnSchema`)       |
| POST   | `/:id/post`      | Posting (stok-)                          |
| POST   | `/:id/approve`   | Approve                                   |
| DELETE | `/:id`           | Hapus                                     |

Status: `VendorReturnStatus`.
Nomor: `RTN-YYYYMMDD-NNN` (via `generateReturnNumber`).

Posting → deduct `RawMaterialInventory` + tulis `StockMovement` (`ref_type = VENDOR_RETURN`).

---

## 8. Best Practice

1. Cek modul Consolidation sebelum buat RFQ manual — hindari double-RFQ.
2. Pakai `GET /consolidation-items` di tahap RFQ untuk pilih item yang belum dipost.
3. Setelah convert RFQ → PO, status RFQ otomatis `CONVERTED` (mencegah konversi ganda).
4. Receipt parsial diperbolehkan — outstanding qty terus di-track di PO item.
5. AP otomatis lahir dari posting receipt; manual AP via `/finance/ap` jarang dipakai (hanya adjustment).

---

## 9. Test

Lokasi: `src/tests/purchase/` + `src/tests/rfq.service.test.ts`. Coverage: status transition, posting receipt, AP generation, vendor return.
