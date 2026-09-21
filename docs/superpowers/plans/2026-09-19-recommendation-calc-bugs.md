# Plan: Bug Kalkulasi Rekomendasi

Spec: [[2026-09-19-recommendation-calc-bugs-design]]

Ketiga bug independen, bisa dikerjakan dan di-PR terpisah atau sekaligus. Tidak ada migration.

## Task 1 — Physical stock: exact-month match → last-period-≤-target

**File:** `src/module/application/recomendation-v2/recommendation-stock.ts`

1. Ubah `rawMaterialPhysicalStockSql(materialId, year, month)`: ganti filter `WHERE raw_material_id = ... AND year = ${year} AND month = ${month}` menjadi filter `(year*12+month) <= (${year}*12+${month})`, lalu `DISTINCT ON (warehouse_id)` (atau `ROW_NUMBER() OVER (PARTITION BY warehouse_id ORDER BY year DESC, month DESC, date DESC, updated_at DESC, id DESC)` seperti yang sudah dipakai di fungsi ini, tinggal tambah kondisi `<=`) supaya per warehouse ambil snapshot terakhir sebelum/di bulan target, sama seperti pola `product_stock_agg` di `recomendation-v2.service.ts:223-236`.
2. Cek semua pemanggil `rawMaterialPhysicalStockSql` — pastikan `year`/`month` yang dioper tetap periode target laporan (bukan `resolveInvPeriod` global) kalau memungkinkan; kalau `resolveInvPeriod` memang sengaja dipakai untuk alasan lain, biarkan, cukup filter jadi `<=`.
3. Test: tambah kasus RM dengan baris inventori cuma di bulan N-2, hitung `current_stock` untuk bulan N — harus dapat saldo N-2, bukan 0. Taruh di `src/tests/recomendation-v2.service.test.ts` atau file test `recommendation-stock` kalau ada.
4. `typecheck && test` untuk file yang disentuh.

## Task 2 — `bulkSaveHorizon`: samakan gate size-multiplier dengan `use_size_calc`

**File:** `src/module/application/recomendation-v2/recomendation-v2.service.ts`

1. Baris ~1724 (CTE `fc_agg`) dan ~1763 (CTE `fg_agg`) di dalam `bulkSaveHorizon`: ganti `CASE WHEN rm2.type = 'FO' OR urm2.name ILIKE ANY(ARRAY['ml','l','liter','ML']) THEN COALESCE(ps.size,1) ELSE 1 END` menjadi `CASE WHEN rec.use_size_calc THEN COALESCE(ps.size,1) ELSE 1 END` — cek alias `rec` (tabel recipes) sudah ke-join di CTE itu; kalau belum, join dulu (lihat cara `ss_agg` di fungsi yang sama, baris ~1752, melakukannya).
2. Test: resep `use_size_calc=true` di RM non-FO unit non-ml/l/liter — bandingkan `total_needed`/`stock_fg_x_resep` hasil `bulkSaveHorizon` vs `list()` untuk bulan/horizon sama, harus identik. Tambahkan ke `src/tests/recomendation-v2/bulk-horizon.postgres.test.ts`.
3. `typecheck && test`.

## Task 3 — `discontinue-loss.service.ts`: samakan urutan preferred supplier

**File:** `src/module/application/recomendation-v2/discontinue/discontinue-loss.service.ts`

1. Baris ~69-71: ganti `ORDER BY sm.updated_at DESC, sm.id DESC LIMIT 1` menjadi `ORDER BY sm.supplier_id ASC LIMIT 1`, konsisten dengan `list()`/`bulkResetWorkOrders`/`bulkSaveHorizon` (commit `79d05de`, `fe35ec1`).
2. Opsional tapi disarankan: ekstrak aturan pemilihan preferred supplier (`is_preferred=true ORDER BY supplier_id ASC LIMIT 1`) jadi helper di `shared/material-type-scope.ts` atau file shared lain, dipakai di keempat tempat ini — supaya kalau aturannya berubah lagi, gak perlu diingat manual di banyak file. Kalau scope-nya dianggap kebesaran buat PR bug-fix ini, cukup task 1 dan buat TODO terpisah untuk refactor-nya.
3. Test: RM dengan 2 baris `supplier_materials` preferred beda harga — `discontinue-loss` dan `list()` harus pakai harga dari `supplier_id` yang sama. Tambah ke `src/tests/recomendation-v2/discontinue-loss.service.test.ts`.
4. `typecheck && test`.

## Definition of Done (ikuti SOP di CLAUDE.md)

- [ ] `typecheck` — 0 error di ketiga file yang disentuh + test barunya.
- [ ] `test` — semua pass, termasuk 3 test baru di atas.
- [ ] `build` — sukses.
- [ ] `lint/check` — 0 issue.
- [ ] CHANGELOG — tambah entri Fixed untuk ketiga bug.
- [ ] TODO — tandai 3 item ini selesai kalau sebelumnya sempat dicatat; tambahkan follow-up "refactor preferred-supplier selector jadi shared helper" kalau task 3 poin 2 di-skip.
- [ ] Tidak ada perubahan skema — tidak perlu migration/`.env.example` update.
