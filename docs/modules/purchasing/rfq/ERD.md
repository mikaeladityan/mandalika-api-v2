# RFQ Entity Relationship Diagram (ERD)

This document defines the database schema extensions required for the RFQ module, ensuring compatibility with the existing Prisma schema.

## 1. Database Schema Extensions

### 1.1. New Enums
```prisma
enum RFQStatus {
  DRAFT
  SENT
  RECEIVED
  APPROVED
  PARTIAL_CONVERTED
  CONVERTED
  CANCELLED
}
```

### 1.2. New Models
```prisma
model RequestForQuotation {
  id              Int           @id @default(autoincrement())
  rfq_number      String        @unique @db.VarChar(50)
  vendor_id       Int?
  warehouse_id    Int?
  date            DateTime      @default(now())
  status          RFQStatus     @default(DRAFT)
  notes           String?
  created_at      DateTime      @default(now())
  updated_at      DateTime      @updatedAt
  
  vendor          Supplier?     @relation(fields: [vendor_id], references: [id])
  warehouse       Warehouse?    @relation(fields: [warehouse_id], references: [id])
  items           RFQItem[]
  open_pos        RawMaterialOpenPo[]

  @@map("request_for_quotations")
}

model RFQItem {
  id                    Int                  @id @default(autoincrement())
  rfq_id                Int
  raw_material_id       Int
  purchase_draft_id     Int?                 @unique
  quantity              Decimal              @db.Decimal(18, 2)
  unit_price            Decimal?             @db.Decimal(18, 2)
  notes                 String?
  
  rfq                   RequestForQuotation  @relation(fields: [rfq_id], references: [id], onDelete: Cascade)
  raw_material          RawMaterial          @relation(fields: [raw_material_id], references: [id])
  purchase_draft        MaterialPurchaseDraft? @relation(fields: [purchase_draft_id], references: [id])

  @@map("rfq_items")
}
```

### 1.3. Modifications to Existing Models
- **`Supplier`**: Add `rfqs RequestForQuotation[]`
- **`RawMaterial`**: Add `rfq_items RFQItem[]`
- **`MaterialPurchaseDraft`**: Add `rfq_item RFQItem?`
- **`RawMaterialOpenPo`**: Add `rfq_id Int?` and `rfq RequestForQuotation? @relation(fields: [rfq_id], references: [id])`

## 2. Visual Diagram

```mermaid
erDiagram
    Supplier ||--o{ RequestForQuotation : "provides quotes"
    RequestForQuotation ||--|{ RFQItem : "contains"
    RFQItem }|--|| RawMaterial : "requests"
    RFQItem |o--o| MaterialPurchaseDraft : "originates from"
    RequestForQuotation |o--o{ RawMaterialOpenPo : "converts to"
    
    MaterialPurchaseDraft {
        int id
        int raw_mat_id
        decimal quantity
        status RecommendationStatus
    }
    
    RequestForQuotation {
        int id
        string rfq_number
        int vendor_id
        datetime date
        status RFQStatus
    }
    
    RFQItem {
        int id
        int rfq_id
        int raw_material_id
        int purchase_draft_id
        decimal quantity
        decimal unit_price
    }
    
    RawMaterialOpenPo {
        int id
        string po_number
        int rfq_id
        decimal quantity
    }
```

## 3. Rationale
- **Traceability**: By linking `RFQItem` directly to `MaterialPurchaseDraft`, we can track exactly which recommendation led to which quotation.
- **Flexibility**: The `vendor_id` is optional in the RFQ header to allow creating an RFQ before a vendor is finalized (though standard flow usually has one).
- **Manual Input**: Manual items in RFQ will simply have `purchase_draft_id` as `null`.
