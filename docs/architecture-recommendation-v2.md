# Decision: Work Order Recommendation Scope

`material_purchase_drafts` memakai `product_status` sebagai scope Work Order:

- `ACTIVE`: Work Order General.
- `PENDING`: Work Order FG Discontinue.

Unique key menjadi `raw_mat_id + month + year + product_status`. Ini menjaga dua Work Order berbeda untuk RM dan periode sama tanpa membuat tabel atau flow purchasing baru.

Consolidation memfilter kolom scope langsung dari draft. Recipe hanya menentukan kebutuhan, bukan identitas Work Order.

Recommendation Period Lock menyimpan snapshot row untuk satu bulan/tahun dan seluruh scope. Read path memilih snapshot lock aktif sebelum kalkulasi live; mutation yang mengubah angka rekomendasi memanggil `assertPeriodUnlocked`. Snapshot menyimpan kolom filter/sort SQL dan payload JSON, sehingga perubahan resep, issuance, stok, supplier, MOQ, atau horizon tidak mengubah periode yang sudah dikunci. Lock `RELEASED` tetap menjadi riwayat versi.
