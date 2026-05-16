# 📦 Module: Stock Transfer V1 + Stock Movement (Legacy/Audit)

**Path**: `/api/app/stock-transfers`, `/api/app/stock-movements`
**Source**: `src/module/application/stock-transfer/`, `src/module/application/stock-movement/`

V1 = sistem transfer lama. V2 (`inventory-v2/{do,tg,return}`) yang aktif untuk fitur baru — V1 dipertahankan untuk audit & backward compatibility.

---

## 1. Stock Transfer V1 — `/stock-transfers`

| Method | Path             | Catatan                                  |
| :----- | :--------------- | :--------------------------------------- |
| GET    | `/`              | List                                     |
| POST   | `/`              | Create (`RequestStockTransferSchema`)    |
| GET    | `/:id`           | Detail                                   |
| PATCH  | `/:id/status`    | Update status (`RequestUpdateStockTransferStatusSchema`) |

Status enum: `TransferStatus` (10 status — DRAFT, READY, PICKING, SHIPPING, RECEIVED, dst).

Catatan dari `docs/TODO.md`:
- Phase 4 P4.1: format nomor random → sequence (`TRF-YYYYMM-0001`) belum diimplement.
- Setelah V2 stabil, V1 sebaiknya dibatasi ke `WAREHOUSE↔WAREHOUSE` saja.

---

## 2. Stock Movement (Audit) — `/stock-movements`

Audit trail semua mutasi stok (in/out/transfer/adjust). Read-only.

| Method | Path     | Catatan                                |
| :----- | :------- | :------------------------------------- |
| GET    | `/`      | List + filter (entity/ref/location)    |
| GET    | `/:id`   | Detail                                 |

Model `StockMovement`:
- `entity_type`: `PRODUCT` / `RAW_MATERIAL` / dll (`MovementEntityType`).
- `location_type`: `WAREHOUSE` / `OUTLET` (`MovementLocationType`).
- `movement_type`: `IN` / `OUT` / `TRANSFER_IN` / `TRANSFER_OUT` / `ADJUST` (`MovementType`).
- `ref_type` + `ref_id`: polymorphic ke `GR` / `DO` / `TG` / `RET` / `PROD_USAGE` / dst (`MovementRefType`).
- Auto-generated saat operasi inventaris V2.

---

## Migration Plan (V1 → V2)

Sudah selesai (lihat `docs/TODO.md` Phase 2):

| Operasi              | V1                   | V2                              |
| :------------------- | :------------------- | :------------------------------ |
| Goods Receipt        | manual stock upsert  | `/inventory-v2/gr`              |
| Delivery Order       | StockTransfer (WO)   | `/inventory-v2/do`              |
| Transfer Gudang      | StockTransfer (WW)   | `/inventory-v2/tg`              |
| Return Stock         | StockTransfer (RET)  | `/inventory-v2/return`          |

V1 transfer masih bisa handle WAREHOUSE↔OUTLET (use case DO). Setelah DO V2 aktif → batasi ke WAREHOUSE↔WAREHOUSE saja (kebijakan TODO Phase 4).
