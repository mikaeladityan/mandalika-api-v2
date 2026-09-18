# API Consolidation

## Export Import

`GET /api/app/consolidation/export?type=impor`

Auth: sesi aplikasi. Query opsional: `month`, `year`, `product_status`, `selectedIds`, `visibleColumns`, dan `columnOrder`. Response: CSV UTF-8 berisi harga satuan dan total harga IDR serta USD. Untuk `type=impor`, harga supplier yang tersimpan dianggap IDR berbasis kurs lama Rp17.000 per USD. Estimasi IDR dihitung `harga_tersimpan × 18000 / 17000`, lalu estimasi USD `estimasi_IDR / 18000`. Kurs berlaku hanya untuk estimasi Consolidation, tanpa mengubah master harga supplier atau PO. Hanya Work Order `DRAFT` dan `ACC` yang diekspor.

Query tidak valid mengembalikan 400. Sesi tanpa akses mengembalikan 401/403. Kegagalan server mengembalikan 500.
