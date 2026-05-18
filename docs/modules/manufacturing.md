# 🏗️ Module: Manufacturing

**Path**: `/api/app/manufacturing`
**Source**: `src/module/application/manufacturing/`

Production Order lifecycle (V2): PLANNING → RELEASED → PROCESSING → COMPLETED → QC_REVIEW → FINISHED.

---

## 1. Endpoint Utama

| Method | Path                                       | Catatan                                       |
| :----- | :----------------------------------------- | :-------------------------------------------- |
| GET    | `/`                                        | List PO                                       |
| POST   | `/`                                        | Create (`RequestCreateProductionSchema`)      |
| GET    | `/wastes`                                  | List waste                                    |
| GET    | `/bom-preview`                             | Preview BOM untuk PO baru                     |
| GET    | `/:id`                                     | Detail                                        |
| PATCH  | `/:id`                                     | Update (`RequestUpdateProductionSchema`)      |
| PATCH  | `/:id/status`                              | Change status (`RequestChangeStatusSchema`)   |
| POST   | `/:id/result`                              | Submit actual result (`RequestSubmitResultSchema`) |
| POST   | `/:id/qc`                                  | QC action (`RequestQcActionSchema`)           |
| PATCH  | `/:id/items/:itemId/override`              | Override qty item (`RequestOverrideItemSchema`)|
| DELETE | `/:id/items/:itemId/override`              | Clear override                                |
| DELETE | `/:id`                                     | Delete PO                                     |
| DELETE | `/clean/cancelled`                         | Bulk purge PO cancelled                       |

---

## 2. Sub-modul Inventory (RM)

| Sub                           | Path                                                |
| :---------------------------- | :-------------------------------------------------- |
| RM Movement                   | `/inventory/rm-movement`                            |
| RM Receipt                    | `/inventory/rm-receipt`                             |
| RM Transfer                   | `/inventory/rm-transfer`                            |
| RM Usage                      | `/inventory/rm-usage`                               |
| RM SKU Transfer               | `/inventory/rm-sku-transfer`                        |
| Manual Waste RM               | `/inventory/manual-waste-rm`                        |

Operasi RM khusus untuk siklus produksi (allocate, transfer antara `GRM-KDG` ↔ `GRM-PRD`, usage actual, waste).

---

## 3. Lifecycle

```
PLANNING
   │ change status: RELEASED
   ▼
RELEASED         ─►  alokasi stok RM lintas gudang (auto TG dari GRM-KDG → GRM-PRD jika kurang)
   │ change status: PROCESSING
   ▼
PROCESSING       ─►  pemotongan stok aktual (RmUsage) + pencatatan movement
   │ change status: COMPLETED
   ▼
COMPLETED        ─►  input hasil aktual (planned vs actual)
   │ change status: QC_REVIEW
   ▼
QC_REVIEW        ─►  QC action (qcAction: ACCEPT / REJECT)
   │
   ▼
FINISHED         ─►  Goods Receipt produk jadi + Waste Management
```

Status enum: `ProductionStatus`. Lihat juga [`docs/v2/manufacturing.md`](../../../docs/v2/manufacturing.md) untuk spek bisnis.

---

## 4. Penomoran

Format: `MFG-YYYYMM-XXXX` (bulanan + 4-digit sequence). Generator inline di `manufacturing.service.ts` (BUKAN dari `lib/utils/generate-number.ts` — punya logic khusus).

---

## 5. Auto RM Transfer

Jika stok RM di gudang produksi (`GRM-PRD`) kurang saat status `RELEASED`, sistem otomatis membuat Transfer Goods (TG) dari gudang pusat (`GRM-KDG`). Logic ada di `manufacturing.service.ts` — service ini paling besar (~50KB).

---

## 6. Model

- `ProductionOrder` — header.
- `ProductionOrderItem` — RM yang diperlukan + planned/actual qty + override.
- `ProductionOrderOutput` — hasil produksi (FG).
- `ProductionOrderWaste` — pencatatan sampah produksi (`WasteType`).

---

## 7. QC

`POST /:id/qc` dengan body `RequestQcActionSchema`:

```ts
{ action: "ACCEPT" | "REJECT", notes?: string, rejected_items?: [{ item_id, qty }] }
```

ACCEPT → pindah `FINISHED`, create GR FG.
REJECT → balikkan ke `PROCESSING` atau status sesuai keputusan PIC.

---

## 8. Calendar View

Visualisasi jadwal produksi harian/mingguan/bulanan (lihat `docs/FEATURES.md`). Backend menyediakan query date-range yang dipakai oleh frontend.

---

## 9. Schema

`manufacturing.schema.ts`:

- `RequestCreateProductionSchema` — input PO baru.
- `RequestUpdateProductionSchema` — partial update.
- `RequestChangeStatusSchema` — `{ status: ProductionStatus }` + opsional context.
- `RequestSubmitResultSchema` — actual output + waste.
- `RequestQcActionSchema` — QC accept/reject.
- `RequestOverrideItemSchema` — override RM qty.
