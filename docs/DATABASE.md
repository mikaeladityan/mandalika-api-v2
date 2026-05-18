# 🗄️ Database

PostgreSQL via Prisma 6. Schema di `prisma/schema.prisma` (50.4K, ~57 model, ~42 enum). Output Prisma client di `src/generated/prisma/`.

---

## 1. Konfigurasi

`prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

Connection di `src/config/prisma.ts` (singleton + `initializeDatabase` + `closeDatabase`).

---

## 2. Migrasi

Proyek menggunakan **`prisma db push`** (bukan `migrate dev`) karena DB awal di-setup tanpa migration history (lihat `CHANGELOG.md` 2026-03-18). Untuk perubahan schema:

```bash
# dev: sinkron schema → DB (no migration files)
npx prisma db push

# regenerasi client
npx prisma generate
```

Folder `prisma/migrations/` tetap ada untuk skenario di mana migrate dipakai pada lingkungan tertentu.

`prisma/_temp.prisma` adalah scratch file — tidak digunakan saat generate.

---

## 3. Domain Model (Ringkas)

### 3.1 Identity & Auth

| Model              | Catatan                                                                  |
| :----------------- | :----------------------------------------------------------------------- |
| `Account`          | login email/password, `status`, `role`, `deleted_at` (soft delete).       |
| `User`             | profil 1:1 ke Account (`first_name`, `phone`, `whatsapp`).                |
| `EmailVerify`      | token verifikasi email (register/reset).                                  |
| `Address`          | many-to-one ke User.                                                      |
| `LoggingActivity`  | audit log (`activity`: LogActivities enum).                               |
| `SuspiciousActivity`| IP + UA + reason (rate limit, brute force).                              |

### 3.2 Master Data

`Product`, `ProductSize`, `ProductType`, `Unit`, `RawMaterial`, `RawMatCategories`, `UnitRawMaterial`, `Supplier`, `SupplierMaterial`, `Warehouse`, `WarehouseAddress`, `Outlet`, `OutletAddress`, `Recipes`.

### 3.3 Inventory

| Model                  | Tujuan                                                       |
| :--------------------- | :----------------------------------------------------------- |
| `ProductInventory`     | stok FG per (`product_id`, `warehouse_id`).                  |
| `RawMaterialInventory` | stok RM per (`raw_material_id`, `warehouse_id`).             |
| `OutletInventory`      | stok FG per outlet + `min_stock`.                            |
| `StockMovement`        | audit trail semua mutasi (in/out/transfer/adjust).           |
| `StockTransfer` + `StockTransferItem` + `StockTransferPhoto` | Transfer V1 + V2 (`DO`, `TG`). |
| `StockReturn` + `StockReturnItem` | Retur stok (`RET-...`).                                |
| `GoodsReceipt` + `GoodsReceiptItem` | GR (terima dari supplier / produksi).                |

### 3.4 Forecast & Recommendation

`Forecast`, `ForecastPercentage`, `Trend`, `SafetyStock`, `RawMaterialNeedOverride`, `MaterialPurchaseDraft`, `RawMaterialOpenPo`.

### 3.5 Manufacturing

`ProductionOrder` + `ProductionOrderItem` + `ProductionOrderWaste` + `ProductionOrderOutput`.

### 3.6 Purchasing (Procure-to-Pay)

| Model                | Prefix doc number | Catatan                           |
| :------------------- | :---------------- | :-------------------------------- |
| `PurchaseRFQ`        | `RFQ-YYYYMMDD-NNN`| field `rfq_number`                 |
| `PurchaseRFQItem`    | —                 | child RFQ                          |
| `PurchaseOrder`      | `PO-YYYYMMDD-NNN` | field `po_number`, `po_type` (LOCAL/IMPORT/FO) |
| `PurchaseOrderItem`  | —                 |                                    |
| `PurchasePaymentTerm`| —                 | termin pembayaran                  |
| `PurchaseTracking`   | —                 | progress pengiriman                |
| `PurchaseReceipt`    | `RCV-RM-YYYYMMDD-NNN` | field `receipt_number`         |
| `PurchaseReceiptItem`| —                 |                                    |
| `VendorReturn`       | `RTN-YYYYMMDD-NNN`| field `return_number`              |
| `VendorReturnItem`   | —                 |                                    |

### 3.7 Finance

| Model                | Prefix doc number      | Catatan                                  |
| :------------------- | :--------------------- | :--------------------------------------- |
| `AccountPayable`     | `AP-YYYYMMDD-NNN`      | field `ap_number`, link ke PO/Receipt    |
| `AccountReceivable`  | `AR-YYYYMMDD-NNN`      | field `ar_number`, partner outlet/customer |
| `CashEntry`          | `CB-YYYYMMDD-NNN`      | field `cash_number`, IN/OUT              |
| `JournalEntry`       | `JV-YYYYMMDD-NNN`      | field `journal_number`, manual / system  |

---

## 4. Daftar Lengkap Model

```
SuspiciousActivity, LoggingActivity, Account, User, EmailVerify, Address,
Product, ProductSize, Unit, ProductType,
RawMatCategories, UnitRawMaterial, RawMaterial,
ProductInventory, RawMaterialInventory,
Supplier, SupplierMaterial,
Warehouse, WarehouseAddress,
Recipes,
ProductIssuance,
ForecastPercentage, Forecast,
SafetyStock, RawMaterialNeedOverride, MaterialPurchaseDraft, RawMaterialOpenPo,
Outlet, OutletWarehouse, OutletAddress, OutletInventory,
StockMovement, StockTransfer, StockTransferItem, StockTransferPhoto,
StockReturn, StockReturnItem,
GoodsReceipt, GoodsReceiptItem,
ProductionOrder, ProductionOrderItem, ProductionOrderWaste, ProductionOrderOutput,
PurchaseRFQ, PurchaseRFQItem,
PurchaseOrder, PurchaseOrderItem, PurchasePaymentTerm,
PurchaseTracking, PurchaseReceipt, PurchaseReceiptItem,
VendorReturn, VendorReturnItem,
AccountPayable, AccountReceivable, CashEntry, JournalEntry
```

Total: **57 model**.

---

## 5. Daftar Lengkap Enum

```
IssuanceType, WarehouseType, OutletType, LEVEL_APP, LogActivities, ROLE,
TYPE_EMAIL, GENDER,
ForecastStatus, Trend, MaterialType, RawMaterialSource, STATUS, RecommendationStatus,
TransferLocationType, TransferStatus,
MovementEntityType, MovementLocationType, MovementType, MovementRefType,
ProductionStatus, WasteType, TransferPhotoStage,
GoodsReceiptStatus, GoodsReceiptType, ReturnStatus,
RFQStatus, POType, POStatus, POItemType, POTrackingOrderStatus, POTrackingPaymentStatus,
ReceiptStatus, VendorReturnStatus,
APStatus, APType, ARStatus, ARPartnerType,
CashEntryType, CashEntryStatus,
JournalStatus, PaymentMethod
```

Total: **42 enum**.

---

## 6. Konvensi Schema

| Aspek              | Konvensi                                                       |
| :----------------- | :------------------------------------------------------------- |
| Primary key        | `id Int @id @default(autoincrement())` atau `String @id @default(uuid())` (Account, User) |
| Timestamps         | `created_at DateTime @default(now())`, `updated_at DateTime @updatedAt`, soft delete `deleted_at DateTime?` |
| Naming field       | `snake_case`                                                    |
| Table mapping      | `@@map("<plural_snake>")` mis. `users`, `purchase_orders`      |
| Index              | `@@index([field])` untuk filter sering; `[email, status]` untuk kombinasi. |
| Unique             | `@@unique([id, user_id])` untuk komposit; `@unique` untuk single. |
| Soft delete query  | default WHERE `deleted_at: null` di service.                    |

---

## 7. Relasi Penting

- `Account 1:1 User`, `Account 1:1 EmailVerify`.
- `User 1:N Address`.
- `Product N:N Warehouse via ProductInventory`.
- `RawMaterial N:N Warehouse via RawMaterialInventory`.
- `Outlet N:1 Warehouse via OutletWarehouse` (warehouse harus `FINISH_GOODS`).
- `PurchaseRFQ 1:N PurchaseRFQItem`, link ke `PurchaseOrder` via `rfq_id`.
- `PurchaseOrder 1:N PurchaseOrderItem`, 1:N `PurchaseReceipt`, 1:N `VendorReturn`, 1:N `AccountPayable`.
- `GoodsReceipt 1:N GoodsReceiptItem`. Source: Supplier / Production.
- `StockMovement` polymorphic via `entity_type` + `entity_id` + `ref_type` + `ref_id`.

---

## 8. Operasi Stok yang Aman

Untuk mutasi `ProductInventory` / `RawMaterialInventory` / `OutletInventory`:

1. Bungkus dalam `prisma.$transaction(async (tx) => {...})`.
2. Gunakan `update({ where: { product_id_warehouse_id: { ... } }, data: { quantity: { increment: n } } })` agar atomic.
3. Validasi `quantity >= 0` setelah update; jika negatif, throw `422`.
4. Write log ke `StockMovement` di transaksi yang sama.
5. Helper terpusat: `inventory-v2/inventory.helper.ts`.

---

## 9. Seed

`prisma/seed.ts` minimal — sebagian besar data master diisi via import (CSV/Excel) melalui endpoint `/import` di tiap modul.

```bash
npx prisma db seed
```

---

## 10. Diagnostik

Health endpoint `GET /health` jalankan `prisma.$queryRaw\`SELECT 1\`` untuk cek DB.
Lihat [`OBSERVABILITY.md`](./OBSERVABILITY.md) untuk metrik.
