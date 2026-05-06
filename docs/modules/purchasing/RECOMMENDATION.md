# Recommendation-v2 Module & PO OPEN Integration

## 1. Overview

The Recommendation-v2 module provides intelligent purchasing recommendations based on:
- Current stock levels
- Demand forecasts (sales projections)
- Open purchase orders (PO OPEN)
- Safety stock requirements

Key feature: **Open POs are displayed in the "PO OPEN" column** to prevent over-ordering and improve inventory visibility.

## 2. Recommendation Calculation Logic

For each raw material, the system calculates:

```
Recommended Quantity = 
    Forecast Needed 
    - Current Stock 
    - Stock (FG × Recipe) 
    - Safety Stock (× Recipe)
    - Open PO Quantity

Where:
  - Forecast Needed    : Projected demand based on sales forecast
  - Current Stock      : Available inventory
  - Stock (FG × Recipe): Finished goods broken down by recipe requirements
  - Safety Stock       : Buffer stock for demand variability
  - Open PO           : Quantity on pending/open purchase orders
```

The inclusion of "Open PO" prevents redundant purchasing commitments.

## 3. Data Structure

### 3.1 Core Response Schema
```typescript
{
  ranking: number,                    // Priority rank
  material_id: number,
  barcode: string | null,
  material_name: string,
  supplier_name: string | null,
  moq: number,                        // Minimum order quantity
  lead_time: number | null,
  uom: string,                        // Unit of measure
  recommendation_quantity: number,    // Calculated recommendation
  
  // Transparency: breakdown of calculation
  current_stock: number,
  open_po: number,                    // Total open PO quantity for this material
  stock_fg_x_resep: number,
  safety_stock_x_resep: number,
  forecast_needed: number,
  total_needed_horizon: number,
  
  // Work Order Status (if exists)
  work_order_id: number | null,
  work_order_status: string | null,
  work_order_pic_id: string | null,
  work_order_quantity: number | null,
  work_order_horizon: number | null,
  
  // Time-series data
  sales: [
    { month, year, key, quantity }
  ],
  needs: [
    { month, year, key, quantity, override_needs }
  ],
  open_pos: [
    { month, year, key, quantity }
  ]
}
```

### 3.2 Open POs Array
```typescript
open_pos: [
  {
    month: number,        // 1-12
    year: number,         // e.g., 2026
    key: string,          // "2026-05" (YYYY-MM format)
    quantity: number      // Open PO qty for that period
  },
  ...
]
```

## 4. PO OPEN Column Behavior

### 4.1 Display Rules
- Shows for each raw material in the recommendation list
- Aggregates all open (ORDERED) POs for that material
- Time window: Last `po_months` (default: 3 months)
- Grouped by month/year for visibility into delivery schedules

### 4.2 Data Source
Open POs come from the Purchase Order module:
- Only POs with status = `ORDERED` (not DRAFT, SUBMITTED, etc.)
- Includes raw material ID and quantities
- Time-indexed by expected delivery month

### 4.3 User Interpretation
For raw material "Steel Plate":
```
Open PO Column shows:
[
  { month: 5, year: 2026, quantity: 100 },  // 100kg due May 2026
  { month: 6, year: 2026, quantity: 150 }   // 150kg due June 2026
]

Purchasing staff can see:
- Total open commitment: 250kg
- Delivery schedule: Spread across May and June
- Risk: If June delivery fails, stock may run short
```

## 5. Recommendation-v2 Query Parameters

### 5.1 Pagination & Search
```
page: number              (default: 1)
take: number              (default: 25, max: 500)
search: string            // Search by material name, barcode, supplier
```

### 5.2 Time Range Filters
```
month: 1-12               // Specific month for forecast
year: number              // Year (e.g., 2026)
sales_months: number      // Historical sales window (default: 3)
forecast_months: number   // Forecast horizon (default: 3)
po_months: number         // Open PO window (default: 3) ← PO OPEN relevance
```

### 5.3 Type & Sorting
```
type: "ffo" | "lokal" | "impor"     // Filter by PO type
sortBy: string                       // Column to sort
order: "asc" | "desc"               // Sort direction
```

### 5.4 UI Preferences
```
visibleColumns: string    // Comma-separated column names to display
columnOrder: string       // Custom column ordering
selectedIds: string       // Selected material IDs
```

## 6. PO OPEN Integration Flow

### 6.1 When PO Status Changes

**PO Status = ORDERED** → Appears in Recommendation
```
1. PO is published with status ORDERED
2. System records: raw_material_id, qty_ordered, expected_delivery_month
3. Recommendation query includes this PO in open_pos array
4. User sees in "PO OPEN" column
```

**PO Status = CLOSED** → Disappears from Recommendation
```
1. Goods receipt processed, PO status = CLOSED
2. System removes from open_pos tracking
3. Recommendation query no longer includes this PO
4. User sees 0 in "PO OPEN" column
```

