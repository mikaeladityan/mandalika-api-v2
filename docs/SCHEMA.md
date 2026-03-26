# Prisma Schema — Implementation Guide
## Mandalika ERP v2.0 — Inventory Control Focus

**Last Updated:** 2026-03-18
**Status:** Sprint 1 & 2 sudah diimplementasi di `schema.prisma`

---

## Yang Sudah Ada di `schema.prisma`

### Sprint 1 — Implemented ✅

**Enum baru:**
- `TransferLocationType` — WAREHOUSE | OUTLET
- `TransferStatus` — 10 status dengan flow lengkap
- `MovementEntityType` — PRODUCT | RAW_MATERIAL
- `MovementLocationType` — WAREHOUSE | OUTLET
- `MovementType` — IN | OUT | TRANSFER_IN | TRANSFER_OUT | ADJUSTMENT | OPNAME | INITIAL | POS_SALE
- `MovementRefType` — PURCHASE_ORDER | STOCK_TRANSFER | STOCK_ADJUSTMENT | SALES_TRANSACTION | MANUAL

**Model baru:**
- `Outlet` — Master data toko, bisa linked ke warehouse utama
- `OutletAddress` — Alamat outlet (1-to-1)
- `OutletInventory` — Stok real-time per produk per outlet
- `StockMovement` — Universal audit log semua pergerakan stok
- `StockTransfer` — Header transfer stok, punya `barcode` untuk scan + `photos[]` bukti fisik
- `StockTransferItem` — Detail item transfer dengan tracking qty per stage
- `StockTransferPhoto` — Foto bukti fisik per stage (SHIPMENT, RECEIVED, FULFILLMENT)
- Enum `TransferPhotoStage` — SHIPMENT | RECEIVED | FULFILLMENT

**Relasi yang diupdate:**
- `Product` → tambah `outlet_inventories[]` + `stock_transfer_items[]`
- `Warehouse` → tambah `outlets[]` + `transfers_as_source[]` + `transfers_as_destination[]`

---

## Transfer Status Flow

```
PENDING ──(approve)──► APPROVED ──(pack & kirim)──► SHIPMENT ──(tiba)──► RECEIVED
   │          │                                                                │
   │       (tolak)                                                     (mulai cek)
   │       CANCELLED                                                           │
   │                                                                           ▼
(cancel)                                                                 FULFILLMENT
   │                                                                     /    |    \
   └──────────────────────────────────────────────────►  COMPLETED  PARTIAL  MISSING  REJECTED
                                                         semua OK  qty < req  hilang   rusak
```

### Barcode & Foto Bukti Fisik

**Barcode (`barcode` field):**
- Format: 8 karakter alfanumerik uppercase, contoh: `TF3X9K2M`
- Di-generate otomatis oleh service saat transfer dibuat (auto-generate, collision-safe)
- Digunakan untuk scanning via barcode scanner / QR code reader di gudang/outlet
- Selain `barcode`, `transfer_number` tetap ada sebagai referensi human-readable
- Frontend: generate QR code / barcode image dari nilai `barcode` field ini

```
transfer_number : TRF-202603-0001  → label dokumen, untuk search
barcode         : TF3X9K2M         → untuk scan fisik di lapangan
```

**Foto Bukti Fisik (`StockTransferPhoto`):**

| Stage | Kapan Diupload | Contoh Konten Foto |
|-------|---------------|-------------------|
| `SHIPMENT` | Saat proses packing & pengiriman | Foto barang yang dikemas, foto truk, foto surat jalan |
| `RECEIVED` | Saat barang tiba di tujuan | Foto kardus/palet tiba, kondisi packaging |
| `FULFILLMENT` | Saat proses pengecekan | Foto barang yang OK, foto barang rusak, foto barang yang kurang |

- Satu transfer bisa punya banyak foto per stage (tidak dibatasi)
- `url` menyimpan path ke file storage (lokal atau cloud)
- `caption` opsional untuk keterangan foto
- `uploaded_by` mencatat siapa yang upload foto (account_id)

### Aturan Transisi Status

| Status Saat Ini | Aksi | Status Berikutnya |
|-----------------|------|------------------|
| PENDING | Disetujui oleh authorized | APPROVED |
| PENDING | Dibatalkan | CANCELLED |
| APPROVED | Mulai packing & kirim | SHIPMENT |
| APPROVED | Dibatalkan | CANCELLED |
| SHIPMENT | Konfirmasi tiba di tujuan | RECEIVED |
| RECEIVED | Mulai proses pengecekan | FULFILLMENT |
| FULFILLMENT | Semua barang sesuai sempurna | COMPLETED |
| FULFILLMENT | Qty diterima < qty dikirim | PARTIAL |
| FULFILLMENT | Ada barang hilang/tidak tiba | MISSING |
| FULFILLMENT | Ada barang rusak/ditolak | REJECTED |

