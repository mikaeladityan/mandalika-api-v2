# BARDAT Cycle

## GET `/api/app/outlets/bardat/cycle`

Memerlukan autentikasi aplikasi. Query wajib: `month` (1–12) dan `year` (2000–2100).

Respons sukses memakai pembungkus standar API. `data` memuat `outlets`, `rules`, `entries`, `latest_period`, `recommendation_until`, dan `pattern_weekdays`. `pattern_weekdays` adalah objek dengan ID toko sebagai kunci dan daftar nomor hari (`0` Minggu sampai `6` Sabtu) sebagai nilai. Pola dihitung dari seluruh tanggal realisasi BARDAT dengan kuantitas positif per toko: minimal tiga kejadian dan frekuensi minimal 60% dari peluang hari tersebut antara realisasi pertama dan terakhir. Duplikat SKU pada tanggal sama dihitung sekali. Pola ini tidak bergantung pada `month`/`year`; `entries` tetap mengikuti bulan yang diminta.

Contoh: `"pattern_weekdays": { "123": [1, 4] }` berarti rekomendasi Senin dan Kamis untuk toko 123. Toko tanpa pola tidak memiliki entri pada objek tersebut.

Query tidak valid menghasilkan HTTP 400. Permintaan tanpa autentikasi mengikuti respons error autentikasi standar aplikasi.
