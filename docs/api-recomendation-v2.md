# API Recomendation-v2

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

`product_status=PENDING` hanya mengembalikan Work Order FG Discontinue. `product_status=ACTIVE` hanya mengembalikan Work Order General.
