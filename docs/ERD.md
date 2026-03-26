# Entity Relationship Diagram (ERD)
## Mandalika ERP — Full Schema (v2.0)

**Last Updated:** 2026-03-18
**Render:** https://mermaid.live

> Legend:
> - ✅ = Sudah ada di schema.prisma
> - ⬜ = Perlu ditambahkan

---

## 1. Domain: Authentication & Users ✅

```mermaid
erDiagram
    Account {
        string id PK
        string email UK
        string password
        STATUS status
        ROLE role
        datetime created_at
        datetime updated_at
        datetime deleted_at
    }

    User {
        string id PK
        string account_id UK_FK
        string first_name
        string last_name
        string photo
        string phone
        string whatsapp
        datetime created_at
        datetime updated_at
        datetime deleted_at
    }

    EmailVerify {
        int id PK
        string email UK_FK
        TYPE_EMAIL type
        string code
        datetime created_at
        datetime accepted_at
        datetime expired_at
    }

    Address {
        int id PK
        string name
        string street
        string district
        string city
        string province
        string country
        string postal_code
        string user_id FK
    }

    Account ||--o| User : "has profile"
    Account ||--o| EmailVerify : "has verify"
    User ||--o{ Address : "has addresses"
```

---

## 2. Domain: Outlet & POS ⬜ (Baru)

```mermaid
erDiagram
    Outlet {
        int id PK
        string name
        string code UK
        string phone
        boolean is_active
        boolean pos_enabled
        datetime created_at
        datetime updated_at
        datetime deleted_at
    }

    OutletAddress {
        int outlet_id PK_FK
        string street
        string district
        string city
        string province
        string country
        string postal_code
        string url_google_maps
    }

    OutletStaff {
        int id PK
        int outlet_id FK
        string account_id FK
        OutletRole role
        datetime created_at
    }

    PosDevice {
        int id PK
        int outlet_id FK
        string device_name
        string device_token UK
        datetime last_sync_at
        boolean is_active
        datetime created_at
    }

    OutletInventory {
        int id PK
        int outlet_id FK
        int product_id FK
        decimal quantity
        decimal min_stock
        datetime updated_at
    }

    Outlet ||--o| OutletAddress : "has address"
    Outlet ||--o{ OutletStaff : "has staff"
    Outlet ||--o{ PosDevice : "has devices"
    Outlet ||--o{ OutletInventory : "has stock"
    Account ||--o{ OutletStaff : "assigned to"
```

---

## 3. Domain: Warehouse & Product ✅

```mermaid
erDiagram
    Warehouse {
        int id PK
        string name
        WarehouseType type
        datetime created_at
        datetime updated_at
        datetime deleted_at
    }

    WarehouseAddress {
        int warehouse_id PK_FK
        string street
        string district
        string city
        string province
        string country
        string postal_code
    }

    Product {
        int id PK
        string name
        string code UK
        int type_id FK
        int size_id FK
        int unit_id FK
        GENDER gender
        STATUS status
        decimal z_value
        int lead_time
        int review_period
        decimal distribution_percentage
        decimal safety_percentage
        datetime created_at
        datetime updated_at
        datetime deleted_at
    }

    ProductType {
        int id PK
        string slug UK
        string name
    }

    ProductSize {
        int id PK
        int size UK
    }

    Unit {
        int id PK
        string slug UK
        string name
    }

    ProductInventory {
        int id PK
        int product_id FK
        int warehouse_id FK
        decimal quantity
        decimal min_stock
        int date
        int month
        int year
    }

    Warehouse ||--o| WarehouseAddress : "has"
    Warehouse ||--o{ ProductInventory : "stores"
    Product ||--o{ ProductInventory : "stored in"
    Product }o--o| ProductType : "classified as"
    Product }o--o| ProductSize : "has size"
    Product }o--o| Unit : "measured in"
```

---

## 4. Domain: Raw Material ✅

