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
  material_name  String  @db.VarChar(255)
  barcode        String? @db.VarChar(100)
  category_name  String? @db.VarChar(100)
  supplier_id    Int?
  supplier_name  String? @db.VarChar(255)
  type_tag       String? @db.VarChar(20)   // ffo | impor | lokal | tester
  sort_sales     Decimal @default(0) @db.Decimal(18, 2)
  hidden         Boolean @default(false)

  payload        Json

  lock RecommendationPeriodLock @relation(fields: [lock_id], references: [id], onDelete: Cascade)

  @@unique([lock_id, view, raw_mat_id, fg_id])
  @@index([lock_id, view, type_tag, product_status])
  @@map("recommendation_lock_rows")
}
```

`payload` menyimpan baris apa adanya seperti yang dikembalikan `list()` hari ini: `sales[]`, `needs[]` (termasuk `override_needs`), `open_pos[]`, `current_stock`, `net_stock`, `safety_stock_x_resep`, `stock_fg_x_resep`, `total_needed`, `recommendation_quantity`, `moq`, `lead_time`, `uom`, `work_order_*`, dan untuk Discontinue `discontinue_breakdown`.

Kolom filter disalin keluar dari payload supaya pencarian, filter `type`, dan urutan dilayani SQL — dan supaya perubahan master (RM pindah kategori, supplier preferred berubah, nama supplier diganti) tidak menggeser isi tabel yang sudah dikunci.

`type_tag` dihitung saat snapshot dengan aturan `shared/material-type-scope.ts`: supplier preferred dengan `supplier_id` terkecil.

## Jalur baca

`RecomendationV2Service.list`, `export`, dan `DiscontinueMaterialRecommendationService.list` memanggil resolver di awal:

```
lock = findActiveLock(month, year)      // status LOCKED
lock ada  → baca RecommendationLockRow (filter view/type/product_status/search, sort sort_sales desc, paginate di SQL)
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
| `PATCH /recomendations-v2/moq` | 409 |
| `PATCH /recomendations-v2/hide` | 409 |
| `POST` / `PATCH` / `DELETE /recomendations-v2/open-po` | 409 |
| `POST /recomendations-v2/discontinue/materials/bulk` | 409 |
| `PUT` / `DELETE /recomendations-v2/discontinue/anchor` | 409 |
| `POST /recomendations-v2/approve` | **boleh** |
| `PATCH /consolidation/bulk-status` | **boleh** |
| `PATCH /consolidation/hide` | 409 |
| Alur RFQ dan PO | boleh |

Periode diambil dari body/query endpoint. Untuk endpoint yang hanya membawa `id` draft (`DELETE /:id`), periode dibaca dari draft tersebut lebih dulu.

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
- Semua kontrol tulis (Bulk Save, Bulk Reset, MOQ, hide, Open PO, anchor, Work Order) nonaktif saat terkunci; tombol approve tetap aktif.
- Toast khusus untuk 409 `PERIOD_LOCKED`.
- Badge yang sama muncul di Consolidation.
- Riwayat lock ditampilkan di dialog kecil dari badge.

## Migrasi

Satu migration Prisma: dua enum, dua tabel, index. Tidak ada perubahan pada tabel lama, jadi tidak ada backfill dan tidak ada periode yang otomatis terkunci.

Header menyimpan `periods` (horizon sales/forecast/PO saat dikunci) pada kolom `meta` di `recommendation_period_locks`, dibuat bersama tabelnya.

## Testing

1. **Gate tulis** — setiap endpoint pada tabel di atas: terkunci → 409, tidak terkunci → normal. Approve dan `bulk-status` tetap 200 saat terkunci.
2. **Snapshot stabil** — lock, lalu ubah resep, issuance, safety stock, dan stok; `list`, `export`, dan Print PDF harus mengembalikan angka identik.
3. **Master berubah** — RM pindah kategori dan supplier preferred berganti setelah lock: baris tetap pada `type` semula dengan nama supplier semula.
4. **Unlock** — daftar kembali live, header `RELEASED`, baris snapshot masih ada, lock berikutnya bernomor versi +1.
5. **Idempotensi** — lock kedua pada periode yang sudah `LOCKED` ditolak 409.
6. **Paginasi dan filter** — mode terkunci memberi `len` dan urutan yang sama dengan mode live pada data yang sama.
7. **Discontinue** — ketiga view ikut terkunci, termasuk `discontinue_breakdown`.

## Risiko

- **Biaya lock.** Membangun snapshot menjalankan perhitungan penuh tiga view tanpa paginasi; pada data sekarang (±280 RM General, ±160 Discontinue) sekitar beberapa detik. Dijalankan dalam satu transaksi, dipanggil manual, dan jarang — diterima. Bila kelak melambat, pindah ke job antrean.
- **Ukuran.** Sekitar 400–600 baris per lock. Tidak dibersihkan otomatis; kalau nanti perlu, hapus berdasarkan umur lock `RELEASED`.
- **Drift bentuk payload.** Kalau `list()` menambah field, baris lama tidak punya field itu. Frontend harus toleran terhadap field hilang; dicakup pengujian pada snapshot versi lama.
- **Duplikat preferred supplier.** `type_tag` memakai aturan "preferred dengan `supplier_id` terkecil". Selama data `supplier_materials` masih punya preferred ganda (316 RM), aturan itu deterministik tetapi belum tentu sesuai maksud bisnis. Pembersihan data dilacak terpisah di TODO dan tidak memblokir fitur ini.
