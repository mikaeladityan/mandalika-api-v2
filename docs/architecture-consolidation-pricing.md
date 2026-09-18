# Estimasi harga Consolidation FP Import

`supplier_materials.unit_price` tidak menyimpan mata uang atau kurs asal. Berdasarkan aturan bisnis saat ini, harga seluruh material FP Import dianggap sudah disimpan dalam IDR hasil konversi USD pada kurs Rp17.000 per USD.

Consolidation `type=impor` menghitung estimasi IDR dengan `unit_price × 18000 / 17000`. Nilai USD adalah estimasi IDR dibagi 18.000, sehingga harga USD asal tetap. Daftar, ringkasan supplier, dan export memakai perhitungan sama. Jenis Consolidation lain memakai harga tersimpan tanpa revaluasi.

Perhitungan ini hanya untuk estimasi Consolidation. Master harga supplier, RFQ, dan PO tidak diubah. Jika sebagian harga Import ternyata berdenominasi IDR asli atau memakai kurs dasar lain, baris tersebut perlu metadata mata uang dan harga asal sebelum rumus ini dipakai untuk keputusan pembelian.

## Supplier Preferred Terpilih

Raw material boleh punya beberapa `supplier_materials` dengan `is_preferred = true` karena tidak ada constraint yang mencegahnya. Supplier terpilih didefinisikan sebagai preferred dengan `supplier_id` terkecil.

Definisi itu tinggal di `src/module/application/shared/material-type-scope.ts` dan dipakai daftar Rekomendasi maupun Consolidation. Consolidation menyelesaikan scope lebih dulu menjadi daftar `raw_mat_id` lewat satu query, karena Prisma tidak bisa menyatakan "preferred dengan supplier_id terkecil" secara deklaratif.

