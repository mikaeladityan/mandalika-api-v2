# Forecast Safety Stock — Design

Status: desain percakapan disetujui 18 September 2026; dokumen siap review, implementasi belum dimulai.

## Tujuan dan cakupan

Tambahkan Forecast → Safety Stock pada `/forecasts/safety-stock`. Hitung buffer FG langsung dari `OutletIssuance` ERP ketika filter berubah, tanpa snapshot atau perubahan stok. Acuan bisnis: Google Sheets `1WkiBqtvqfWdoL9Y5x4luue5ZJK2019RmcODBm2Cw8ng`, tab Safety Stock `gid=929426385` dan Ringkasan Safety Stock `gid=929426386`.

Tidak ada integrasi Google, migrasi DB, keputusan pengiriman, export, atau perubahan mesin Forecast existing pada versi ini.

## Keputusan bisnis

- Filter bulan/tahun, outlet, produk. Tanggal awal dikunci tanggal 1; empat minggu selalu 1–7, 8–14, 15–21, 22–28. Tanggal 29–31 tidak dihitung, termasuk Februari kabisat.
- Default periode bulan/tahun saat halaman dibuka, outlet dan produk Semua. Bulan yang belum lengkap tetap boleh dibuka, dengan keterangan periode belum selesai.
- Detail Outlet menampilkan satu baris per outlet × FG. Pilihan Semua tidak menggabungkan variasi antar-outlet.
- Ringkasan Produk selalu menghitung seluruh outlet, mengikuti bulan/tahun, produk, dan target layanan. Filter outlet dinonaktifkan pada tab ini dan cakupan Semua outlet ditulis jelas.
- Produk tidak dihapus dengan status ACTIVE dan PENDING ditampilkan; konvensi repo memetakan PENDING menjadi Discontinue. ACTIVE selalu mendahului Discontinue, bahkan ketika sort numerik menurun. Status diurutkan sebelum pagination. Dalam kelompok, default kode produk lalu kode outlet naik; tie-break ID stabil.
- Discontinue dihitung dengan rumus yang sama, diberi badge Discontinue dan background merah muda pada kedua tab, dengan kontras terang/gelap yang terbaca.
- Gunakan master outlet dan produk sebagai pasangan dasar sehingga pasangan tanpa transaksi periode terpilih tetap terlihat. Jangan membatasi daftar hanya pada pasangan yang memiliki penjualan.
- Tidak ada catatan dianggap nol dalam agregasi, tetapi `has_data=false` diberi label Belum ada data penjualan. Catatan quantity nol tetap `has_data=true`. Data negatif yang sudah tersimpan dipertahankan; fitur ini tidak mengubah validasi input penjualan existing.

## Target layanan dan persistensi

Label: Target Layanan (%). Pilihan global berlaku pada kedua tab. Default 80%; angka konversi Z tampil di setiap opsi dan hasil. Nilai layanan berbeda dari faktor Z.

| Layanan | Faktor Z untuk perhitungan |
| --- | --- |
| 80% | 0.8416212335729143 |
| 85% | 1.0364333894937898 |
| 90% | 1.2815515655446004 |
| 95% | 1.6448536269514722 |
| 97.5% | 1.959963984540054 |
| 98% | 2.0537489106318225 |
| 99% | 2.3263478740408408 |
| 99.5% | 2.5758293035489004 |
| 99.9% | 3.090232306167813 |

Simpan persentase sebagai angka JSON pada `localStorage` key `forecast.safety-stock.service-level.v1`. Baca setelah client mount sebelum query pertama. Simpan saat pengguna memilih; refresh dan pembukaan ulang browser memulihkan pilihan. Nilai invalid atau tidak tersedia kembali ke 80. Kegagalan storage tidak menghalangi halaman; pilihan tetap bekerja dalam memori. Jangan menulis default sebelum nilai lama terbaca. Penyimpanan berlaku per browser/origin, bukan lintas perangkat.

Backend memvalidasi pilihan dan menentukan faktor dari tabel; tidak menerima faktor Z bebas. `Product.z_value`, lead_time dan tabel SafetyStock existing tidak dibaca/diubah untuk fitur ini.

## Rumus dan respons

Untuk empat total mingguan `w = [w1,w2,w3,w4]`:

```ts
const total_sales = w.reduce((sum, value) => sum + value, 0);
const weekly_average = total_sales / 4;
const standard_deviation = Math.sqrt(
  w.reduce((sum, value) => sum + (value - weekly_average) ** 2, 0) / 3,
);
const safety_stock = Math.ceil(standard_deviation * z_value);
const buffer_weeks = weekly_average > 0 ? safety_stock / weekly_average : null;
```

Ini SD sampel (`STDEV`), bukan populasi. Jangan membulatkan rata-rata, SD, atau Z sebelum CEIL. Nilai nol tetap nol. Rata-rata/SD ditampilkan dua desimal, Z empat desimal, buffer tiga desimal, SS integer.