```mermaid
erDiagram
    RawMaterial {
        int id PK
        string barcode UK
        string name
        decimal price
        decimal min_buy
        decimal min_stock
        int unit_id FK
        int raw_mat_categories_id FK
        int supplier_id FK
        MaterialType type
        int lead_time
        datetime created_at
        datetime updated_at
        datetime deleted_at
    }

    RawMatCategories {
        int id PK
        string name
        string slug UK
        STATUS status
    }

    UnitRawMaterial {
        int id PK
        string slug UK
        string name
    }

    Supplier {
        int id PK
        string name
        string addresses
        string country
        string phone UK
        string slug UK
        datetime created_at
        datetime updated_at
    }

    RawMaterialInventory {
        int id PK
        int raw_material_id FK
        int warehouse_id FK
        decimal quantity
        decimal min_stock
        int date
        int month
        int year
    }

    RawMaterial }o--o| RawMatCategories : "in category"
    RawMaterial }o--o| Supplier : "from supplier"
    RawMaterial ||--|| UnitRawMaterial : "measured in"
    RawMaterial ||--o{ RawMaterialInventory : "stored in"
    Warehouse ||--o{ RawMaterialInventory : "stores"
```

---

## 5. Domain: Recipe & BOM ✅

```mermaid
erDiagram
    Recipes {
        int id PK
        int product_id FK
        int raw_mat_id FK
        int version
        boolean is_active
        decimal quantity
        string description
    }

    Product ||--o{ Recipes : "composed of"
    RawMaterial ||--o{ Recipes : "used in"
```

---

## 6. Domain: Purchase Order ⬜ (Baru - gantikan RawMaterialOpenPo)

```mermaid
erDiagram
    PurchaseOrder {
        int id PK
        string po_number UK
        int supplier_id FK
        int warehouse_id FK
        PurchaseOrderStatus status
        decimal total_amount
        datetime expected_date
        string notes
        string created_by FK
        string approved_by FK
        datetime approved_at
        datetime created_at
        datetime updated_at
    }

    PurchaseOrderItem {
        int id PK
        int purchase_order_id FK
        int raw_material_id FK
        decimal quantity_ordered
        decimal quantity_received
        decimal unit_price
        decimal subtotal
    }

    PurchaseOrder ||--o{ PurchaseOrderItem : "contains"
    Supplier ||--o{ PurchaseOrder : "supplies"
    Warehouse ||--o{ PurchaseOrder : "receives at"
    RawMaterial ||--o{ PurchaseOrderItem : "ordered in"
```

---

## 7. Domain: Stock Transfer ⬜ (Baru)

```mermaid
erDiagram
    StockTransfer {
        int id PK
        string transfer_number UK
        TransferLocationType from_type
        int from_id
        TransferLocationType to_type
        int to_id
        TransferStatus status
        string notes
        string created_by FK
        string approved_by FK
        datetime created_at
        datetime updated_at
    }

    StockTransferItem {
        int id PK
        int transfer_id FK
        int product_id FK
        decimal quantity_requested
        decimal quantity_sent
        decimal quantity_received
    }

    StockTransfer ||--o{ StockTransferItem : "contains"
    Product ||--o{ StockTransferItem : "transferred"
```

> **Catatan:** `from_id` dan `to_id` bersifat polymorphic — bisa merujuk ke `warehouse_id` atau `outlet_id` tergantung `from_type` / `to_type`.

---

## 8. Domain: Stock Adjustment ⬜ (Baru)

```mermaid
erDiagram
    StockAdjustment {
        int id PK
        string adjustment_number UK
        AdjustmentLocationType location_type
        int location_id
        AdjustmentStatus status
        AdjustmentReason reason
        string notes
        string created_by FK
        string applied_by FK
        datetime applied_at
        datetime created_at
    }

    StockAdjustmentItem {
        int id PK
        int adjustment_id FK
        MovementEntityType entity_type
        int entity_id
        decimal qty_before
        decimal qty_after
        decimal qty_diff
    }

    StockAdjustment ||--o{ StockAdjustmentItem : "contains"
```

---

## 9. Domain: Stock Movement Log ⬜ (Baru)

```mermaid
erDiagram
    StockMovement {
        int id PK
        MovementEntityType entity_type
        int entity_id
        MovementLocationType location_type
        int location_id
        MovementType movement_type
        decimal quantity
        decimal qty_before
        decimal qty_after
        int reference_id
        MovementRefType reference_type
        string notes
        string created_by
        datetime created_at
    }
```

> `StockMovement` adalah **universal audit log** — setiap perubahan stok dari modul apapun (PO, Transfer, Adjustment, POS) wajib membuat satu record di sini.

---

## 10. Domain: POS Sales ⬜ (Baru)

