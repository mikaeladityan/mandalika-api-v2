# Lock Rekomendasi per Periode

## Goal

Bekukan seluruh angka rekomendasi satu periode sehingga perubahan data hulu — resep/BOM, issuance/sales, safety stock, forecast, stok, Open PO, master supplier — tidak lagi mengubah apa yang ditampilkan dan dicetak untuk periode itu. Lock dapat dibuka kembali, dan setiap lock tersimpan sebagai riwayat bernomor versi.

## Masalah

Daftar rekomendasi dihitung ulang penuh setiap request (`RecomendationV2Service.list`). Yang tersimpan permanen hanya Work Order (`material_purchase_drafts`) dengan sebagian kolom: `quantity`, `current_stock`, `total_needed`, `safety_stock_x_resep`, `stock_fg_x_resep`, `horizon`, `hidden_at`. Sales history, kebutuhan forecast per bulan, Open PO per bulan, safety stock, MOQ, supplier terpilih, dan angka rekomendasi tidak tersimpan.

Akibatnya angka yang sudah dipakai sebagai dasar keputusan pembelian bisa berubah sendiri: satu perubahan resep menggeser kebutuhan seluruh RM di bawah FG tersebut, dan koreksi issuance bulan lalu menggeser sales history.

## Scope

- Satu lock mencakup **seluruh periode** (bulan + tahun): General `ACTIVE`, Discontinue `PENDING`, dan semua `type` (`ffo`, `impor`, `lokal`, `tester`) sekaligus. Satu tombol, satu status.
- Halaman yang ikut beku: daftar rekomendasi (General, Discontinue FG × RM, Discontinue Material), export CSV, Print PDF, Consolidation, serta RFQ/PO turunan.
- Semua user aplikasi boleh lock dan unlock; pelakunya dicatat.

### Non-goal

- Tidak membekukan tabel sumber (`product_issuances`, `forecasts`, `safety_stock`, `recipes`, inventori). Data hulu tetap bebas berubah; snapshot yang melindungi periode terkunci.
- Tidak mengunci periode secara otomatis. Lock selalu tindakan eksplisit.
- Tidak mengubah alur approval Work Order → RFQ → PO.

## Keputusan desain

| Pertanyaan | Keputusan | Alasan |
|---|---|---|
| Unit lock | Per periode, semua scope | Keputusan pembelian diambil per bulan, bukan per RM |
| Cara membekukan | Snapshot baris hasil perhitungan | Membekukan tabel sumber berarti versioning seluruh hulu |
| Bentuk snapshot | Tabel baris + payload JSON | Search/sort/paginate tetap di SQL; blob per periode memaksa semua itu pindah ke aplikasi |
| Saat terkunci | Tulis ditolak, kecuali approve/ACC | Angka beku, alur approval tetap jalan |
| Saat unlock | Snapshot disimpan sebagai riwayat | Jejak angka yang pernah jadi dasar pembelian |
| Hak akses | Semua user aplikasi | Tim kecil; jejak siapa/kapan sudah cukup |

## Data model

```prisma
enum RecommendationLockStatus {
  LOCKED
  RELEASED
}

enum RecommendationLockView {
  GENERAL              // daftar rekomendasi General (product_status ACTIVE)
  DISCONTINUE_FG       // daftar Discontinue per FG × RM
  DISCONTINUE_MATERIAL // daftar Discontinue agregat per RM
}

model RecommendationPeriodLock {
  id          Int                      @id @default(autoincrement())
  month       Int                      @db.SmallInt
  year        Int                      @db.SmallInt
  version     Int
  status      RecommendationLockStatus @default(LOCKED)
  note        String?                  @db.VarChar(255)
  meta        Json?                    // periods: horizon sales/forecast/PO saat dikunci
  locked_at   DateTime                 @default(now())
  locked_by   String?
  unlocked_at DateTime?
  unlocked_by String?
  rows        RecommendationLockRow[]

  @@unique([month, year, version])
  @@index([month, year, status])
  @@map("recommendation_period_locks")
}

model RecommendationLockRow {
  id             Int                      @id @default(autoincrement())
  lock_id        Int
  view           RecommendationLockView
  raw_mat_id     Int
  fg_id          Int?                     // hanya DISCONTINUE_FG
  product_status WorkOrderProductStatus

  // kolom filter dan sort, ikut beku
  material_name          String  @db.VarChar(255)
  barcode                String? @db.VarChar(100)
  category_name          String? @db.VarChar(100)
  supplier_id            Int?
  supplier_name          String? @db.VarChar(255)
  type_tag               String? @db.VarChar(20)   // ffo | impor | lokal | tester
  sort_sales             Decimal @default(0) @db.Decimal(18, 2)
  sort_current_stock     Decimal @default(0) @db.Decimal(18, 2)
  sort_forecast_needed   Decimal @default(0) @db.Decimal(18, 2)
  sort_recommendation    Decimal @default(0) @db.Decimal(18, 2)
  hidden                 Boolean @default(false)
  fg_id_key              Int     @default(0)   // 0 = tanpa FG (GENERAL, DISCONTINUE_MATERIAL); lihat catatan unique di bawah

  payload        Json

  lock RecommendationPeriodLock @relation(fields: [lock_id], references: [id], onDelete: Cascade)

  @@unique([lock_id, view, raw_mat_id, fg_id_key])
  @@index([lock_id, view, type_tag, product_status])
  @@map("recommendation_lock_rows")
}
```

