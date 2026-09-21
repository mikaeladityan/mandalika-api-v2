# Bug Kalkulasi Rekomendasi — Ditemukan Saat Review Lock Rekomendasi

## Goal

Perbaiki 3 bug kalkulasi di alur rekomendasi pengadaan yang ketemu saat code review manual (bukan diff review) terhadap `recomendation-v2.service.ts`, `recommendation-stock.ts`, dan `discontinue-loss.service.ts` pada branch `fix/forecast-safety-stock-delivery-formula`. Ketiganya bikin angka yang ditampilkan/disimpan salah pada kondisi data tertentu — independen dari fitur [[2026-09-19-recommendation-period-lock-design|Lock Rekomendasi per Periode]], tapi relevan buatnya: kalau kalkulasi sumbernya salah, Lock cuma membekukan angka yang salah itu secara permanen sebagai riwayat. Idealnya 3 bug ini beres duluan sebelum periode pertama dikunci.

## Bug #1 — Physical stock harus mengikuti bulan filter

**Lokasi:** `src/module/application/recomendation-v2/recommendation-stock.ts:53-64`, fungsi `rawMaterialPhysicalStockSql`.

**Kode saat ini:**
```sql
FROM raw_material_inventories
WHERE raw_material_id = ${materialId}
  AND year = ${year}
  AND month = ${month}
```

`year`/`month` yang dipakai adalah periode inventory hasil filter Rekomendasi. Query harus mengikuti semantik RM Inventory: hanya snapshot pada bulan/tahun tersebut, lalu memilih row terbaru per gudang di dalam periode.

**Akibat bila memakai `<= target`:** gudang tanpa snapshot di bulan terpilih membawa saldo bulan lama dan menambah `current_stock`. Contoh PB10M-GP September 2026: Produksi 1.137 + Kandangan 13.800 seharusnya 14.937, tetapi snapshot Pusat SBY Agustus 9.500 ikut dihitung sehingga menjadi 24.437.

**Skenario gagal:** RM mempunyai snapshot September pada dua gudang dan snapshot Agustus pada gudang ketiga. Filter September hanya boleh menjumlah dua row September.

**Keputusan revisi 2026-09-21:** gunakan `year = targetYear AND month = targetMonth`, lalu pilih row terbaru per gudang. Keputusan mengikuti filter RM Inventory dan validasi data PB10M-GP.

## Bug #2 — `bulkSaveHorizon` pakai aturan size-multiplier beda dari `list()`

**Lokasi:** `src/module/application/recomendation-v2/recomendation-v2.service.ts:1724` (CTE `fc_agg`) dan `:1763` (CTE `fg_agg`), di dalam `bulkSaveHorizon`.

**Kode saat ini:**
```sql
CASE WHEN rm2.type = 'FO' OR urm2.name ILIKE ANY(ARRAY['ml', 'l', 'liter', 'ML']) THEN COALESCE(ps.size, 1) ELSE 1 END
```

Semua CTE lain di file ini yang menghitung multiplier size — `rm_forecast_agg`, `rm_stock_ss_agg`, `rm_current_sales_agg`, `sales_data`, `needs_data`, `h_fc`, bahkan `ss_agg` di fungsi `bulkSaveHorizon` yang sama (baris 1752) — nge-gate pakai `rec.use_size_calc`, flag di level resep yang memang didesain buat kontrol ini. Baris 1724/1763 malah nebak dari `raw_material.type`/nama unit, bukan dari flag resep.

**Akibat:** untuk resep dengan `use_size_calc = true` di RM yang tipe-nya bukan `'FO'` dan unit-nya bukan ml/l/liter, `list()` (halaman rekomendasi) mengalikan `ps.size` dengan benar, tapi `bulkSaveHorizon` ("Simpan Massal") menyimpan `total_needed`/`stock_fg_x_resep` ke `material_purchase_drafts` **tanpa** multiplier itu.

**Skenario gagal:** user lihat rekomendasi di halaman (sudah dikali size), klik "Simpan Massal" — angka yang ke-persist di draft beda diam-diam dari yang barusan dia lihat dan setujui.

**Keputusan perbaikan:** ganti kondisi di `fc_agg`/`fg_agg` supaya konsisten pakai `rec.use_size_calc`, sama seperti `ss_agg` di fungsi yang sama.

## Bug #3 — `discontinue-loss.service.ts` pilih preferred supplier beda dari modul lain

**Lokasi:** `src/module/application/recomendation-v2/discontinue/discontinue-loss.service.ts:69-71`.

**Kode saat ini:**
```sql
ORDER BY sm.updated_at DESC, sm.id DESC LIMIT 1
```

Commit `79d05de` (fix(recommendation): persist bulk horizon in listed supplier category) dan `fe35ec1` (fix(recommendation): align bulk reset with listed supplier category) sudah mengganti pola serupa di `list()`, `bulkResetWorkOrders`, dan `bulkSaveHorizon` dari `updated_at DESC` menjadi `supplier_id ASC` — persis supaya pemilihan preferred supplier konsisten ketika data `supplier_materials` punya lebih dari satu baris `is_preferred = true` per material (dicatat sebagai isu data di spec Lock, bagian Risiko: 316 RM kena ini). File `discontinue-loss.service.ts` gak ikut diupdate saat itu.

**Akibat:** RM dengan preferred ganda → valuasi loss (`discontinue-loss`) pakai harga dari baris ter-update-terakhir, sementara rekomendasi & consolidation untuk RM yang sama pakai harga dari baris `supplier_id` terkecil. Dua angka harga berbeda buat satu RM yang sama, ditampilkan di dua laporan berbeda.

**Keputusan perbaikan:** ganti `ORDER BY sm.updated_at DESC, sm.id DESC` menjadi `ORDER BY sm.supplier_id ASC` (atau ekstrak jadi helper bersama dari `shared/material-type-scope.ts` supaya gak nyimpang lagi ke depannya — direkomendasikan, karena inkonsistensi ini persis terjadi karena aturannya diduplikasi manual di banyak file).

## Testing

1. **Bug #1** — RM dengan snapshot bulan N pada satu gudang dan snapshot N-1 pada gudang lain: `current_stock` hanya menjumlah snapshot bulan N.
2. **Bug #2** — resep `use_size_calc=true` pada RM non-FO dengan unit bukan ml/l/liter: `bulkSaveHorizon` menyimpan `total_needed`/`stock_fg_x_resep` yang sama dengan yang ditampilkan `list()` untuk kombinasi bulan/horizon yang sama.
3. **Bug #3** — RM dengan 2 baris `supplier_materials` `is_preferred=true` beda harga: `discontinue-loss` dan `list()`/consolidation mengembalikan harga dari baris `supplier_id` yang sama.

## Risiko

- **Ketiganya berdiri sendiri** — bisa di-fix dan di-deploy terpisah, gak saling bergantung, dan gak butuh migration.
- **Urutan relatif ke Lock Rekomendasi:** disarankan Bug #1 dan #2 selesai sebelum periode produksi pertama kali dikunci — kalau tidak, snapshot pertama akan membekukan angka `current_stock`/`total_needed` yang salah secara permanen sebagai "riwayat resmi", dan baru ketahuan salah setelah dibandingkan manual seperti proses review ini.
- **Data historis yang sudah kadung salah** (draft/WO yang sudah tersimpan sebelum fix) tidak di-backfill oleh perbaikan ini — di luar scope, perlu keputusan terpisah kalau mau dikoreksi.
