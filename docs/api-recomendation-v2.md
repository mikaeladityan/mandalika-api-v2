# API Recomendation-v2

## Recommendation General

`GET /api/app/recomendations-v2?product_status=ACTIVE&type=ffo|impor|lokal`

Auth: session aplikasi. Query `month`, `year`, `po_months`, `page`, `take`, dan `search` opsional. Response berisi `data`, `len`, serta `periods.po_periods`. Setiap RM di `data` harus mempunyai recipe aktif yang terhubung ke FG `ACTIVE` yang belum dihapus. RM yang hanya dipakai FG Discontinue tidak tampil. `periods.po_periods` hanya memuat bulan dengan sisa PO `ORDERED` positif sampai batas `po_months` ke depan; `open_pos` berisi sisa per bulan. Baris hanya menampilkan bulan dengan sisa positif.

Saat periode memiliki lock aktif, endpoint list/export dan endpoint Discontinue Material membaca snapshot periode. Response menambah `lock`: `{ locked, version, locked_at, locked_by, note }`; saat belum pernah dikunci response `{ locked: false }`, dan setelah pernah dibuka dapat menyertakan `last_version`. Filter dan lima opsi sort tetap dilayani dari kolom snapshot SQL.

### Lock Periode Rekomendasi

`POST /api/app/recomendations-v2/lock`

Auth: session aplikasi + CSRF. Body `{ "month": 9, "year": 2026, "note": "Tutup periode" }`. Validasi bulan 1–12, tahun 2000–9999, catatan maksimal 255 karakter. Endpoint membekukan General, Discontinue FG × RM, dan Discontinue Material. Lock aktif kedua mengembalikan HTTP 409 dengan `error: PERIOD_LOCKED` dan `details.code: PERIOD_LOCKED`.

`POST /api/app/recomendations-v2/unlock` menerima `{ "month": 9, "year": 2026 }`; header menjadi `RELEASED`, row snapshot dan nomor versi tetap tersimpan.

`GET /api/app/recomendations-v2/locks?month=9&year=2026` mengembalikan riwayat versi, status, actor, waktu, catatan, dan jumlah row.

Saat lock aktif, mutation Work Order, Bulk Horizon, Bulk Reset, Need Override, Open PO dari rekomendasi, anchor Discontinue, dan Bulk Save Discontinue Material mengembalikan 409. Bulk Reset preview, approve, MOQ, hide, consolidation status/hide, serta alur RFQ/PO tetap tersedia. Open PO update/delete hanya digate untuk PO `DRAFT`/`SUBMITTED`; periode diambil dari `po_date`.

`POST /api/app/recomendations-v2/bulk-horizon` memakai body `month`, `year`, `horizon`, `type`, dan `product_status` opsional. Auth: session aplikasi. Untuk General, hanya RM dengan recipe aktif ke FG `ACTIVE` yang dibuat atau diperbarui sebagai draft. Validasi query/body mengembalikan 400; sesi tanpa akses mengembalikan 401/403; kegagalan server mengembalikan 500.

Bulk Horizon memilih kategori supplier sama dengan daftar/reset (`supplier_id` terkecil jika beberapa preferred). Response `data` berupa jumlah draft yang dibuat/diperbarui. `0` berarti tidak ada draft tersimpan; UI menampilkan peringatan. Update hanya untuk status DRAFT tanpa `open_po_id`; quantity Work Order yang sudah diisi tetap dipertahankan. Bulan/tahun/horizon dan kategori berasal dari filter aktif. UI menunggu refresh daftar sebelum menampilkan jumlah tersimpan.

## Work Order

`POST /api/app/recomendations-v2/order`

Body utama:

- `raw_mat_id`: ID raw material.
- `month`, `year`: periode Work Order.
- `product_status`: `ACTIVE` untuk General atau `PENDING` untuk FG Discontinue.
- `quantity`, `horizon`, dan metadata kebutuhan.

`ACTIVE` dan `PENDING` boleh memiliki raw material serta periode sama. Keduanya menjadi Work Order terpisah.

## Recommendation Discontinue

`GET /api/app/recomendations-v2?product_status=PENDING`

Query `type` opsional:

- `ffo`
- `impor` — FP Import
- `lokal` — FP Local

Endpoint existing tetap mengembalikan list per FG × RM untuk pengaturan anchor dan analisis loss.

## Recommendation Material Discontinue

`GET /api/app/recomendations-v2/discontinue/materials`

`GET /api/app/recomendations-v2/discontinue/materials/export`

`POST /api/app/recomendations-v2/discontinue/materials/bulk`

Body bulk Work Order:

- `month`, `year`: periode Work Order.
- `horizon`: horizon rekomendasi, 1 sampai 12.
- `type`: opsional `ffo`, `impor`, `lokal`, atau `tester`.

Page: `/recomendation-v2/discontinue/material`

Response satu baris per raw material. Jika satu RM dipakai beberapa FG,
`discontinue_breakdown` berisi kontribusi kebutuhan tiap FG. Total kebutuhan diagregasi
lebih dulu, lalu current stock dan Open PO dikurangi satu kali.

Query `type` menerima `ffo`, `impor`, dan `lokal`. Bulk Work Order menyimpan satu draft
`PENDING` per RM dengan quantity hasil agregasi. Baris rekomendasi nol dan Work Order `ACC`
tidak ditimpa.

## Consolidation

`GET /api/app/consolidation?product_status=PENDING`

`product_status=PENDING` hanya mengembalikan row Work Order FG Discontinue. Untuk row
Discontinue berstatus `DRAFT` atau `ACC`, quantity ditambah dengan Work Order General
(`ACTIVE`) berstatus `DRAFT` atau `ACC` pada RM, bulan, dan tahun sama. ID serta status row
tetap milik Work Order Discontinue. `product_status=ACTIVE` tetap hanya mengembalikan Work
Order General.

## Bulk reset Work Order General

- `POST /api/app/recomendations-v2/bulk-reset/preview`: hitung order yang dapat direset, tanpa mutasi.
- `POST /api/app/recomendations-v2/bulk-reset`: hapus order dalam satu operasi database.
- Auth: session aplikasi dan CSRF mengikuti middleware aplikasi.
- Body wajib: `{ "month": 9, "year": 2026, "type": "ffo" }`. Bulan integer 1–12, tahun integer 2000–9999; type `ffo`, `impor`, atau `lokal`. Parameter tambahan ditolak.
- Response sukses: standard success envelope dengan `data: { "count": 3 }`; nol jika tidak ada order cocok. Preview bersifat informatif; count reset mencerminkan jumlah aktual saat eksekusi.
- Scope: bulan DAN tahun persis, kategori material/preferred supplier seperti daftar Rekomendasi (`supplier_id` terkecil jika data legacy mempunyai beberapa preferred supplier), `product_status=ACTIVE`, status `DRAFT`/`ACC`. Termasuk hidden dan seluruh halaman; tidak dibatasi pencarian/pilihan baris/horizon. Status lain dan Discontinue tidak dihapus. Tidak menghapus PO atau override kebutuhan.
- Penghapusan draft mereset quantity Work Order sekaligus horizon/Total Need hasil Bulk Save. Setelah refresh, Total Need menampilkan `Belum disimpan` hingga horizon disimpan lagi; forecast sumber tetap tersedia.
- Errors: 400 body tidak valid; 401/403 akses/CSRF ditolak; 500 kegagalan database. Satu statement DELETE bersifat atomik, tanpa penghapusan parsial.
- UI menampilkan periode, kategori, jumlah order, dan konfirmasi sebelum reset; scope dikunci saat dialog dibuka.
