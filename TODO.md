# TODO

- [x] Samakan filter kategori Consolidation dengan Rekomendasi berbasis supplier preferred terpilih; verifikasi tidak ada material yang muncul di Lokal dan Impor sekaligus.
- [ ] Bersihkan data `supplier_materials` dengan lebih dari satu `is_preferred` per raw material (316 RM, 204 di antaranya LOCAL+IMPORT) dan tambahkan partial unique index penjaga.
- [ ] Perbaiki COUNT daftar Rekomendasi `type=lokal` yang memakai join preferred tanpa LATERAL sehingga `len` tidak cocok dengan jumlah baris.

- [x] Perbaiki Bulk Horizon yang melewatkan material Local/Import dengan beberapa preferred supplier; verifikasi SQL simpan/update Total Need dan isolasi periode.

- [x] Samakan kategori supplier bulk reset dengan daftar; buktikan isolasi bulan/tahun dan penghapusan quantity/horizon melalui tabel TEMP PostgreSQL.

- [x] Tambah bulk reset Work Order FFO/FP Import/FP Local sesuai filter bulan/tahun dan kategori, dengan preview/konfirmasi.
- [ ] Tuntaskan quality gates penuh bulk reset; full suite API dan konfigurasi lint App masih gagal.

- [x] Tambah total Safety Stock Outlet 80% ke response dan export Forecast Master.
- [ ] Verifikasi browser kolom Safety Stock Outlet setelah dependency App dipulihkan; gate Forecast stock allocation masih gagal.

- [x] Susun spesifikasi dan rencana Forecast Safety Stock berdasarkan penjualan Outlet ERP.
- [x] Implementasikan endpoint Forecast Safety Stock sesuai spesifikasi.
- [ ] Verifikasi penuh Forecast Safety Stock pada database lokal dan browser production-like; koneksi database lokal dan dependency App masih blocked.

- [ ] Verifikasi penuh revaluasi estimasi Rp FP Import dari basis 17.000 ke 18.000; seluruh harga Import diasumsikan memakai basis lama sampai ada mata uang per material.

- [ ] Verifikasi gate penuh perubahan kurs tetap Consolidation Import ke Rp18.000 per USD; tes terkait lulus, full suite dan build App belum hijau.

- [ ] Verifikasi penuh penyembunyian bulan dan nilai PO OPEN nol pada Rekomendasi FFO/FP Import/FP Local; gate App belum hijau.
- [ ] Verifikasi penuh filter RM tanpa BOM FG aktif pada daftar dan Bulk Save Rekomendasi General; full suite API belum hijau.

- [x] Pisahkan Work Order General dan FG Discontinue berdasarkan `product_status`.
- [x] Tambah filter sumber FFO, FP Import, FP Local pada rekomendasi Discontinue.
- [x] Perbaiki filter Consolidation berdasarkan scope Work Order.
- [x] Buat module/page khusus agregasi kebutuhan FG Discontinue per RM shared.
- [x] Tampilkan breakdown kontribusi setiap FG pada page Rekomendasi RM Discontinue.
- [x] Arahkan Bulk Horizon page RM Discontinue ke Work Order agregat per RM.
- [x] Hapus informasi FG dari export CSV page material.
- [x] Gabungkan quantity Work Order General DRAFT/ACC ke Consolidation Discontinue DRAFT/ACC untuk RM dan periode sama.

- [x] Perbaiki tiga bug kalkulasi Recommendation sebelum snapshot lock produksi pertama.
- [x] Tambah Recommendation Period Lock berversi untuk General, Discontinue FG × RM, dan Discontinue Material.
- [x] Dokumen terkait: [spec Lock](docs/superpowers/specs/2026-09-19-recommendation-period-lock-design.md), [plan Lock](docs/superpowers/plans/2026-09-19-recommendation-period-lock.md), [spec bug kalkulasi](docs/superpowers/specs/2026-09-19-recommendation-calc-bugs-design.md), dan [plan bug kalkulasi](docs/superpowers/plans/2026-09-19-recommendation-calc-bugs.md).
- [ ] Verifikasi bypass endpoint RFQ/PO generik pada PO `DRAFT`/`SUBMITTED` saat periode terkunci bila ditemukan di lapangan.
