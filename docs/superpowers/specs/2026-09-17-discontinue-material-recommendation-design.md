# FG Discontinue Material Recommendation

## Goal

Sediakan module dan page baru untuk rekomendasi pembelian raw material FG Discontinue tanpa mengubah list FG Discontinue existing. Jika satu raw material dipakai beberapa FG Discontinue, semua kebutuhan digabung sebelum pengurangan stok dan Open PO.

## Scope

- Page existing `/recomendation-v2/discontinue` tetap memakai list FG × RM untuk anchor dan analisis loss.
- Page baru `/recomendation-v2/discontinue/material` memakai satu row per raw material.
- Endpoint baru `GET /api/app/recomendations/discontinue/materials` melayani page agregat.
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
6. Return satu row per RM dari endpoint khusus dengan `finished_goods`/breakdown sebagai audit detail.
7. Save Work Order menggunakan key existing dengan `product_status = PENDING`.

`discontinue_breakdown` memuat `product_id`, `fg_code`, `fg_name`, `contribution_quantity`,
`anchor_material_id`, dan `anchor_material_name` untuk audit kebutuhan per FG.

## API contract

Endpoint existing Recommendation-v2 tidak mengubah shape atau pagination list FG Discontinue.

Endpoint material Discontinue mengembalikan breakdown per RM. Breakdown minimal memuat FG ID, FG code/name, anchor material, gross need, dan contribution quantity.

Query `type` memakai nilai existing:

- `ffo`
- `impor`
- `lokal`
- omitted untuk Semua

## UI behavior

Page `/recomendation-v2/discontinue/material` memakai layout/fitur tabel General: search, period filter, source filter, sort, export, print, Work Order, hide/unhide, dan bulk horizon bila relevan. Row RM menampilkan breakdown FG melalui detail UI.

Layout Discontinue menambah navigasi `Rekomendasi RM`. Page existing tetap menjadi tempat pengaturan anchor dan analisis per FG.

## Module boundary

Backend mengikuti urutan `schema.ts` → `services.ts` → `controller.ts` → `routes.ts` → registration. Service material Discontinue memiliki query dan kalkulasi sendiri; `RecomendationV2Service.list()` tidak melakukan agregasi RM Discontinue.

## Consolidation

Consolidation memakai `product_status = PENDING` sebagai filter sumber draft. Recipe tidak dipakai untuk menentukan apakah draft berasal dari Discontinue.

## Testing

- Shared RM dari beberapa FG menjadi satu recommendation row.
- Stock/Open PO dikurangi satu kali setelah aggregation.
- Filter FFO/Import/Local tidak mencampur source.
- Breakdown tetap memuat semua FG penyumbang.
- Work Order PENDING terpisah dari ACTIVE.
- Consolidation hanya menampilkan draft PENDING.
