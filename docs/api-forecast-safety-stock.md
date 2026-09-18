# Forecast Safety Stock API

Read-only endpoint untuk simulasi safety stock Finished Goods berdasarkan `outlet_issuances`. Endpoint memakai auth Forecast existing.

## Detail

`GET /api/app/forecasts/safety-stock`

Query wajib: `month` (1–12), `year` (1900–9999). Query opsional: `service_level` (80, 85, 90, 95, 97.5, 98, 99, 99.5, 99.9; default 80), `outlet_id`, `product_id`, `page` (default 1), `take` (default 50, maksimum 100), `sortBy`, `order` (`asc`/`desc`). Periode selalu tanggal 1–28; tanggal 29–31 diabaikan.

Respons `data` berisi baris outlet × FG: empat total mingguan, total penjualan, rata-rata mingguan, SD sampel, faktor Z, safety stock integer hasil `CEIL(SD × Z)`, durasi buffer minggu, dan `has_data`. Produk `ACTIVE` diurutkan sebelum `PENDING` (Discontinue) sebelum pagination.

## Ringkasan

`GET /api/app/forecasts/safety-stock/summary`

Query sama, kecuali `outlet_id` diabaikan. Respons menjumlahkan seluruh outlet. Safety stock adalah jumlah hasil pembulatan per outlet × FG, bukan pembulatan hasil gabungan.

Envelope sukses: `{ query, status: "success", data }`. Validasi query mengembalikan 400. Auth mengikuti middleware aplikasi. Database tidak tersedia mengembalikan HTTP 503 dengan pesan `Database belum dapat dihubungi. Periksa koneksi database lalu coba lagi.`; error lain mengikuti envelope error 500 existing.

Target layanan hanya parameter simulasi. Lead time, stok aktual, BARDAT, dan tabel `Product.z_value` tidak digunakan. Pilihan target layanan disimpan di browser App melalui localStorage; API tetap stateless.
