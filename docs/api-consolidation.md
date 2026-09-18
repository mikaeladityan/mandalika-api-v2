# API Consolidation

## Export Import

`GET /api/app/consolidation/export?type=impor`

Auth: sesi aplikasi. Query opsional: `month`, `year`, `product_status`, `selectedIds`, `visibleColumns`, dan `columnOrder`. Response: CSV UTF-8 berisi harga satuan dan total harga IDR serta USD. Nilai USD adalah estimasi `IDR / 18000` (kurs tetap Rp18.000 per USD); nilai IDR berasal dari harga supplier material. Hanya Work Order `DRAFT` dan `ACC` yang diekspor.

Query tidak valid mengembalikan 400. Sesi tanpa akses mengembalikan 401/403. Kegagalan server mengembalikan 500.
