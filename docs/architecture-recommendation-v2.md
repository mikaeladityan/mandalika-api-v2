# Decision: Work Order Recommendation Scope

`material_purchase_drafts` memakai `product_status` sebagai scope Work Order:

- `ACTIVE`: Work Order General.
- `PENDING`: Work Order FG Discontinue.

Unique key menjadi `raw_mat_id + month + year + product_status`. Ini menjaga dua Work Order berbeda untuk RM dan periode sama tanpa membuat tabel atau flow purchasing baru.

Consolidation memfilter kolom scope langsung dari draft. Recipe hanya menentukan kebutuhan, bukan identitas Work Order.