**Kolom sort — revisi poin 1.** `sortBy` di `QueryRecomendationV2Schema` punya 5 opsi: `material_name`, `barcode`, `current_stock`, `forecast_needed`, `recommendation_quantity`. Draft sebelumnya cuma menyalin `sort_sales`, padahal itu bukan salah satu dari 5 opsi tsb — `material_name`/`barcode` sudah punya kolom sendiri, tapi `current_stock` dan `recommendation_quantity` tidak. Ditambahkan `sort_current_stock`, `sort_forecast_needed`, dan `sort_recommendation` — tiga kolom terpisah, bukan berbagi — supaya kelima opsi sort tetap dilayani SQL saat terkunci, bukan jatuh ke sort atas `payload` JSON. `forecast_needed` (`COALESCE(fa.m1_forecast_needed, 0)` — forecast bulan berjalan saja) dan `recommendation_quantity` (`GREATEST(0, total_forecast_horizon_dynamic + safety_stock_x_resep - (current_stock + open_po))` — angka full-horizon ternetokan stok/PO) dihitung dari formula yang sama sekali berbeda di `RecomendationV2Service.list`; menyamakan keduanya ke satu kolom bikin urutan hasil locked-mode beda dari live-mode begitu safety stock/open PO/horizon > 1 bulan — melanggar Testing #6.

**Unique constraint — revisi poin 5.** Constraint asli `@@unique([lock_id, view, raw_mat_id, fg_id])` tidak efektif untuk baris GENERAL dan DISCONTINUE_MATERIAL: Postgres menganggap `NULL <> NULL` di unique index, jadi banyak baris `fg_id = NULL` dengan `raw_mat_id` sama tidak akan ditolak DB sebagai duplikat. Diganti pakai `fg_id_key` non-nullable: `fg_id_key = fg_id` untuk DISCONTINUE_FG (FG id sistem ini selalu > 0), `fg_id_key = 0` untuk GENERAL/DISCONTINUE_MATERIAL (tidak punya FG). `fg_id` tetap dipertahankan sebagai kolom data nullable (dipakai payload/join), `fg_id_key` murni untuk constraint — turunan langsung dari `fg_id`, bukan nilai independen. Constraint jadi benar-benar menolak duplikat di ketiga view.

`payload` menyimpan baris apa adanya seperti yang dikembalikan `list()` hari ini: `sales[]`, `needs[]` (termasuk `override_needs`), `open_pos[]`, `current_stock`, `net_stock`, `safety_stock_x_resep`, `stock_fg_x_resep`, `total_needed`, `recommendation_quantity`, `moq`, `lead_time`, `uom`, `work_order_*`, dan untuk Discontinue `discontinue_breakdown`.

Kolom filter disalin keluar dari payload supaya pencarian, filter `type`, dan urutan dilayani SQL — dan supaya perubahan master (RM pindah kategori, supplier preferred berubah, nama supplier diganti) tidak menggeser isi tabel yang sudah dikunci.

`type_tag` dihitung saat snapshot dengan aturan `shared/material-type-scope.ts`: supplier preferred dengan `supplier_id` terkecil.

## Jalur baca

`RecomendationV2Service.list`, `export`, dan `DiscontinueMaterialRecommendationService.list` memanggil resolver di awal:

```
lock = findActiveLock(month, year)      // status LOCKED
lock ada  → baca RecommendationLockRow (filter view/type/product_status/search,
            sort by kolom yang dipetakan dari query.sortBy — material_name/barcode/sort_current_stock/sort_forecast_needed/sort_recommendation,
            default sort_sales desc, paginate di SQL)
lock tidak ada → perhitungan live seperti sekarang
```

