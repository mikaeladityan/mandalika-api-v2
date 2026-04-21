# Manufacturing Module – ROADMAP

## Overview

Modul Manufacturing mengelola siklus produksi dari perencanaan hingga Finished Goods (FG) masuk gudang menggunakan **Unified Production Order** bertanda nomor `MFG-YYYYMM-XXXX`.

---

## Lifecycle Status

```
PLANNING → RELEASED → PROCESSING → COMPLETED → QC_REVIEW → FINISHED
```

| Status | Trigger | Efek Stok |
|---|---|---|
| PLANNING | `POST /manufacturing` | Tidak ada |
| RELEASED | `PATCH /:id/status` | Validasi ketersediaan RM lintas gudang RAW_MATERIAL |
| PROCESSING | `PATCH /:id/status` | Deduct RM dari RawMaterialInventory + StockMovement (OUT) |
| COMPLETED | `POST /:id/result` | Update qty aktual; catat Waste RM (selisih planned vs actual) |
| QC_REVIEW | `PATCH /:id/status` | Tidak ada (transisi dari COMPLETED) |
| FINISHED | `POST /:id/qc` | Create GR (QC_FG) + update ProductInventory + Waste FG jika ada reject |

---

## Relasi Tabel

```
ProductionOrder
 ├── product_id          → products.id
 ├── fg_warehouse_id     → warehouses.id  (diisi saat QC Finish)
 ├── goods_receipt       → goods_receipts.id (one-to-one, dibuat saat FINISHED)
 ├── items[]             → production_order_items
 │     ├── raw_material_id  → raw_materials.id
 │     └── warehouse_id     → warehouses.id (diisi saat RELEASED)
 └── wastes[]            → production_order_wastes
       ├── raw_material_id  → raw_materials.id  (waste_type=RAW_MATERIAL)
       └── product_id       → products.id        (waste_type=FINISH_GOODS)
```

---

## Method Service

### `create(payload, userId)`
- Input: `product_id`, `quantity_planned`, `target_date?`, `notes?`, `items[]?`
- Jika `items` tidak disertakan → auto-populate dari BOM aktif (`recipes` dengan `is_active=true`)
- Hitung `quantity_planned` item BOM = `recipe.quantity × order.quantity_planned`
- **Automated RM Transfer**: Sistem akan melakukan pengecekan stok di gudang produksi (`GRM-PRD`). Jika kurang, sistem otomatis membuat `StockTransfer` (TG) dari gudang pusat (`GRM-KDG`) untuk memenuhi kekurangan tersebut.
- **Strict Validation**: Memastikan total stok di `GRM-PRD` + `GRM-KDG` cukup untuk memenuhi rencana produksi.
- Output: `ProductionOrder` status `PLANNING`

### `changeStatus(id, payload, userId)`
- Accepted status transitions: `PLANNING→RELEASED`, `RELEASED→PROCESSING`, `COMPLETED→QC_REVIEW`
- **RELEASED**: Validasi RM pool (`WarehouseType.RAW_MATERIAL`). Greedy allocation: pilih gudang dengan stok terbesar, set `warehouse_id` pada setiap item.
- **PROCESSING**: Deduct `quantity_planned` dari `RawMaterialInventory` per item, buat `StockMovement` (RAW_MATERIAL, OUT, ref=PRODUCTION).

### `submitResult(id, payload, userId)`
- Hanya bisa dari status `PROCESSING`
- Input: `quantity_actual` (FG aktual), `items[{id, quantity_actual}]`
- Per item: update `quantity_actual`; hitung selisih vs `quantity_planned`
  - Jika `actual < planned` → Waste RM created, kembalikan selisih ke stok (StockMovement IN)
  - Jika `actual > planned` → deduct over-usage dari stok (StockMovement OUT)
- Ubah status ke `COMPLETED`

