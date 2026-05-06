# Purchasing Modules - Complete Documentation

## Overview

The Purchasing subsystem manages the complete procurement lifecycle from demand recommendations through to delivery. It integrates three primary modules:

1. **Consolidation** (Demand Planning)
2. **RFQ** (Request for Quotation)
3. **PO** (Purchase Order)
4. **Recommendation-v2** (Visibility & Planning)

## Module Relationships

```
Inventory Demand
        ↓
Consolidation (Approved Material Recommendations)
        ↓ (Pull Raw Materials)
RFQ List (Grouped by Raw Material)
    ├─→ Select Suppliers (Existing or New)
    └─→ View Per-Supplier Quotations
        ↓ (FIX → APPROVED)
RFQ Per-Supplier (APPROVED)
        ↓ (Publish to PO)
Purchase Order (DRAFT → SUBMITTED → APPROVED → ORDERED)
        ↓ (Display in Planning View)
Recommendation-v2 (PO OPEN Column)
        ↓ (Goods Arrival)
Inventory Update
```

## Module Documentation Files

### 1. RFQ (Request for Quotation)
**Location**: `/api/docs/modules/purchasing/rfq/`

- **PRD.md** - Product requirements & functional specifications
  - RFQ creation (automated from Consolidation or manual)
  - Per-supplier organization & quotation management
  - Status workflow: DRAFT → FIX → APPROVED
  
- **FLOW.md** - Workflow diagram & step-by-step process
  - Visual flow from Consolidation → RFQ → PO
  - Status transitions explained
  - Integration points
  
- **ERD.md** - Database schema & entity relationships
  - Table structures (RequestForQuotation, RFQItem)
  - Relationships with Consolidation, Supplier, RawMaterial, PO
  - Per-supplier grouping logic

