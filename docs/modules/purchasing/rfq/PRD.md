# Product Requirements Document (PRD): Request for Quotation (RFQ)

## 1. Background
Currently, approved recommendations from the Consolidation module directly create an **Open PO**. However, the standard procurement process requires an intermediate stage where the purchasing department requests price quotations from vendors before committing to a purchase order. This ensures better price negotiation and vendor selection.

## 2. Objectives
- Implement a Request for Quotation (RFQ) module as the primary stage after Consolidation Approval.
- Support both automated RFQ creation (from Consolidation) and manual RFQ creation.
- Track the lifecycle of an RFQ from Draft to Conversion into a Purchase Order.
- Maintain a clean audit trail between Recommendations, RFQs, and POs.

## 3. User Stories
- **As a Purchasing Staff**, I want to see approved material recommendations in the RFQ list so I can send them to vendors.
- **As a Purchasing Staff**, I want to manually create an RFQ for items not tracked by the recommendation engine.
- **As a Purchasing Manager**, I want to review and approve RFQs before they are converted into POs.
- **As a System**, I want to link the final PO back to the originating RFQ and Consolidation record.

## 4. Functional Requirements

### 4.1. RFQ Creation
- **Automated**: When a `MaterialPurchaseDraft` (Consolidation) is set to `APPROVED`, the system creates an RFQ record.
- **Manual**: Users can click "+ Create RFQ" and manually add items (Raw Materials) and specify a Vendor (Supplier).

### 4.2. RFQ Management
- **Fields**: RFQ Number, Date, Vendor, Target Location, Notes, Status.
- **Line Items**: Raw Material, Quantity, Unit Price (Estimated/Quoted), Notes.
- **Vendor Modes**: Support both existing Suppliers and "New Vendors" (placeholder for one-time vendors).

### 4.3. Workflow Statuses
- `DRAFT`: Newly created, still editable.
- `SENT`: Request sent to the vendor (waiting for quote).
- `RECEIVED`: Quote received from the vendor (prices updated).
- `APPROVED`: Quote accepted by the manager.
- `PARTIAL_CONVERTED`: Some items from the RFQ have been converted to PO.
- `CONVERTED`: All items from the RFQ have been successfully turned into Purchase Orders.
- `CANCELLED`: RFQ discarded.

### 4.4. Conversion to PO
- An `APPROVED` RFQ can be converted into a `RawMaterialOpenPo`.
- The system should carry over the vendor, items, quantities, and negotiated prices.

## 5. Non-Functional Requirements
- **Data Integrity**: Ensure `raw_mat_id` and `supplier_id` are valid.
- **Performance**: Listing RFQs should be efficient even with large datasets.
- **Security**: Only authorized roles (Purchasing/Admin) can approve or convert RFQs.