### Tracking Quantity Per Item (`StockTransferItem`)

```
quantity_requested  → Set saat PENDING (qty diminta)
quantity_packed     → Set saat SHIPMENT (qty dikemas/dikirim)
quantity_received   → Set saat RECEIVED (qty tiba fisik)
quantity_fulfilled  → Set saat FULFILLMENT (qty baik/diterima)
quantity_missing    → Set saat FULFILLMENT (qty hilang)
quantity_rejected   → Set saat FULFILLMENT (qty rusak/ditolak)

Validasi: quantity_fulfilled + quantity_missing + quantity_rejected = quantity_received
```

---

## Desain Outlet

### Outlet Berdiri Sendiri
Outlet adalah entitas independen yang merepresentasikan toko fisik. Outlet:
- Memiliki kode unik (`TK-001`, `TK-002`, dll)
- Bisa linked ke warehouse utama via `warehouse_id` (nullable)
- Memiliki stok sendiri di `OutletInventory` (real-time, bukan snapshot)
- Dapat menerima kiriman dari Warehouse maupun Outlet lain via `StockTransfer`

### Relasi Outlet–Warehouse
```
Warehouse ──(warehouse_id FK)──► Outlet
                                    │
                   menerima stok via StockTransfer (W→O)
                   bisa kirim ke Outlet lain (O→O)
```

### OutletInventory vs ProductInventory

| | `OutletInventory` | `ProductInventory` |
|--|--|--|
| **Level** | Outlet (toko) | Warehouse (gudang) |
| **Update** | Real-time setiap ada perubahan | Snapshot historis (date/month/year) |
| **Sumber perubahan** | Stock Transfer masuk, POS sale | Stock Transfer keluar, PO masuk |
| **Dipakai untuk** | Operasional toko, stock opname outlet | Forecasting, BOM, safety stock |

---

## Cara Penggunaan StockMovement

`StockMovement` adalah **read-only audit log** — tidak ada endpoint POST publik.
Hanya dipanggil secara internal oleh service lain.

### Kapan dipanggil:

```typescript
// Saat StockTransfer dispatch (SHIPMENT):
StockMovementService.log({
  entity_type: 'PRODUCT', entity_id: product_id,
  location_type: 'WAREHOUSE', location_id: from_warehouse_id,
  movement_type: 'TRANSFER_OUT',
  quantity: qty_packed, qty_before, qty_after,
  reference_id: transfer_id, reference_type: 'STOCK_TRANSFER',
  created_by: account_id
})

// Saat StockTransfer COMPLETED/PARTIAL:
StockMovementService.log({
  entity_type: 'PRODUCT', entity_id: product_id,
  location_type: 'OUTLET', location_id: to_outlet_id,
  movement_type: 'TRANSFER_IN',
  quantity: qty_fulfilled, qty_before, qty_after,
  reference_id: transfer_id, reference_type: 'STOCK_TRANSFER',
  created_by: account_id
})
```

---

## Sprint Berikutnya (Belum Diimplementasi)

### Sprint 3 — POS Integration
```prisma
model PosDevice { ... }
model SalesTransaction { ... }
model SalesTransactionItem { ... }
```

### Sprint 4 — Alerts
```prisma
enum AlertType { LOW_STOCK, OVERSTOCK }
enum AlertStatus { ACTIVE, RESOLVED, DISMISSED }
model StockAlert { ... }
```

### Sprint 5 — Purchase Order (Full)
```prisma
enum PurchaseOrderStatus { DRAFT, SUBMITTED, APPROVED, PARTIAL, COMPLETED, CANCELLED, REJECTED }
model PurchaseOrder { ... }
model PurchaseOrderItem { ... }
```

### Sprint 5 — Product Enrichment
```prisma
model ProductVariant { ... }
model BundleItem { ... }
```

---

## Perintah Migrasi

```bash
# Setelah menambahkan Sprint 1 schema (sudah dilakukan):
npx prisma migrate dev --name "add_outlet_inventory_control"
npx prisma generate

# Sprint 3 (POS) — lakukan setelah Sprint 2 selesai:
npx prisma migrate dev --name "add_pos_integration"
npx prisma generate

# Sprint 4 (Alerts):
npx prisma migrate dev --name "add_stock_alerts"
npx prisma generate

# Sprint 5 (Purchase Order full + Product Enrichment):
npx prisma migrate dev --name "add_purchase_order_and_variants"
npx prisma generate
```
