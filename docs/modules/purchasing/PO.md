# Purchase Order (PO) Module Documentation

## 1. Overview

The Purchase Order (PO) module handles the creation, management, and tracking of purchase orders. POs are created from approved RFQs or manually for independent purchases. Key feature: **Open POs (ORDERED status) are displayed in Recommendation-v2 under the "PO OPEN" column** to help planning and inventory management.

## 2. PO Creation Sources

### 2.1 From Approved RFQ
- When an RFQ is in `APPROVED` status per supplier, it can be published as a Purchase Order.
- System carries over:
  - Supplier details (supplier_id, supplier_name)
  - Raw material items, quantities, unit prices
  - Reference to source RFQ (source_rfq_id)

### 2.2 Manual PO Creation
- Users can create POs directly without an RFQ.
- Useful for ad-hoc purchases or vendors not tracked in RFQ.
- Users specify supplier (existing or new), items, and quantities.

## 3. PO Data Structure

### 3.1 PO Header
```
po_number       : Unique identifier (auto-generated or user-specified)
po_date         : Date of PO creation
po_type         : LOCAL | IMPORT | FO (Fabric Order)
supplier_id     : Link to supplier master
supplier_name   : Supplier name
is_new_supplier : Flag for one-time/new suppliers
warehouse_id    : Target warehouse for delivery
source_rfq_id   : Optional link back to originating RFQ
currency        : Default IDR
exchange_rate   : For foreign currency conversions
total_estimated : Calculated from items
status          : Current PO status (see section 4)
notes           : General notes
payment_notes   : Payment terms description
```

### 3.2 PO Items (Line Items)
```
raw_material_id  : Link to raw material master (for auto-pulled items)
item_code        : Material code
item_name        : Material name
item_category    : Categorization
item_type        : MASTER (from raw materials) | MANUAL (one-off items)
uom              : Unit of measure
moq              : Minimum order quantity
unit_price       : Price per unit
qty_ordered      : Quantity ordered
subtotal         : unit_price × qty_ordered
notes            : Item-specific notes
```

### 3.3 Payment Terms
```
term_seq  : Sequence (1st, 2nd, 3rd payment)
percentage: Percentage of total (e.g., 30%, 40%, 30%)
due_days  : Days after PO date for payment
notes     : Term-specific notes
```

## 4. PO Workflow & Statuses

```
DRAFT
  ↓ (Ready for submission)
SUBMITTED
  ↓ (Manager approval)
APPROVED
  ↓ (Order placed)
ORDERED ← **This is "OPEN" - visible in Recommendation-v2**
  ↓ (Goods received, PO closed)
CLOSED
  ↕ (Any status)
CANCELLED
```

### Status Details

| Status | Description | Editable | Action |
|--------|-------------|----------|--------|
| DRAFT | Initial creation, not yet submitted | Yes | Submit for approval |
| SUBMITTED | Awaiting manager approval | Limited | Approve or reject |
| APPROVED | Approved, ready to order | Limited | Place order |
| ORDERED | **Order placed & OPEN** (PO visible in Recommendation) | No | Receive goods |
| CLOSED | Goods fully received, PO complete | No | View/Archive |
| CANCELLED | PO voided | No | N/A |

## 5. Integration with Recommendation-v2

### 5.1 PO OPEN Column
- **Visibility**: Only POs with status `ORDERED` appear in the "PO OPEN" column in Recommendation-v2.
- **Purpose**: Show open purchase commitments to assist in:
  - Inventory planning
  - Demand forecasting
  - Stock level calculations
  - Avoiding duplicate orders

### 5.2 Data Displayed
For each material in Recommendation-v2:
```
open_po: [
  {
    month: number,
    year: number,
    key: string,
    quantity: number
  },
  ...
]
```

### 5.3 Filtering & Time Window
- Default time window: Last 3 months of open POs (`po_months: 3`)
- Can be adjusted via query parameter
- Closed or cancelled POs do not appear

## 6. PO Lifecycle - Detailed Flow

### 6.1 Creation from RFQ
1. User views approved RFQ (per supplier, status = APPROVED)
2. User clicks "Publish to PO" or "Create PO"
3. System creates PO with:
   - Status = DRAFT
   - supplier_id, supplier_name from RFQ
   - Items from RFQ items
   - source_rfq_id = RFQ.id (audit trail)
4. User reviews PO, makes adjustments if needed
5. User submits PO → Status = SUBMITTED

### 6.2 Manual Creation
1. User clicks "Create PO" (standalone)
2. User fills:
   - Supplier (existing or new)
   - Items (select from raw materials or manual entry)
   - Quantities, unit prices
   - Payment terms (optional)
3. User submits → Status = DRAFT then SUBMITTED

### 6.3 Approval Process
1. Manager reviews submitted PO
2. Manager approves → Status = APPROVED
3. Manager places order → Status = ORDERED (now visible in Recommendation)

### 6.4 Goods Receipt
1. Warehouse receives goods against ORDERED PO
2. Goods receipt created/linked to PO
3. PO status updated → CLOSED (or RECEIVED, depending on business logic)
4. PO no longer appears in Recommendation "PO OPEN" column

## 7. Query & Filtering

### Query Parameters
```
page              : Pagination (default: 1)
take              : Items per page (default: 50, max: 500)
search            : Search by PO number or supplier name
status            : Filter by status (DRAFT, SUBMITTED, APPROVED, ORDERED, CLOSED, CANCELLED)
po_type           : Filter by type (LOCAL, IMPORT, FO)
supplier_id       : Filter by supplier
warehouse_id      : Filter by warehouse
month / year      : Filter by creation date
sortBy            : Sort field (po_date, po_number, status, created_at, total_estimated)
order             : asc | desc (default: desc)
```

## 8. Integration Points

### 8.1 With RFQ Module
- PO references source RFQ via `source_rfq_id`
- When RFQ is published to PO, RFQ status → CONVERTED
- Changes to RFQ should not affect already-published POs

### 8.2 With Recommendation-v2
- Open POs (ORDERED status) feed into "PO OPEN" column
- Recommendation query can filter by open PO months
- Used in quantity calculations: `quantity_needed = forecast_needed - current_stock - open_po`

### 8.3 With Supplier Master
- PO validates supplier_id existence
- Supports new suppliers (is_new_supplier flag) for one-time vendors

### 8.4 With Raw Material Master
- For MASTER-type items, validates raw_material_id
- Carries over material properties (UOM, MOQ, etc.)

## 9. Audit Trail

- Creation: Tracked via created_at, creator
- Modifications: Tracked via updated_at
- Status changes: Should be logged for compliance
- Link to RFQ: Via source_rfq_id for full traceability from Recommendation → Consolidation → RFQ → PO

## 10. Future Enhancements

- Goods receipt integration (auto-update PO status)
- Invoice matching (3-way matching: PO ↔ GR ↔ Invoice)
- Supplier performance tracking
- PO aging reports
- Automated reminders for overdue deliveries