- **frontend/** - Frontend implementation guides
  - ENDPOINT.md - Backend API endpoints
  - FRONTEND_INTEGRATION.md - React component patterns
  - ROADMAP.md - Feature roadmap

### 2. PO (Purchase Order)
**Location**: `/api/docs/modules/purchasing/PO.md`

- PO creation sources (from RFQ or manual)
- PO data structure & workflow
- Status lifecycle: DRAFT → SUBMITTED → APPROVED → ORDERED → CLOSED
- Integration with Recommendation-v2 (OPEN PO column)
- Query & filtering capabilities
- Audit trail & traceability back to RFQ/Consolidation

### 3. Recommendation-v2
**Location**: `/api/docs/modules/purchasing/RECOMMENDATION.md`

- Recommendation calculation logic
- Integration with Open POs (PO OPEN column)
- Data structure & query parameters
- Time-window behavior for open PO visibility
- Usage scenarios & interpretation
- Performance considerations

## Key Concepts

### Per-Supplier RFQ Organization

For a single raw material from Consolidation, multiple RFQ records can exist (one per supplier):

```
Raw Material: Steel Plate (100kg needed)

RFQ 1: Supplier A
  Status: APPROVED
  Unit Price: Rp 50,000/kg
  
RFQ 2: Supplier B
  Status: DRAFT
  Unit Price: Rp 48,000/kg
  
RFQ 3: Supplier C (New - manual)
  Status: FIX
  Unit Price: Rp 52,000/kg
```

Users can:
- View as table (all suppliers in one list)
- View per-supplier (grouped/filtered)
- Compare quotations
- Select supplier(s) to publish to PO

### Open PO Visibility

Open POs (status = ORDERED) are displayed in Recommendation-v2:

```
Recommendation = Forecast Needed 
               - Current Stock 
               - Open PO Quantity
               - Safety Stock

This prevents over-ordering and improves inventory accuracy.
```

### Manual Entry Flexibility

Both RFQ and PO support manual creation without Consolidation dependency:
- Useful for ad-hoc purchases
- Supports one-time vendors
- No impact on consolidation/recommendation engine

## Workflow Summary

### Standard Flow (from Consolidation)
1. **Consolidation APPROVED** → Raw materials ready
2. **Create RFQ** → Pull approved materials, list by raw material
3. **Select Suppliers** → For each material, choose/add suppliers
4. **Manage Quotations** → Update prices, quantities, notes per supplier
5. **Set Status** → DRAFT → FIX → APPROVED (per supplier)
6. **Publish to PO** → Create Purchase Order from APPROVED RFQ
7. **PO Workflow** → DRAFT → SUBMITTED → APPROVED → ORDERED
8. **Open PO Display** → Appears in Recommendation-v2 PO OPEN column
9. **Goods Receipt** → Receive goods, PO status → CLOSED

### Manual Flow (Independent)
1. **Create RFQ Manually** → No Consolidation link (purchase_draft_id = null)
2. **Add Items** → Select raw materials or manual items
3. **Add Suppliers** → Specify supplier & quotation details
4. **Publish to PO** → Convert to Purchase Order
5. **Rest same as above** → Steps 7-9 of Standard Flow

## Status Reference

### RFQ Statuses (Per Supplier)
- **DRAFT** - Quotation under preparation
- **SENT** - Request sent to supplier (optional tracking status)
- **RECEIVED** - Quote received, prices updated
- **FIX** - Quotation finalized, ready for approval
- **APPROVED** - Manager approved, ready to publish to PO
- **CONVERTED** - Published to Purchase Order
- **CANCELLED** - RFQ discarded

### PO Statuses
- **DRAFT** - Initial creation, under edit
- **SUBMITTED** - Submitted for approval
- **APPROVED** - Manager approved
- **ORDERED** - Order placed, purchase committed ← **Visible in Recommendation "PO OPEN"**
- **CLOSED** - Goods fully received
- **CANCELLED** - PO voided

## API Reference Overview

### RFQ Endpoints
- `POST /api/rfq` - Create RFQ
- `GET /api/rfq` - List RFQs (with filtering)
- `GET /api/rfq/{id}` - Get RFQ details
- `PUT /api/rfq/{id}` - Update RFQ
- `POST /api/rfq/{id}/publish` - Publish RFQ to PO
- `DELETE /api/rfq/{id}` - Delete RFQ

### PO Endpoints
- `POST /api/po` - Create PO
- `GET /api/po` - List POs (with filtering)
- `GET /api/po/{id}` - Get PO details
- `PUT /api/po/{id}` - Update PO
- `PATCH /api/po/{id}/status` - Update PO status
- `DELETE /api/po/{id}` - Delete PO

### Recommendation-v2 Endpoints
- `GET /api/recommendation-v2` - Get recommendations with open PO data
- `POST /api/recommendation-v2/work-order` - Create work order from recommendation
- `PATCH /api/recommendation-v2/horizon` - Update horizon in bulk

## Common Tasks

### Task: Check Open POs for a Material
1. Open Recommendation-v2
2. Search for material name
3. View "PO OPEN" column
4. See months/quantities of open commitments

### Task: Create PO from Approved RFQ
1. Open RFQ list
2. Filter by status = APPROVED
3. Select RFQ per supplier
4. Click "Publish to PO"
5. System creates PO in DRAFT status
6. Review & submit for approval

### Task: Bulk RFQ Creation from Consolidation
1. View Consolidation (approved items)
2. Select multiple items
3. "Create RFQs" (bulk action)
4. System groups by suggested supplier
5. Creates RFQ records in DRAFT

## Performance Notes

- RFQ queries optimized for per-supplier grouping
- PO-Recommendation integration uses monthly aggregation
- Recommendation calculation cached (1 hour default, invalidated on PO status change)
- Supports filtering by time window to reduce data volume

## Future Enhancements

- Automated RFQ generation based on consolidation settings
- Supplier performance scoring (on-time delivery, quality)
- Invoice matching & 3-way reconciliation (PO ↔ GR ↔ Invoice)
- Goods receipt integration with auto-status updates
- PO aging reports & delayed delivery alerts
- Multi-currency optimization for IMPORT POs
- Contract management (blanket orders, framework agreements)

## Troubleshooting

### Issue: RFQ not creating from Consolidation
**Cause**: Consolidation item not APPROVED status
**Solution**: Ensure Consolidation approval workflow is complete

### Issue: PO not appearing in Recommendation
**Cause**: PO status is not ORDERED
**Solution**: Complete PO approval workflow to reach ORDERED status

### Issue: Open PO quantity incorrect
**Cause**: Multiple POs for same material, or old PO not marked CLOSED
**Solution**: Verify PO statuses; mark completed POs as CLOSED

### Issue: Recommendation quantity negative
**Cause**: Open POs exceed forecast needs (over-committed)
**Solution**: Review forecast accuracy or delay PO delivery date

## Related Documentation

- **Consolidation Module**: `/api/docs/modules/inventory/consolidation/` (Demand Planning)
- **Inventory Module**: `/api/docs/modules/inventory/` (Stock Levels)
- **Supplier Master**: `/api/docs/modules/setup/suppliers/` (Supplier Data)
- **Raw Material Master**: `/api/docs/modules/setup/raw-materials/` (Material Data)
- **Warehouse Setup**: `/api/docs/modules/setup/warehouses/` (Delivery Locations)
