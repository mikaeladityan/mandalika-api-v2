# RFQ Workflow Diagram

This document outlines the lifecycle of a Request for Quotation (RFQ) and its integration with the Consolidation and Purchase Order modules.

```mermaid
graph TD
    A[Material Recommendation] -->|Consolidate| B[MaterialPurchaseDraft]
    B -->|Approve| C{Create RFQ?}
    
    C -->|Auto| D[RFQ: DRAFT]
    E[Manual Input] -->|Create| D
    
    D -->|Send to Vendor| F[RFQ: SENT]
    F -->|Receive Quote| G[RFQ: RECEIVED]
    G -->|Manager Review| H{Status?}
    
    H -->|Approve| I[RFQ: APPROVED]
    H -->|Reject/Cancel| J[RFQ: CANCELLED]
    
    I -->|Partial Convert| K[RawMaterialOpenPo]
    I -->|Full Convert| K[RawMaterialOpenPo]
    
    subgraph "Status Tracking"
    K -.->|Partial| I
    end
    K -->|Receive Goods| L[GoodsReceipt]
    
    subgraph "Purchasing Module"
    D
    F
    G
    I
    K
    end
    
    subgraph "Inventory Module"
    A
    B
    L
    end
```

## Step-by-Step Flow

1.  **Consolidation Approval**: When the `MaterialPurchaseDraft` reaches the final approval stage, it triggers the creation of one or more RFQs (grouped by suggested supplier).
2.  **RFQ Drafting**: Purchasing staff reviews the items. They can add manual items or adjust quantities.
3.  **Quotation Request**: The RFQ is moved to `SENT` status (representing an email or document sent to the vendor).
4.  **Price Update**: Once the vendor provides prices, the staff updates the RFQ items and sets the status to `RECEIVED`.
5.  **PO Conversion**: Upon final approval of the quoted prices, the RFQ is converted into an Open PO. This closes the RFQ and creates a link for tracking.