Ringkasan: `total_sales = SUM(total_sales outlet)`; `safety_stock = SUM(CEIL(SD outlet × Z))`, bukan CEIL jumlah SS mentah atau SD penjualan gabungan. `sales_to_stock_ratio = total_sales / safety_stock` hanya jika keduanya positif; `buffer_percentage = safety_stock / total_sales * 100` hanya jika penjualan positif. Nilai tidak terdefinisi dikirim `null`, ditampilkan `—`.

Contoh PMS `[11,9,15,10]`, layanan 80%: rata-rata 11.25, SD sekitar 2.62996, SS 3, buffer 0.2666667 minggu. Dua outlet dengan data identik tersebut menghasilkan total SS 6.

Catatan halaman: simulasi variasi penjualan mingguan, belum memasukkan lead time atau stok aktual; durasi buffer bukan frekuensi/jumlah kiriman dan target layanan bukan jaminan layanan aktual.

## API dan arsitektur

Module `api/src/module/application/forecast/safety-stock/`: `schema.ts` → `services.ts` → `controller.ts` → `routes.ts`, lalu registrasi di `forecast.routes.ts` sebelum route parameter `/:product_id`. Service hanya DTO/business logic/DB, tanpa Context, status HTTP, atau ApiError HTTP. Gunakan helper `calculation.ts` untuk rumus deterministik.

GET `/api/app/forecasts/safety-stock`: detail.
GET `/api/app/forecasts/safety-stock/summary`: ringkasan seluruh outlet.

Gunakan middleware session/auth Forecast existing dan envelope `ApiResponse.sendSuccess`. Query divalidasi middleware `validate` existing dengan pesan Indonesia; controller parse DTO untuk nilai coercion/default. Tidak ada request body atau endpoint update.

Query bersama: `month` integer 1–12, `year` integer 1900–9999, `service_level` pilihan tabel default 80, `product_id` integer positif opsional, `page` default 1, `take` default 50 maksimum 100, `sortBy` whitelist, `order` asc/desc. Detail menerima `outlet_id` positif opsional; summary mengabaikan filter outlet secara eksplisit. Sort fields: product_code, total_sales, weekly_average, standard_deviation, safety_stock, buffer_weeks pada detail; product_code, total_sales, safety_stock, sales_to_stock_ratio, buffer_percentage pada summary. Null ditempatkan terakhir.

Payload `{data, len, page, take, period_start, period_end, service_level, z_value}`. Detail row memuat outlet_id/code/name, product_id/code/name/status, weeks (tuple empat angka), total_sales, weekly_average, standard_deviation, safety_stock, buffer_weeks, has_data. Summary row memuat product_id/code/name/status, total_sales, safety_stock, sales_to_stock_ratio, buffer_percentage, has_data (ada catatan pada outlet mana pun).

Invalid query → 400; unauthenticated mengikuti auth existing; unexpected error → envelope 500 existing tanpa bocoran internal. Filter ID valid yang tidak menemukan entitas menghasilkan daftar kosong.

Agregasi DB memakai batas tanggal UTC `[tanggal 1, tanggal 29)` pada kolom `@db.Date`, SQL parameterized/Prisma, tanpa N+1. Agregasi seluruh pasangan dilakukan sebelum summary/sort/pagination; jangan hitung ringkasan dari halaman detail saja.

Frontend mengikuti pola Next page + server schema/service/query hooks + komponen halaman di `components/pages/forecast/safety-stock`. Loading, empty, error/retry eksplisit. React Query key mencakup seluruh filter efektif dan target layanan; perubahan filter reset page 1. Query summary tidak menyertakan outlet. Menu ditambah di `app/src/components/layouts/sidebar/config.tsx`.

## Verifikasi dan dokumentasi

Backend TDD: schema, konversi, SD sampel, CEIL per outlet, pembagi nol, tanggal batas/kabisat, pasangan tanpa transaksi vs transaksi nol, data negatif, scope summary, sorting status sebelum pagination, auth/envelope. Frontend logic test untuk storage dan query params; browser membuktikan menu, filter, dua tab, warna, persistensi refresh, Network response dan hasil fixture.

Definition of Done: typecheck, lint/check, seluruh test, build; dokumentasi tugas, API dan changelog terbarui. Kegagalan existing harus dilaporkan terpisah dan tidak dinyatakan lulus. Saat perencanaan: API punya test/build tetapi belum lint script/config; App punya lint/build tetapi belum test runner/script. Rencana eksekusi harus menutup atau melaporkan gap gate ini secara eksplisit.

Tidak ada env baru. `.env.local` existing tidak disentuh/stage. `RTK.md` tidak ditemukan pada workspace, api, app saat inspeksi; jangan mengarang instruksinya.