```mermaid
erDiagram
    SalesTransaction {
        int id PK
        string transaction_uuid UK
        int outlet_id FK
        int device_id FK
        decimal total_amount
        datetime transaction_at
        datetime synced_at
        string notes
    }

    SalesTransactionItem {
        int id PK
        int transaction_id FK
        int product_id FK
        decimal quantity
        decimal unit_price
        decimal subtotal
    }

    SalesTransaction ||--o{ SalesTransactionItem : "contains"
    Outlet ||--o{ SalesTransaction : "has"
    PosDevice ||--o{ SalesTransaction : "recorded by"
    Product ||--o{ SalesTransactionItem : "sold in"
```

---

## 11. Domain: Forecasting (✅ Sudah Ada)

```mermaid
erDiagram
    SalesActual {
        int id PK
        int product_id FK
        int month
        int year
        decimal quantity
        SalesType type
        datetime created_at
        datetime updated_at
    }

    ForecastPercentage {
        int id PK
        int month
        int year
        decimal value
    }

    Forecast {
        int id PK
        int product_id FK
        int month
        int year
        Trend trend
        ForecastStatus status
        decimal base_forecast
        decimal final_forecast
        int forecast_percentage_id FK
    }

    SafetyStock {
        int id PK
        int product_id FK
        int month
        int year
        int horizon
        decimal avg_forecast
        decimal total_forecast
        decimal safety_stock_quantity
        decimal safety_stock_ratio
    }

    MaterialRecommendationOrder {
        int id PK
        int raw_mat_id FK
        int month
        int year
        decimal quantity
        int horizon
        decimal total_needed
        decimal current_stock
        decimal stock_fg_x_resep
        decimal safety_stock_x_resep
        int open_po_id FK
        string pic_id FK
        RecommendationStatus status
    }

    Product ||--o{ SalesActual : "has sales"
    Product ||--o{ Forecast : "has forecast"
    Product ||--o{ SafetyStock : "has safety stock"
    ForecastPercentage ||--o{ Forecast : "used in"
    RawMaterial ||--o{ MaterialRecommendationOrder : "ordered"
```

---

## 12. Domain: Alerts ⬜ (Baru)

```mermaid
erDiagram
    StockAlert {
        int id PK
        MovementEntityType entity_type
        int entity_id
        MovementLocationType location_type
        int location_id
        AlertType alert_type
        decimal threshold_value
        decimal current_value
        AlertStatus status
        string resolved_by FK
        datetime created_at
        datetime resolved_at
    }
```

---

## 13. Tabel Referensi Enum

| Enum | Values |
|------|--------|
| `ROLE` | STAFF, SUPER_ADMIN, OWNER, DEVELOPER |
| `STATUS` | PENDING, ACTIVE, FAVOURITE, BLOCK, DELETE |
| `WarehouseType` | FINISH_GOODS, RAW_MATERIAL |
| `OutletRole` | MANAGER, STAFF, CASHIER |
| `PurchaseOrderStatus` | DRAFT, SUBMITTED, APPROVED, PARTIAL, COMPLETED, CANCELLED, REJECTED |
| `TransferStatus` | PENDING, APPROVED, IN_TRANSIT, COMPLETED, CANCELLED |
| `TransferLocationType` | WAREHOUSE, OUTLET |
| `AdjustmentReason` | DAMAGE, LOSS, CORRECTION, EXPIRED, FOUND, OTHER |
| `AdjustmentStatus` | DRAFT, APPLIED |
| `AdjustmentLocationType` | WAREHOUSE, OUTLET |
| `MovementEntityType` | PRODUCT, RAW_MATERIAL |
| `MovementLocationType` | WAREHOUSE, OUTLET |
| `MovementType` | IN, OUT, TRANSFER_IN, TRANSFER_OUT, ADJUSTMENT, OPNAME, INITIAL, POS_SALE |
| `MovementRefType` | PURCHASE_ORDER, STOCK_TRANSFER, STOCK_ADJUSTMENT, SALES_TRANSACTION, MANUAL |
| `AlertType` | LOW_STOCK, OVERSTOCK |
| `AlertStatus` | ACTIVE, RESOLVED, DISMISSED |
| `SalesType` | ALL, OFFLINE, ONLINE, SPIN_WHEEL, GARANSI_OUT |
| `ForecastStatus` | DRAFT, FINALIZED, ADJUSTED |
| `Trend` | UP, DOWN, STABLE |
| `MaterialType` | FO, PCKG |
| `RecommendationStatus` | DRAFT, ACC, REJECTED |