Response menambah blok `lock`, dipakai UI untuk badge dan penonaktifan tombol:

```json
"lock": { "locked": true, "version": 3, "locked_at": "2026-09-19T00:20:00.000Z", "locked_by": "user-id", "note": null }
```

Saat tidak terkunci: `{ "locked": false, "last_version": 2 }` bila periode pernah dikunci, atau `{ "locked": false }`.

Bentuk `data` dan `periods` identik dengan mode live, sehingga frontend tidak punya dua jalur render. `periods` ikut disimpan di header snapshot (kolom `payload` pada lock, lihat "Migrasi") karena panjang horizon sales/forecast/PO saat dikunci harus ikut beku.

Consolidation dan RFQ/PO tidak butuh jalur baca baru: keduanya membaca `material_purchase_drafts`, yang angkanya sudah tersimpan dan dilindungi gate tulis di bawah. Keduanya hanya menampilkan badge terkunci.

## Jalur tulis

Helper `assertPeriodUnlocked(month, year)` di layer service melempar `ApiError` dengan kode `PERIOD_LOCKED`; controller menerjemahkan menjadi **409** dengan pesan Bahasa Indonesia.

| Endpoint | Saat terkunci |
|---|---|
| `POST /recomendations-v2/bulk-horizon` | 409 |
| `POST /recomendations-v2/order` | 409 |
| `DELETE /recomendations-v2/:id` | 409 |
| `POST /recomendations-v2/bulk-reset` | 409 |
| `POST /recomendations-v2/bulk-reset/preview` | boleh (hanya hitung) |
| `POST` / `DELETE /recomendations-v2/need-override` | 409 |
| `PATCH /recomendations-v2/moq` | **boleh** — lihat catatan MOQ |
| `PATCH /recomendations-v2/hide` | **boleh** — lihat catatan hide |
| `POST /recomendations-v2/open-po` | 409 |
| `PATCH` / `DELETE /recomendations-v2/open-po/:itemId` | 409 hanya bila PO masih `DRAFT`/`SUBMITTED` — lihat catatan resolusi & batas lock vs RFQ/PO |
| `POST /recomendations-v2/discontinue/materials/bulk` | 409 |
| `PUT` / `DELETE /recomendations-v2/discontinue/anchor` | 409 |
| `POST /recomendations-v2/approve` | **boleh** |
| `PATCH /consolidation/bulk-status` | **boleh** |
| `PATCH /consolidation/hide` | **boleh** — lihat catatan hide |
| Alur RFQ dan PO (setelah item promosi jadi RFQ/PO) | boleh — lihat catatan batas lock vs RFQ/PO |

### Resolusi periode per endpoint — revisi poin 3

Endpoint yang membawa `month`/`year` langsung di body/query (`bulk-horizon`, `order`, `bulk-reset`, `need-override`, `open-po` create, `discontinue/materials/bulk`, `discontinue/anchor`) memakai nilai itu langsung.

Endpoint yang hanya membawa `id` tanpa periode butuh resolusi lebih dulu:

| Endpoint | Sumber periode |
|---|---|
| `DELETE /recomendations-v2/:id` | `month`/`year` pada `MaterialPurchaseDraft` yang bersangkutan |
| `PATCH` / `DELETE /recomendations-v2/open-po/:itemId` | `EXTRACT(MONTH/YEAR FROM po.po_date)` pada `PurchaseOrderItem.po`, persis logika `listOpenPoCell` — **dan** `po.status`: gate cuma jalan kalau status `DRAFT`/`SUBMITTED` (lihat catatan batas lock vs RFQ/PO) |

### Catatan hide — revisi poin 3 (keputusan berubah)

`PATCH /recomendations-v2/hide` dan `PATCH /consolidation/hide` **tidak digate**. Hide cuma nyembunyiin baris dari tampilan (`hidden_at` di `MaterialPurchaseDraft`), gak ngubah angka rekomendasi/kuantitas — beda kelas sama bulk-horizon/order/bulk-reset yang benar-benar mengubah nilai yang sudah dibekukan. Konsekuensinya baris snapshot yang sudah dikunci bisa jadi gak sinkron sama status `hidden_at` terbaru; ditangani read-path: saat locked, `hidden` yang ditampilkan tetap ambil dari kolom `hidden` di `RecommendationLockRow` (state hide pada saat snapshot diambil), bukan dari `MaterialPurchaseDraft` live — jadi tampilan periode terkunci tetap konsisten walau user hide/unhide draft setelah lock. Karena gak digate, endpoint ini juga gak butuh resolusi periode sama sekali — dihapus dari tabel resolusi di atas.

