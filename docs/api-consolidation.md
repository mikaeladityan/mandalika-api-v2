# API Consolidation

## Export Import

`GET /api/app/consolidation/export?type=impor`

Auth: sesi aplikasi. Query opsional: `month`, `year`, `product_status`, `selectedIds`, `visibleColumns`, dan `columnOrder`. Response: CSV UTF-8 berisi harga satuan dan total harga IDR serta USD. Untuk `type=impor`, harga supplier yang tersimpan dianggap IDR berbasis kurs lama Rp17.000 per USD. Estimasi IDR dihitung `harga_tersimpan × 18000 / 17000`, lalu estimasi USD `estimasi_IDR / 18000`. Kurs berlaku hanya untuk estimasi Consolidation, tanpa mengubah master harga supplier atau PO. Hanya Work Order `DRAFT` dan `ACC` yang diekspor.

Query tidak valid mengembalikan 400. Sesi tanpa akses mengembalikan 401/403. Kegagalan server mengembalikan 500.

## Filter Kategori (type)

`GET /api/app/consolidation?type=ffo|lokal|impor|tester`

Kategori ditentukan dari **supplier preferred terpilih**, yaitu baris `supplier_materials` dengan `is_preferred = true` dan `supplier_id` terkecil — aturan yang sama dengan daftar Rekomendasi (`recomendation-v2`). Satu raw material hanya bisa masuk `lokal` atau `impor`, tidak keduanya.

Sebelumnya Consolidation memakai `supplier_materials.some(supplier.source)`, sehingga raw material dengan supplier LOCAL sekaligus IMPORT muncul di kedua kategori. Nama supplier, harga, dan MOQ pada baris juga diambil dari preferred terpilih yang sama.

`ffo` memakai slug kategori raw material, `tester` memakai prefix barcode `KTL-`, `KTP-`, `KA-`, `KTB-`; keduanya tidak melihat supplier. `lokal` dan `impor` mengecualikan kategori FFO dan barcode tester.

