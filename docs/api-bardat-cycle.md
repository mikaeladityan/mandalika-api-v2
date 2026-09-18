# BARDAT Cycle

## GET `/api/app/outlets/bardat/cycle`

Memerlukan autentikasi aplikasi. Query wajib: `month` (1–12) dan `year` (2000–2100).

Respons sukses memakai pembungkus standar API. `data` memuat `outlets`, `rules`, `entries`, `latest_period`, `recommendation_until`, `pattern_weekdays`, dan `weekday_patterns`. `weekday_patterns` memuat setiap hari yang pernah memiliki BARDAT beserta `occurrences`, jumlah `opportunities` berupa pekan aktif, `percentage`, dan `level`. Level `CONSISTENT` memerlukan minimal tiga kejadian dan 60%; `MODERATE` minimal dua kejadian dan 30%; sisanya `SPORADIC`. Pekan kalender tanpa pengiriman tidak menurunkan frekuensi. Duplikat SKU pada tanggal sama dihitung sekali. Pola dihitung dari seluruh bulan dan tidak bergantung pada `month`/`year`; `entries` tetap mengikuti bulan yang diminta. `pattern_weekdays` tetap berisi nomor hari level `CONSISTENT` untuk kompatibilitas.

Contoh: `"weekday_patterns": { "123": [{ "weekday": 1, "occurrences": 8, "opportunities": 10, "percentage": 80, "level": "CONSISTENT" }] }`. Toko tanpa data BARDAT tidak memiliki entri pada objek tersebut.

Query tidak valid menghasilkan HTTP 400. Permintaan tanpa autentikasi mengikuti respons error autentikasi standar aplikasi.
