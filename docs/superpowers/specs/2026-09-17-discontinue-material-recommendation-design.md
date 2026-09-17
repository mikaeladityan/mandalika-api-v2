# FG Discontinue Material Recommendation

## Goal

Tampilkan kebutuhan FG Discontinue sebagai satu rekomendasi per raw material. Jika satu raw material dipakai beberapa FG Discontinue, semua kebutuhan digabung sebelum pengurangan stok dan Open PO.

## Scope

- Recomendation-v2 Discontinue memakai satu row per raw material.
- Filter sumber supplier mengikuti General: FFO, FP Import, FP Local, dan Semua.
- Work Order Discontinue tetap memakai flow existing dengan `product_status = PENDING`.
- Work Order General tetap `product_status = ACTIVE`.
- Consolidation Discontinue menampilkan Work Order PENDING hasil agregasi.

## Data flow

1. Load seluruh FG PENDING yang memiliki anchor pada periode.
2. Hitung kebutuhan setiap FG dari recipe FG → RM.
3. Aggregate gross need berdasarkan `material_id`.
4. Resolve current stock dan Open PO satu kali per RM.
5. Hitung recommendation quantity: `max(0, gross_need - stock - open_po)`.
6. Return satu row per RM dengan `finished_goods`/breakdown sebagai audit detail.
7. Save Work Order menggunakan key existing dengan `product_status = PENDING`.

## API contract

Recommendation response menambah breakdown Discontinue per RM. Breakdown minimal memuat FG ID, FG code/name, anchor material, gross need, dan contribution quantity.

Query `type` memakai nilai existing:

- `ffo`
- `impor`
- `lokal`
- omitted untuk Semua

## UI behavior

Page `/recomendation-v2/discontinue` memakai layout/fitur tabel General: search, period filter, source filter, sort, export, print, Work Order, hide/unhide, dan bulk horizon bila relevan. Row RM menampilkan breakdown FG melalui detail UI.

## Consolidation

Consolidation memakai `product_status = PENDING` sebagai filter sumber draft. Recipe tidak dipakai untuk menentukan apakah draft berasal dari Discontinue.

## Testing

- Shared RM dari beberapa FG menjadi satu recommendation row.
- Stock/Open PO dikurangi satu kali setelah aggregation.
- Filter FFO/Import/Local tidak mencampur source.
- Breakdown tetap memuat semua FG penyumbang.
- Work Order PENDING terpisah dari ACTIVE.
- Consolidation hanya menampilkan draft PENDING.
