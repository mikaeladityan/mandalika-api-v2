# API Recomendation-v2

## Recommendation General

`GET /api/app/recomendations-v2?product_status=ACTIVE&type=ffo|impor|lokal`

Auth: session aplikasi. Query `month`, `year`, `po_months`, `page`, `take`, dan `search` opsional. Response berisi `data`, `len`, serta `periods.po_periods`. Setiap RM di `data` harus mempunyai recipe aktif yang terhubung ke FG `ACTIVE` yang belum dihapus. RM yang hanya dipakai FG Discontinue tidak tampil. `periods.po_periods` hanya memuat bulan dengan sisa PO `ORDERED` positif sampai batas `po_months` ke depan; `open_pos` berisi sisa per bulan. Baris hanya menampilkan bulan dengan sisa positif.

`POST /api/app/recomendations-v2/bulk-horizon` memakai body `month`, `year`, `horizon`, `type`, dan `product_status` opsional. Auth: session aplikasi. Untuk General, hanya RM dengan recipe aktif ke FG `ACTIVE` yang dibuat atau diperbarui sebagai draft. Validasi query/body mengembalikan 400; sesi tanpa akses mengembalikan 401/403; kegagalan server mengembalikan 500.

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
- Scope: bulan DAN tahun persis, kategori material/preferred supplier seperti Bulk Save, `product_status=ACTIVE`, status `DRAFT`/`ACC`. Termasuk hidden dan seluruh halaman; tidak dibatasi pencarian/pilihan baris/horizon. Status lain dan Discontinue tidak dihapus. Tidak menghapus PO atau override kebutuhan.
- Errors: 400 body tidak valid; 401/403 akses/CSRF ditolak; 500 kegagalan database. Satu statement DELETE bersifat atomik, tanpa penghapusan parsial.
- UI menampilkan periode, kategori, jumlah order, dan konfirmasi sebelum reset; scope dikunci saat dialog dibuka.