### 6.2 Time Window Behavior

With `po_months: 3` (default):
- Shows all ORDERED POs expected in last 3 months
- Helps identify delayed deliveries
- Prevents over-recommendation for near-term needs

Example:
```
Today: May 5, 2026
po_months: 3

Visible Open POs:
- March 2026 deliveries (late/delayed?)
- April 2026 deliveries (arrived or pending?)
- May 2026 deliveries (current month)
- June 2026 and beyond: NOT shown (use procurement planning)
```

### 6.3 Calculation Impact

**Without Open PO consideration** (old logic):
```
Recommendation = Forecast - Current Stock - Safety Stock
Risk: Duplicate orders if unaware of existing commitments
```

**With Open PO consideration** (current logic):
```
Recommendation = Forecast - Current Stock - Safety Stock - Open PO
Benefit: Avoids double-buying; improves cash flow
```

## 7. Usage Scenarios

### Scenario 1: PO Arriving Soon
```
Material: Resin
Current Stock: 100kg
Open PO: 500kg (arriving June 2026)
Forecast Needed (May): 150kg

Recommendation Calculation:
= 150 - 100 - (open PO for May) - 20 (safety stock)
= 150 - 100 - 0 - 20
= 30kg

Decision: Order only 30kg to bridge until June PO arrives.
Without considering Open PO: Would recommend 150kg (wasteful).
```

### Scenario 2: Late PO Delivery
```
Material: Steel Plate
Current Stock: 50kg
Open PO: 300kg (should arrive April, but it's May now - delayed!)
Forecast Needed (May): 250kg

Recommendation Calculation:
= 250 - 50 - 300 (late but still counted) - 40
= -140kg (negative = over-stocked?!)

Alert: The negative value signals:
- Either the PO should have arrived (and is late)
- Or the forecast is unrealistic
Action: Flag delayed PO or re-forecast.
```

### Scenario 3: No Open POs
```
Material: Fasteners
Current Stock: 20kg
Open PO: 0kg
Forecast Needed (May-June): 100kg

Recommendation Calculation:
= 100 - 20 - 0 - 15 (safety stock)
= 65kg

Action: Create new PO/RFQ for 65kg (or MOQ minimum).
```

## 8. Work Order Integration

### 8.1 Status Tracking
- If a work order exists for a recommendation, status is shown.
- Helps track whether a recommendation has been actioned.

### 8.2 Horizon
- `work_order_horizon`: Number of months the work order covers.
- Helps assess whether open POs align with work order scope.

## 9. Query Examples

### Example 1: Current Month Recommendations
```
GET /api/recommendation-v2?
  month=5&year=2026&
  sales_months=3&
  forecast_months=3&
  po_months=3&
  take=50
```
Returns: Materials with recommendation quantities for May 2026, considering last 3 months of sales, next 3 months forecast, and open POs from last 3 months.

### Example 2: IMPORT Type Only
```
GET /api/recommendation-v2?
  type=impor&
  po_months=6&
  sortBy=recommendation_quantity&
  order=desc
```
Returns: Import materials sorted by recommendation quantity (highest first), considering 6 months of open POs (longer window for import lead times).

### Example 3: Search Specific Material
```
GET /api/recommendation-v2?
  search=steel&
  visibleColumns=material_name,open_po,recommendation_quantity
```
Returns: Materials matching "steel", showing only 3 columns for focused view.

## 10. Performance Considerations

### 10.1 Aggregation Strategy
- Open POs are pre-aggregated by material and month
- Avoids N+1 queries during recommendation fetch
- Time window filtering (po_months) reduces data volume

### 10.2 Caching
- Recommendation data can be cached for 1 hour (or configurable)
- PO status changes trigger cache invalidation
- Trades real-time accuracy for performance

### 10.3 Indexing
- Indexes on: raw_material_id, status, expected_delivery_month
- Ensures sub-second query times even with large PO volumes

## 11. Alerts & Warnings

### 11.1 Negative Recommendations
- Indicates over-stock or very late open POs
- Alert: "Check for delayed POs or review forecast"

### 11.2 High Open PO
- If open_po > forecast_needed
- Alert: "Over-committed; revisit supplier agreements"

### 11.3 No PO for Long Lead Time Items
- If lead_time > 30 days and open_po = 0
- Alert: "Long lead time material with no open PO; order urgently"

## 12. Integration with Other Modules

### 12.1 With Purchase Order Module
- Queries POs with status = ORDERED
- Listens to PO status change events
- Updates open_pos when PO status changes

### 12.2 With Consolidation Module
- Inherits recommendations from consolidation engine
- Combines with open PO data for final output

### 12.3 With Inventory Module
- Gets current_stock from inventory
- Validates PO quantities against inventory records

### 12.4 With Planning Module
- Feeds recommendations into planning workflows
- Supports bulk actions: "Approve all recommendations" → Creates RFQs/POs