### Catatan MOQ — revisi poin 2

`PATCH /recomendations-v2/moq` menulis ke `SupplierMaterial.min_buy` — data master per RM+supplier, bukan data per periode (body cuma `{material_id, moq}`, tidak ada `month`/`year`). Menggate endpoint ini kontradiktif dengan Non-goal ("tidak membekukan tabel sumber... snapshot yang melindungi periode terkunci"): kalau snapshot sudah melindungi angka yang tampil, ubah MOQ master tidak perlu diblokir — perubahan itu baru kelihatan pengaruhnya setelah unlock, sama seperti resep atau safety stock berubah. **Keputusan: MOQ dikeluarkan dari gate.** Ditambahkan ke daftar pengujian "Master berubah" (lihat Testing #3).

### Catatan batas lock vs alur RFQ/PO — revisi poin 4

`/recomendations-v2/open-po/*` menulis langsung ke `purchase_orders`/`purchase_order_items` — tabel yang sama juga ditulis oleh alur RFQ/PO yang sengaja dibebaskan dari gate. Tanpa batas jelas, user bisa mem-bypass lock dengan mengedit PO item yang sama lewat endpoint RFQ/PO alih-alih lewat `/open-po`.

**Keputusan:** batas dipisah oleh maksud PO tersebut, bukan tabelnya:
- Selama PO masih berstatus `DRAFT`/`SUBMITTED` dan dibuat/diedit *dari halaman rekomendasi* (endpoint `/recomendations-v2/open-po/*`), ia dianggap bagian dari angka rekomendasi periode itu → digate.
- Begitu PO naik status ke `APPROVED`/`ORDERED` atau masuk alur RFQ formal, ia dianggap keputusan pembelian yang sudah berjalan sendiri, di luar cakupan lock → tidak digate, walau menyentuh baris yang sama.

Ini masih meninggalkan celah pada window `DRAFT`/`SUBMITTED`: PO itu tetap bisa diedit lewat endpoint RFQ/PO generik tanpa kena 409. Diterima sebagai keterbatasan yang didokumentasikan (bukan silent bug) — endpoint RFQ/PO generik ditambah pengecekan periode terkunci hanya kalau kelak terbukti jadi jalur bypass nyata di lapangan; tidak diimplementasikan di rilis pertama supaya scope tidak melebar ke modul RFQ/PO.

## Lock dan unlock

`POST /api/app/recomendations-v2/lock` — body `{ month, year, note? }`

1. Tolak (409) bila sudah ada lock `LOCKED` untuk periode itu.
2. Dalam satu transaksi: jalankan `list()` mode live tanpa paginasi untuk GENERAL, DISCONTINUE_FG, dan DISCONTINUE_MATERIAL.
3. Simpan header `version = max(version) + 1` untuk periode itu, lalu seluruh baris.
4. Kembalikan ringkasan: jumlah baris per view, versi, waktu.

`POST /api/app/recomendations-v2/unlock` — body `{ month, year }`
Set header `LOCKED` → `RELEASED`, isi `unlocked_at` dan `unlocked_by`. Baris snapshot tetap. Daftar kembali live.

`GET /api/app/recomendations-v2/locks?month=&year=` — riwayat versi periode: versi, status, siapa, kapan, catatan, jumlah baris.

Semua endpoint memakai sesi aplikasi; `locked_by`/`unlocked_by` diisi dari sesi.

## UI

- Header halaman rekomendasi: tombol **Lock Periode** / **Buka Kunci** dengan dialog konfirmasi berisi bulan/tahun dan ringkasan jumlah baris yang akan dibekukan.
- Badge saat terkunci: `Terkunci v3 · <nama> · 19 Sep 2026 00:20`, dengan tooltip catatan bila ada.
- Semua kontrol tulis (Bulk Save, Bulk Reset, Open PO draft/submitted, anchor, Work Order) nonaktif saat terkunci; tombol approve, MOQ, dan hide tetap aktif.
- Toast khusus untuk 409 `PERIOD_LOCKED`.
- Badge yang sama muncul di Consolidation.
- Riwayat lock ditampilkan di dialog kecil dari badge.

## Migrasi

Satu migration Prisma: dua enum, dua tabel, index. Tidak ada perubahan pada tabel lama, jadi tidak ada backfill dan tidak ada periode yang otomatis terkunci.

Header menyimpan `periods` (horizon sales/forecast/PO saat dikunci) pada kolom `meta` di `recommendation_period_locks`, dibuat bersama tabelnya.

## Testing

1. **Gate tulis** — setiap endpoint pada tabel di atas: terkunci → 409, tidak terkunci → normal. Approve, `bulk-status`, `moq`, dan `hide` (kedua modul) tetap 200 saat terkunci.
2. **Snapshot stabil** — lock, lalu ubah resep, issuance, safety stock, dan stok; `list`, `export`, dan Print PDF harus mengembalikan angka identik.
3. **Master berubah** — RM pindah kategori, supplier preferred berganti, dan MOQ (`SupplierMaterial.min_buy`) diubah setelah lock: baris tetap pada `type`/nama supplier/MOQ semula sampai unlock; perubahan MOQ baru kelihatan di lock berikutnya.
4. **Unlock** — daftar kembali live, header `RELEASED`, baris snapshot masih ada, lock berikutnya bernomor versi +1.
5. **Idempotensi** — lock kedua pada periode yang sudah `LOCKED` ditolak 409.
6. **Paginasi dan filter** — mode terkunci memberi `len` dan urutan yang sama dengan mode live pada data yang sama, untuk **kelima** opsi `sortBy` (`material_name`, `barcode`, `current_stock`, `forecast_needed`, `recommendation_quantity`).
7. **Discontinue** — ketiga view ikut terkunci, termasuk `discontinue_breakdown`.
8. **Resolusi periode by-id** — `open-po/:itemId` (update & delete): terkunci saat periode hasil resolve terkunci, meski body tidak membawa `month`/`year`.
9. **Hide tidak digate** — hide/unhide draft (kedua modul) tetap 200 saat periode locked; baris yang sudah di-snapshot tampilannya tidak berubah (pakai `hidden` dari `RecommendationLockRow`, bukan `MaterialPurchaseDraft` live).
10. **Batas lock vs RFQ/PO** — PO hasil `/open-po` yang masih `DRAFT`/`SUBMITTED` ditolak diedit lewat `/open-po/:itemId` saat locked; PO yang sama setelah naik ke `APPROVED`/`ORDERED` tetap bisa diedit lewat alur RFQ/PO baku.
11. **Duplikat baris snapshot** — coba insert dua `RecommendationLockRow` dengan `view` + `raw_mat_id` sama dan `fg_id` null dalam satu lock (GENERAL/DISCONTINUE_MATERIAL): harus ditolak constraint DB, bukan lolos karena `fg_id` NULL.

## Risiko

- **Biaya lock.** Membangun snapshot menjalankan perhitungan penuh tiga view tanpa paginasi; pada data sekarang (±280 RM General, ±160 Discontinue) sekitar beberapa detik. Dijalankan dalam satu transaksi, dipanggil manual, dan jarang — diterima. Bila kelak melambat, pindah ke job antrean.
- **Ukuran.** Sekitar 400–600 baris per lock. Tidak dibersihkan otomatis; kalau nanti perlu, hapus berdasarkan umur lock `RELEASED`.
- **Drift bentuk payload.** Kalau `list()` menambah field, baris lama tidak punya field itu. Frontend harus toleran terhadap field hilang; dicakup pengujian pada snapshot versi lama.
- **Duplikat preferred supplier.** `type_tag` memakai aturan "preferred dengan `supplier_id` terkecil". Selama data `supplier_materials` masih punya preferred ganda (316 RM), aturan itu deterministik tetapi belum tentu sesuai maksud bisnis. Pembersihan data dilacak terpisah di TODO dan tidak memblokir fitur ini.
- **Bug kalkulasi existing ikut terbekukan.** Review manual kode `recomendation-v2.service.ts`/`recommendation-stock.ts`/`discontinue-loss.service.ts` menemukan 3 bug kalkulasi yang sudah ada sebelum fitur ini (physical stock salah untuk RM tanpa snapshot di bulan exact, `bulkSaveHorizon` pakai aturan size-multiplier beda dari `list()`, `discontinue-loss` pilih preferred supplier beda dari modul lain — detail di [[2026-09-19-recommendation-calc-bugs-design]]). Selama bug ini belum di-fix, Lock akan membekukan angka yang sudah salah sebagai riwayat resmi. **Disarankan Bug #1 dan #2 selesai sebelum periode produksi pertama dikunci.**
