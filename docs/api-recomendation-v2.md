# API Recomendation-v2

## Work Order

`POST /api/app/recomendations/order`

Body utama:

- `raw_mat_id`: ID raw material.
- `month`, `year`: periode Work Order.
- `product_status`: `ACTIVE` untuk General atau `PENDING` untuk FG Discontinue.
- `quantity`, `horizon`, dan metadata kebutuhan.

`ACTIVE` dan `PENDING` boleh memiliki raw material serta periode sama. Keduanya menjadi Work Order terpisah.

## Recommendation Discontinue

`GET /api/app/recomendations?product_status=PENDING`

Query `type` opsional:

- `ffo`
- `impor` — FP Import
- `lokal` — FP Local

## Consolidation

`GET /api/app/consolidation?product_status=PENDING`

`product_status=PENDING` hanya mengembalikan Work Order FG Discontinue. `product_status=ACTIVE` hanya mengembalikan Work Order General.
