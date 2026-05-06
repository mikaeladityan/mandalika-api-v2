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
- **Automated**: When a `MaterialPurchaseDraft` (Consolidation) is set to `APPROVED`, the system pulls the approved raw materials and creates RFQ records.
  - Only approved items from Consolidation are pulled.
  - Data is automatically organized per raw material.
- **Manual**: Users can create RFQs independently without relying on Consolidation data.
  - Useful for one-off purchases or items not tracked by the Consolidation engine.

### 4.2. RFQ Management - Supplier-Based Organization
- **Primary View**: List of raw materials pulled from Consolidation.
- **Supplier Selection & Grouping**:
  - For each raw material, users can select existing suppliers or add new suppliers manually.
  - Each raw material + supplier combination is tracked separately.
  - Users can view/manage suppliers grouped by raw material.
- **Line Item Fields**: Raw Material, Quantity, Unit Price (Quoted), Supplier, Notes, Status.
- **Supplier Modes**: Support both existing Suppliers (fetch from master) and "New Suppliers" (manual entry).

### 4.3. Workflow Statuses (Per Supplier)
- `DRAFT`: Initial state, editable.
- `SENT`: Request sent to the supplier (optional status).
- `RECEIVED`: Quote received from supplier (optional status).
- `FIX`: Quotation finalized, ready for approval.
- `APPROVED`: Quote approved by manager, ready to publish to PO.
- `CONVERTED`: Items published to Purchase Order.
- `CANCELLED`: RFQ discarded.

### 4.4. Conversion to PO
- An `APPROVED` RFQ (per supplier) can be published/converted into a Purchase Order.
- The system carries over: raw materials, quantities, unit prices, supplier details.
- This creates a link between RFQ and the resulting PO for audit trail.

## 5. Non-Functional Requirements
- **Data Integrity**: Ensure `raw_mat_id` and `supplier_id` are valid.
- **Performance**: Listing RFQs should be efficient even with large datasets.
- **Security**: Only authorized roles (Purchasing/Admin) can approve or convert RFQs.