### `qcAction(id, payload, userId)`
- Hanya bisa dari status `QC_REVIEW`
- Input: `quantity_accepted`, `quantity_rejected`, `fg_warehouse_id`, `qc_notes?`
- Validasi: `accepted + rejected ≤ quantity_actual`
- Jika `accepted > 0`:
  - Buat `GoodsReceipt` type `QC_FG`, status `COMPLETED`
  - Tambah ke `ProductInventory` (fg_warehouse) + StockMovement (PRODUCT, IN, ref=GOODS_RECEIPT)
- Jika `rejected > 0`: Buat `ProductionOrderWaste` type `FINISH_GOODS`
- Ubah status ke `FINISHED`

### `list(query)` / `detail(id)`
- `list`: Pagination + filter by `status`, `product_id`, search `mfg_number`/`product.name`
- `detail`: Include items (dengan RM & warehouse info), wastes, goods_receipt, fg_warehouse

---

## Automated RM Transfer & Allocation

Sistem menggunakan dua gudang utama untuk Raw Material:
1. **`GRM-PRD` (Gudang Produksi)**: Gudang tempat bahan baku benar-benar dikonsumsi.
2. **`GRM-KDG` (Gudang Pusat/Kandang)**: Gudang penyimpanan stok utama.

### Alur Alokasi:
- Saat **Create**: Jika stok di `GRM-PRD` < kebutuhan, sistem otomatis membuat **Stock Transfer (TG)** dari `GRM-KDG` ke `GRM-PRD`.
- Saat **RELEASED**: Sistem melakukan alokasi final (greedy allocation) untuk memastikan semua item memiliki `warehouse_id` yang valid dengan stok tersedia.
- Saat **PROCESSING**: Stok benar-benar dipotong dari inventory.

---

## StockMovement Reference

| Event | entity_type | movement_type | reference_type |
|---|---|---|---|
| PROCESSING deduct RM | RAW_MATERIAL | OUT | PRODUCTION |
| submitResult over-usage | RAW_MATERIAL | OUT | PRODUCTION |
| submitResult saving return | RAW_MATERIAL | IN | PRODUCTION |
| qcAction FG accepted | PRODUCT | IN | GOODS_RECEIPT |

---

## Frontend Integration Guide

### 1. Schema (copy dari backend)
`app/src/server/manufacturing.schema.ts` — copy Zod types:
- `RequestCreateProductionSchema`
- `RequestChangeStatusSchema`
- `RequestSubmitResultSchema`
- `RequestQcActionSchema`
- `QueryProductionSchema`

### 2. Service
`app/src/server/manufacturing.service.ts`
```ts
export const ManufacturingService = {
  list: (q) => api.get('/manufacturing', { params: q }),
  detail: (id) => api.get(`/manufacturing/${id}`),
  create: (body) => api.post('/manufacturing', body),
  changeStatus: (id, body) => api.patch(`/manufacturing/${id}/status`, body),
  submitResult: (id, body) => api.post(`/manufacturing/${id}/result`, body),
  qcAction: (id, body) => api.post(`/manufacturing/${id}/qc`, body),
};
```

### 3. React Query Hooks
`app/src/server/useManufacturing.ts`
- `useManufacturingList(query)` → `useQuery`
- `useManufacturingDetail(id)` → `useQuery`
- `useCreateProduction()` → `useMutation` + invalidate list
- `useChangeStatus(id)` → `useMutation` + invalidate detail + list
- `useSubmitResult(id)` → `useMutation` + invalidate detail
- `useQcAction(id)` → `useMutation` + invalidate detail + list

### 4. UI Components

| Komponen | Deskripsi |
|---|---|
| `ProductionList` | Tabel dengan filter status + tombol Create |
| `ProductionForm` | Form create (pilih product, qty, target date; opsional input BOM manual) |
| `ProductionDetail` | Status stepper, tabel items RM, hasil QC, link GR |
| `SubmitResultForm` | Modal input qty aktual + qty RM per item |
| `QcActionForm` | Modal input qty accepted/rejected + FG warehouse |

### 5. Status Stepper UI

Tampilkan status sebagai stepper horizontal:
```
PLANNING → RELEASED → PROCESSING → COMPLETED → QC_REVIEW → FINISHED
```
Setiap step menampilkan tombol aksi sesuai status saat ini.
