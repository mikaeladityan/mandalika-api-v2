---
name: dev-flow
description: Full Stack Development Flow untuk ERP Mandalika. Panduan end-to-end dari Backend (Prisma, Zod, service, controller, route, HTTP status code, BullMQ import, CSV export) ke Frontend (DTO, query/mutation hooks, komponen). Gunakan saat memulai fitur baru, menambah endpoint import/export, atau ingin mengikuti standar arsitektur proyek ini.
---

# Full Stack Development Flow - eLibrary / ERP

Panduan ini mendokumentasikan alur pengembangan fitur (End-to-End) mulai dari rancangan Backend hingga implementasi Antarmuka (Frontend) sesuai standar pola arsitektur proyek ini.

---

## 🏗️ 1. Fase Backend

Pengembangan selalu diawali di sisi `Backend` (`/api`) untuk mematangkan pondasi data.

### A. Database Model (Prisma)

1. Buka file `schema.prisma` di direktori database.
2. Definisikan `model` baru berikut dengan relasinya, index, dan enum jika diperlukan.
3. Jalankan migrasi dan _generate_ Prisma Client v6 agar _types_ dapat dibaca oleh TypeScript.

### B. Zod Schema & DTO (`[feature].schema.ts`)

1. Buat direktori modul baru di `api/src/module/application/[feature]`.
2. Definisikan Zod Validation untuk request (`Request[Feature]Schema`), response (`Response[Feature]Schema`) dan query (`Query[Feature]Schema`).
3. Ekspor tipenya sebagai **DTO** (Data Transfer Object) seperti `Request[Feature]DTO`, `Response[Feature]DTO` dan `Query[Feature]DTO`. Ini menjadi standar komunikasi tipe data statis dalam sistem.

### C. Bussiness Logic / Service (`[feature].service.ts`)

1. Buat `[Feature]Service` yang membungkus semua transaksi dari dan ke tabel _database_.
2. Implementasikan metode standar CRUD (`create`, `update`, `changeStatus:[STATUS] <-- Enum`, `delete/destroy <-- Permanent Delete`, `detail`, `list`) menggunakan Prisma.
3. Terapkan validasi _business rule_ di level ini (contoh: cek id eksis, pastikan data tidak bentrok, dsb) serta melempar kesalahan lewat `ApiError`.

### D. Request Handler / Controller (`[feature].controller.ts`)

1. Tangkap _request_ dari HTTP, ekstrak _params_, _query_, serta parameter lainnya.
2. Panggil _method_ dari spesifik servis sebelumnya (`[Feature]Service`).
3. Bungkus hasil respons dengan rapi menggunakan utilitas bawaan, misalnya `return ApiResponse.sendSuccess(c, result, StatusCode, query?)`.

### E. Routing (`[feature].routes.ts`)

1. Buat dan daftarkan rute Hono untuk setiap _endpoint_ API.
2. Sinkronkan _path_ (misal `POST /`, `GET /:id`) dengan _controller_ fungsionalnya.
3. Berikan _middleware_ keamanan tambahan seperti `validateBody(Request...Schema)` sebelum data benar-benar diteruskan ke _Controller_.

---

## ⚠️ 1.F Type Safety (SOP Wajib)

Sayang sekali pakai TypeScript kalau masih ada `any`/`unknown` tersebar. Aturan ini berlaku **di semua layer backend** (schema, service, controller, routes, lib).

### Larangan

- ❌ **`any`** — eksplisit (`x: any`) maupun implisit (parameter tanpa anotasi, callback tanpa generic).
- ❌ **`unknown` malas** — `unknown` hanya boleh dipakai sebagai *initial type* dari sumber yang benar-benar tidak terprediksi (mis. `JSON.parse`, error catch). Setelah itu **wajib di-narrow** lewat type guard / Zod parse sebelum dipakai.
- ❌ **Cast paksa** — `as any`, `as unknown as X` dilarang kecuali ada komentar `// reason: ...` yang menjelaskan keterbatasan teknis (mis. limitasi library typing).

### Cara Mengganti

| Kasus | Anti-pattern | Gunakan |
|---|---|---|
| Param transaction client | `tx: any` | `tx: Prisma.TransactionClient` |
| Delegate Prisma generik (upsert helper, dsb.) | `model: any` | Type literal eksplisit, contoh: `type UpsertSlugDelegate = { upsert: (args: { where: { slug: string }; update: Record<string, never>; create: { name: string; slug: string }; select: { id: true } }) => Promise<{ id: number }> };` |
| Hasil `$queryRaw` | `prisma.$queryRaw<any[]>` | Tipe row eksplisit: `prisma.$queryRaw<Array<{ id: number; name: string; ... }>>` atau `Array<Record<string, unknown>>` lalu narrow lewat Zod. |
| Akses relasi nested di mapping | `(item.product_type as any)?.name` | Gunakan tipe dari `include` Prisma — relasi sudah strongly-typed dari generated client. |
| Body Hono context | `c.get("body") as any` | Set generic di `c.get<RequestFeatureDTO>("body")` atau gunakan middleware `validateBody` yang sudah inject typed payload. |
| Error catch | `catch (e: any)` | `catch (e)` (TS default `unknown`) → narrow via `e instanceof Prisma.PrismaClientKnownRequestError` / `instanceof Error`. |

### Hirarki Pengganti (Last Resort)

Jika benar-benar tidak ada cara lain (mis. integrasi library JS tanpa `@types/*`):

1. **`Record<string, unknown>`** atau type literal eksplisit — _selalu_ lebih baik dari opsi berikutnya.
2. **`unknown`** + narrow — bukan `any`.
3. **`any`** — **dilarang**; pertimbangkan menulis `@types/...` deklarasi sendiri di `src/types/`.

### Verifikasi Sebelum Commit

```bash
rtk tsc --noEmit
```

Tidak boleh ada error baru. Jika ditemukan `any` implisit, tambahkan anotasi tipe (jangan matikan `noImplicitAny`).

---

## 🌐 1.G HTTP Response Status Code (SOP Wajib)

**Jangan kembalikan `200` untuk semua respons sukses.** Status code adalah bagian dari kontrak API — frontend, monitoring, dan klien lain mengandalkan kode ini untuk membedakan jenis hasil tanpa membaca body. Gunakan `ApiResponse.sendSuccess(c, data, statusCode)` dengan kode yang tepat dan `throw new ApiError(statusCode, message)` untuk error.

### Matriks Status Sukses (2xx)

| Code | Nama | Kapan dipakai | Contoh endpoint |
|---|---|---|---|
| **200** | OK | Operasi sinkron berhasil dan body berisi resource final (GET, PATCH status, update yang langsung selesai) | `GET /:id`, `GET /` (list), `PATCH /:id/status`, `POST /bulk-status` |
| **201** | Created | Resource baru berhasil dibuat di server dan body memuat resource hasil create | `POST /` (create FG/RM), `POST /import/preview` (membuat preview session di cache) |
| **202** | Accepted | Permintaan diterima untuk diproses **asynchronously** (job dimasukkan ke queue, hasil belum final) | `POST /import/execute` (enqueue BullMQ job), trigger forecast batch |
| **204** | No Content | Operasi sukses tetapi tidak ada body untuk dikembalikan (jarang dipakai — preferensi proyek ini mengembalikan `{ status: "success" }` dengan 200) | _Hindari kecuali endpoint benar-benar tanpa payload._ |

### Matriks Status Error (4xx & 5xx)

| Code | Nama | Kapan dipakai | Contoh |
|---|---|---|---|
| **400** | Bad Request | Input tidak valid secara semantik / business rule violation (di luar Zod) — mis. `import_id` kosong, "tidak ada baris valid", filter melebihi batas | `throw new ApiError(400, "Import session tidak ditemukan atau sudah kadaluarsa")` |
| **401** | Unauthorized | Tidak ada / token tidak valid (otentikasi) | Middleware auth |
| **403** | Forbidden | Terotentikasi tapi tidak punya hak akses ke resource (otorisasi) | RBAC gate |
| **404** | Not Found | Resource (atau job) tidak ada | `throw new ApiError(404, "Produk tidak ditemukan")` |
| **409** | Conflict | Tabrakan state — duplikasi (`P2002`), lock sedang dipegang job lain, FK `RESTRICT` masih punya child | `throw new ApiError(409, "Import sedang diproses")` ; `throw new ApiError(400, "Kode Produk telah digunakan")` ⟵ *untuk duplikasi business, proyek ini memakai 400; lihat catatan di bawah.* |
| **413** | Payload Too Large | File / jumlah baris melewati batas atas (`MAX_ROWS`, `EXPORT_MAX_ROWS`) | `throw new ApiError(413, `File melebihi batas maksimum ${MAX_ROWS} baris`)` |
| **415** | Unsupported Media Type | MIME upload tidak didukung (selain `text/csv` / XLSX MIME) | Validator upload |
| **422** | Unprocessable Entity | Body lolos parsing tapi gagal validasi domain. Proyek ini **lebih memilih 400** untuk konsistensi — jangan pakai 422 kecuali sudah ada kesepakatan tim. | — |
| **429** | Too Many Requests | Rate limit terlampaui | Rate limiter middleware |
| **500** | Internal Server Error | Bug / unhandled exception. **Jangan pernah lempar manual** — biarkan global error handler menangani. | Jatuh otomatis dari `throw e` non-`ApiError` |
| **503** | Service Unavailable | Dependency turun (Redis/queue mati) — boleh dilempar dari health check, bukan dari business logic | — |

### Aturan Khusus Proyek

1. **Duplikasi unique key** (`P2002`) → **400** dengan pesan business (contoh: `"Produk dengan kode: X telah tersedia"`). Bukan 409. Ini standar proyek karena UI menampilkan pesan sebagai form-level error.
2. **Lock conflict** (Redis `SET NX` gagal saat import) → **409** karena state server lagi `in-progress` untuk resource yang sama.
3. **FK `RESTRICT` masih punya referensi** saat `clean()` → **409** ("Produk masih terkait dengan Production Order").
4. **Job tidak ditemukan** saat polling status BullMQ → **404** ("Import job tidak ditemukan").
5. **Cache preview expired** → **400** atau **404** sesuai konteks (preview lookup pakai 404, execute pakai 400 karena ini state error dari sisi user).
6. **Validasi Zod gagal** → ditangani oleh middleware `validateBody`, **otomatis 400**. Jangan duplikasi pengecekan.

### Pola Implementasi Controller

```ts
// ✅ Create resource baru
return ApiResponse.sendSuccess(c, result, 201);

// ✅ Async job enqueued (BullMQ)
return ApiResponse.sendSuccess(c, { import_id, jobId, state: "queued" }, 202);

// ✅ Read / list / status update
return ApiResponse.sendSuccess(c, result, 200);

// ✅ Validation / business rule error
throw new ApiError(400, "Tidak ada baris valid untuk diimport");

// ✅ Resource not found
throw new ApiError(404, "Produk tidak ditemukan");

// ✅ Lock / concurrency conflict
throw new ApiError(409, "Import sedang diproses, coba lagi sebentar");

// ✅ Upload melebihi batas
throw new ApiError(413, `File melebihi batas maksimum ${MAX_ROWS} baris`);
```

### Verifikasi

- Setiap controller method **wajib** menyertakan status code eksplisit di argumen ketiga `ApiResponse.sendSuccess`.
- Reviewer menolak default `200` di endpoint `POST` yang membuat resource atau memicu job async.
- Integration test memvalidasi `res.status` (bukan hanya `body.status === "success"`).

---

## 📥 1.H Import Pipeline (SOP — BullMQ + Redis Cache)

**Semua endpoint import file (CSV/XLSX) untuk modul inventory/master data wajib pakai pipeline BullMQ.** Pola sinkron `await prisma.createMany()` di dalam request handler **dilarang** karena: (a) request HTTP timeout untuk file besar, (b) retry idempoten tidak ada, (c) progress tidak bisa di-stream ke UI.

Referensi implementasi: `api/src/module/application/inventory/fg/import/` + `api/src/worker.ts` + `api/src/config/queue.ts` + `api/ecosystem.config.cjs`.

### Arsitektur

```
┌────────────┐    POST /import/preview    ┌─────────────┐
│  Frontend  │───────(CSV/XLSX file)─────▶│ API process │  ← api-erp (PM2)
└────────────┘                            └─────┬───────┘
       ▲                                        │ parse + Zod validate
       │                                        ▼
       │                                  ┌─────────────┐
       │                                  │ Redis cache │  rows + meta (TTL)
       │                                  └─────────────┘
       │  POST /import/execute (202)            │
       │                                        ▼
       │                                  ┌─────────────┐
       │                                  │   BullMQ    │  queue: fg-import
       │                                  │   (Redis)   │
       │                                  └─────┬───────┘
       │                                        │
       │  GET /import/status/:id                ▼
       │  (polling progress)              ┌─────────────┐
       │                                  │   Worker    │  ← api-erp-worker (PM2)
       └──────────────────────────────────│ chunked bulk│
                                          │  upsert via │
                                          │ Prisma.sql  │
                                          └─────────────┘
```

### Struktur Folder Wajib

```
src/module/application/[module]/[feature]/import/
├── import.schema.ts          ← Zod row schema + DTO (HEADER KEYS = uppercase)
├── import.service.ts         ← preview, execute (lock + enqueue), getStatus, getPreview
├── import.controller.ts      ← thin layer, status 201/202/200 sesuai aksi
├── import.routes.ts          ← /preview, /preview/:id, /execute, /status/:id
├── queue/
│   ├── [feature]-import.queue.ts    ← `new Queue<JobData>(NAME, { connection, defaultJobOptions })`
│   └── [feature]-import.worker.ts   ← `new Worker(NAME, handler, { concurrency, lockDuration })`
└── bulk/
    └── bulk.upsert.ts        ← `bulkUpsertX(chunk, maps)` + `chunkArray(arr, size)`
```

### Konfigurasi Global

- **`src/config/queue.ts`** — Tunggal untuk seluruh modul. Definisikan `bullConnection` (Redis) + konstanta nama queue per modul. Saat `NODE_ENV === "test"` queue name di-prefix `test-` agar tidak bocor ke staging.
- **`src/worker.ts`** — Entry point worker. **Setiap queue baru wajib didaftarkan di sini** lewat `createXImportWorker()`. Worker process membaca semua koneksi (Prisma, Redis) sendiri agar terisolasi dari API process.
- **`ecosystem.config.cjs`** — Dua app PM2 wajib jalan: `api-erp` (HTTP) + `api-erp-worker` (BullMQ consumer). **Worker tidak boleh digabung** ke API process.

### Step-by-Step

1. **Schema row dengan HEADER UPPERCASE** (di `import.schema.ts`):
   ```ts
   export const FGImportRowSchema = z.object({
       "PRODUCT CODE": z.string().min(1).max(100),
       "PRODUCT NAME": z.string().min(1).max(200),
       TYPE: z.string().min(1).max(100),
       SIZE: z.preprocess(sanitizeNumber, z.coerce.number().positive()),
       // ...
   });
   ```
   **Key Zod harus identik dengan header CSV yang user upload _dan_ header CSV yang di-export** (lihat §1.I). Konstanta header diekspor agar export module bisa reuse.

2. **Preview** (`POST /import/preview`):
   - Controller: parse file via `ParseCSV(buffer)` / `ParseXLSX(buffer)`. Tolak `>MAX_ROWS` → **413**.
   - Service: parsing per-row (errorRow jika gagal Zod), generate `import_id = randomUUID()`, simpan payload ke `ImportCacheService.save(PREFIX, import_id, { total, valid, invalid, rows })`.
   - Response: **201** + `{ import_id, total, valid, invalid }`.

3. **Get Preview** (`GET /import/preview/:import_id`):
   - Ambil dari Redis cache. Jika sudah expired/tidak ada → **404**.
   - Response: **200** + rows + meta. Frontend pakai untuk render preview table sebelum confirm.

4. **Execute** (`POST /import/execute`):
   - Acquire Redis lock: `SET PREFIX:lock:<id> 1 EX 60 NX`. Gagal → **409** "Import sedang diproses".
   - Ambil cache → kalau kosong → **400**.
   - `valid <= 0` → **400**.
   - `enqueueXImport(import_id)` (return job).
   - Response: **202** + `{ import_id, jobId, state: "queued" }`.
   - **Pada catch block, lepas lock** sebelum re-throw.

5. **Get Status** (`GET /import/status/:import_id`):
   - `queue.getJob(import_id)` → kalau null → **404**.
   - `job.getState()` + `job.progress` (number 0–100).
   - State terminal (`completed` / `failed`) → cleanup lock + sertakan `result` atau `failedReason` + `attemptsMade`.
   - Response: **200**.

6. **Worker** (`queue/[feature]-import.worker.ts`):
   - `concurrency: 1`, `lockDuration: 60_000` — naikkan jika job ekspektasi >60s, tapi pertahankan concurrency 1 per worker untuk hindari race di master data lookup.
   - Handler: ambil cache, **dedupe by unique key** (mis. `code`), kumpulkan unique master lookups (type, size, supplier, dst.) → upsert sekali dengan `Promise.all` di dalam `$transaction`.
   - Chunk rows (`CHUNK_SIZE = 500`), loop `bulkUpsertProducts(chunk, maps)` + `await job.updateProgress(pct)`.
   - `defaultJobOptions`: `attempts: 3`, `backoff: { type: "exponential", delay: 5000 }`, `removeOnComplete: { age: 3600, count: 100 }`, `removeOnFail: false`.
   - Listener `worker.on("failed", ...)`: log + release lock **hanya jika** attempt terakhir.

7. **Bulk Upsert** (`bulk/bulk.upsert.ts`):
   - Gunakan `Prisma.sql` parameterized + `Prisma.join(values)` + `INSERT ... ON CONFLICT (unique_col) DO UPDATE SET ...`. **Jangan** loop `prisma.x.upsert()` per row.
   - **Larangan**: `Prisma.raw` dengan string concat (SQL injection). Selalu `Prisma.sql`.

### Cleanup & Idempotensi

- Cache preview punya TTL standar; saat job mulai, perpanjang TTL ke `PROCESSING_TTL_SECONDS` agar tidak hilang di tengah eksekusi.
- Selesai sukses: `ImportCacheService.remove()` + `releaseLock()`.
- `jobId: import_id` membuat enqueue idempoten — user double-click `/execute` tidak menghasilkan dua job (BullMQ akan throw / return existing).

### Verifikasi

- `npm test` harus mencakup: preview happy/invalid rows, execute lock conflict (**409**), execute tanpa cache (**400**), status not found (**404**), upload `>MAX_ROWS` (**413**).
- Worker tidak boleh memakai `any` (lihat §1.F). `job.returnvalue` dan `job.progress` di-narrow lewat type guard.
- Test mock Redis & queue lewat `src/test/setup.ts` (queue name otomatis di-prefix `test-`).

---

## 📤 1.I Export CSV + Konsistensi Header dengan Import (SOP)

**Default export = CSV, bukan XLSX.** XLSX hanya dipertahankan jika ada permintaan eksplisit (mis. konsolidasi multi-sheet dengan styling kompleks). Referensi: `fg.service.ts` — `static async export(query)` + konsolidasi report.

### Mengapa CSV

- Round-trip dengan Import (user export → edit Excel → import balik) **tanpa konversi**.
- Tidak ada styling/overhead — file 5–10× lebih kecil dari XLSX.
- Encoding stabil di Excel macOS/Windows lewat UTF-8 BOM + CRLF.

### Aturan Header (KUNCI: konsistensi Export ↔ Import)

> Header yang diexport untuk satu modul **wajib identik (case-sensitive, spasi-sensitive)** dengan key Zod di `import.schema.ts` modul yang sama. User tidak boleh perlu rename kolom saat round-trip.

**Single source of truth.** Definisikan konstanta header di `import.schema.ts` dan reuse di export:

```ts
// import.schema.ts
export const FG_IMPORT_HEADERS = {
    code: "PRODUCT CODE",
    name: "PRODUCT NAME",
    type: "TYPE",
    gender: "GENDER",
    size: "SIZE",
    distribution: "EDAR",
    safety: "SAFETY",
} as const;

export const FGImportRowSchema = z.object({
    [FG_IMPORT_HEADERS.code]: z.string().min(1).max(100),
    [FG_IMPORT_HEADERS.name]: z.string().min(1).max(200),
    [FG_IMPORT_HEADERS.type]: z.string().min(1).max(100),
    // ...
});

// fg.service.ts (export)
import { FG_IMPORT_HEADERS } from "./import/import.schema.js";

const ROUNDTRIP_COLUMNS = [
    { header: FG_IMPORT_HEADERS.code, key: "code", width: 15, id: "code" },
    { header: FG_IMPORT_HEADERS.name, key: "name", width: 40, id: "name" },
    { header: FG_IMPORT_HEADERS.type, key: "type", width: 20, id: "type" },
    { header: FG_IMPORT_HEADERS.gender, key: "gender", width: 12, id: "gender" },
    { header: FG_IMPORT_HEADERS.size, key: "size", width: 10, id: "size" },
    { header: FG_IMPORT_HEADERS.distribution, key: "distribution", width: 12, id: "distribution_percentage" },
    { header: FG_IMPORT_HEADERS.safety, key: "safety", width: 12, id: "safety_percentage" },
];
```

**Konsekuensi**: kolom display-only yang **tidak** ada di import schema (mis. "No", "Lead Time", "Nilai Z", "Status") boleh muncul di export, tapi user yang ingin re-import wajib menghapusnya. Beri tahu lewat kolom `Status` / docs.

**Aturan**:

1. Setiap header yang ada di `import.schema.ts` **harus** muncul di export dengan ejaan persis sama.
2. Setiap kolom export yang bukan dari import schema **wajib** dianotasi sebagai display-only di docs modul.
3. Urutan kolom export sebaiknya mengikuti urutan field di Zod schema agar diff visual mudah.
4. Nilai size/satuan: **kolom `SIZE` berisi angka murni** (mis. `60`) — _bukan_ `"60 ML"`. Unit ditangani oleh schema/service, bukan disisipkan di CSV. Ini agar `z.coerce.number()` di import tidak gagal.
5. Enum (gender, status) di-export dengan token persis yang diterima Zod / `mapGender` (mis. `WOMEN`, `MEN`, `UNISEX`). Jangan terjemahkan ke "Wanita".

### Implementasi CSV

Dua opsi resmi:

#### Opsi A — ExcelJS `csv.writeBuffer()` (default)

Dipakai oleh `fg.service.ts`. Cocok untuk export sederhana dengan header bold visual (efek styling tidak akan masuk ke CSV, tapi konfigurasi tetap dipertahankan untuk konsistensi jika nanti pindah ke XLSX).

```ts
const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet("Data Produk");
sheet.columns = filteredColumns.map(({ header, key, width }) => ({ header, key, width }));
data.forEach((item, idx) => sheet.addRow({ /* … */ }));
return await workbook.csv.writeBuffer(); // returns Buffer
```

#### Opsi B — Manual RFC 4180 (untuk laporan dengan GRAND TOTAL / multi-section)

Dipakai oleh `consolidation.service.ts`. Wajib jika butuh:
- Baris ringkasan (GRAND TOTAL) yang visible di posisi tertentu.
- UTF-8 BOM (`﻿`) eksplisit agar Excel macOS membaca diakritik benar.
- CRLF line ending (`\r\n`).
- Escaping manual (kutip ganda di dalam field) sesuai RFC 4180.

Helper minimum:

```ts
const escape = (val: unknown): string => {
    const s = val == null ? "" : String(val);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const lines: string[] = [];
lines.push(headers.map(escape).join(","));
rows.forEach((row) => lines.push(headers.map((h) => escape(row[h])).join(",")));
lines.push(""); // separator
lines.push(`GRAND TOTAL,${escape(total)}`);

return `﻿${lines.join("\r\n")}`;
```

### Response Headers HTTP (Controller)

```ts
return new Response(buffer, {
    status: 200,
    headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="fg-export-${Date.now()}.csv"`,
    },
});
```

- **MIME**: `text/csv; charset=utf-8` (bukan `application/octet-stream`).
- **Extension file**: selalu `.csv` (frontend tidak boleh menambahkan `.xlsx`).
- **Status**: **200** (export sinkron). Kalau dataset besar dan dipindah ke job async, ikuti pola Import: enqueue → **202** + endpoint download terpisah.

### Batas Aman

- `EXPORT_MAX_ROWS = 50_000` (atau lebih kecil sesuai modul). Lebih dari itu → **400** dengan instruksi pakai filter, atau pindahkan ke pipeline async.
- Hitung row count via `count()` query sebelum render — jangan render dulu lalu cek panjang.

### Verifikasi

- **Round-trip test**: integration test yang `export → parse CSV → feed ke `FGImportRowSchema.safeParse()` → semua row valid`. Wajib ada untuk setiap modul yang punya export + import.
- Type-check (`rtk tsc --noEmit`) hijau.
- Sebelum merge: buka CSV di Excel macOS untuk verifikasi BOM + accents (terutama untuk modul dengan nama vendor non-ASCII).

---

## 🗄️ 1.J Service Layer: Schema, ORM, Raw SQL, dan Anti-Bug (SOP Wajib)

Service adalah satu-satunya layer yang menyentuh database. Salah desain di sini → N+1 query, race condition, SQL injection, atau index miss yang tidak ketahuan sampai produksi melambat. SOP ini mengikat **sebelum** menulis method service baru atau memodifikasi yang ada.

### A. Schema-First: Selalu Cek `prisma/schema.prisma` Sebelum Query

**Setiap kali** menulis `findMany` / `findUnique` / `findFirst` / raw SQL baru, **buka `prisma/schema.prisma`** dan jawab dua pertanyaan:

1. Apakah kolom yang ada di `where` / `orderBy` / `join` sudah ada index (`@@index`, `@unique`, `@id`, atau composite `@@unique`)?
2. Apakah selectivity index masuk akal untuk pola query baru? (mis. filter `status = 'ACTIVE'` di tabel 10jt row → index `status` saja tidak cukup, butuh composite `[status, updated_at]`.)

**Bila jawaban "tidak"** — tambahkan `@@index` di model **dan** generate migration **sebelum** merge. Jangan tunda dengan "nanti optimize".

| Pola query                                                    | Index minimum yang wajib ada                                       |
| :------------------------------------------------------------ | :----------------------------------------------------------------- |
| `where: { unique_column: x }`                                 | `@unique` di kolom tsb (Prisma auto-create).                       |
| `where: { fk_id: x }`                                         | `@@index([fk_id])` di model child.                                 |
| `orderBy: { updated_at: "desc" }` di list dengan pagination   | `@@index([updated_at])` (atau composite kalau ada filter).         |
| `where: { status: x }` + `orderBy: { updated_at }`            | `@@index([status, updated_at])` (composite, urutan = filter→sort). |
| `where: { deleted_at: null }` (soft delete pattern)           | `@@index([deleted_at])` — partial index PostgreSQL lebih ideal.    |
| `where: { name: { contains: q, mode: "insensitive" } }`       | Trigram GIN: `CREATE INDEX … USING GIN (name gin_trgm_ops)`.        |
| `where: { name: { startsWith: q } }`                          | B-tree biasa cukup (anchored prefix sargable).                     |

**Migration untuk index baru** (lewat `prisma migrate dev --create-only` lalu edit kalau butuh raw SQL seperti GIN):

```sql
-- prisma/migrations/<ts>_add_rm_search_indexes/migration.sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "raw_materials_name_trgm" ON "raw_materials" USING GIN (name gin_trgm_ops);
```

### B. ORM Default, Raw SQL Hanya untuk Optimasi yang Terukur

**Default = Prisma Client** (type-safe, mendukung relation include, auto-prepared statement). Pindah ke `$queryRaw` / `$executeRaw` **hanya kalau salah satu dari**:

1. ORM menghasilkan query yang **demonstrably** lebih lambat (sudah `EXPLAIN ANALYZE`-kan dan bandingkan).
2. Butuh fitur SQL yang Prisma tidak ekspos (window function, `ON CONFLICT … DO UPDATE`, CTE recursive, full-text search dengan ranking, `unnest` array param).
3. Bulk operation (>100 row) yang ORM-nya N+1 atau memicu transaction timeout.

**Bila pakai raw SQL, semua aturan ini berlaku tanpa kecuali**:

| Aturan                            | Wajib                                                                                 | Anti-pattern                                                |
| :-------------------------------- | :------------------------------------------------------------------------------------ | :---------------------------------------------------------- |
| **Parametrize semua input**       | `prisma.$queryRaw\`… WHERE id = ${id}\`` (tagged template — Prisma auto-bind)         | `prisma.$queryRawUnsafe(\`… WHERE id = ${id}\`)` (SQL injection) |
| **Tipe hasil eksplisit**          | `prisma.$queryRaw<Array<{ id: number; name: string }>>\`…\``                          | `prisma.$queryRaw<any[]>`                                   |
| **Identifier whitelist**          | Validasi `sortBy` lewat `z.enum([...])` sebelum disisipkan via `Prisma.sql`            | Interpolasi string `${sortBy}` ke nama kolom mentah         |
| **Array param**                   | `${Prisma.join(values)}` atau `${ids}::int[]` + `ANY(...)`                            | Loop `for (const id of ids) await tx.$executeRaw\`…\``       |
| **Cocokkan tipe dengan Prisma**   | Cast eksplisit `::"STATUS"`, `::int[]`, `::text[]`, `::numeric` di SQL                | Andalkan auto-cast PostgreSQL — bisa gagal di driver.       |
| **Selalu di dalam `$transaction`**| Untuk multi-statement upsert (mis. reset preferred → insert ON CONFLICT)              | Dua `$executeRaw` berurutan di luar transaction              |
| **Komentar 1 baris**              | Jelaskan **alasan pakai raw** + skema yang disentuh (untuk reviewer + future-you)     | Raw SQL panjang tanpa konteks                                |

**Contoh: bulk upsert dengan `unnest` + `ON CONFLICT` (lihat `inventory/rm/import/queue/rm-import.worker.ts`)**:

```ts
// unnest 4 array sejajar → 1 INSERT, hindari N+1; ON CONFLICT (slug) bikin upsert idempotent.
const upserted = await tx.$queryRaw<Array<{ id: number; slug: string }>>`
    INSERT INTO suppliers (name, slug, addresses, country, source, created_at, updated_at)
    SELECT t.name, t.slug, ${DEFAULT_ADDRESS}, t.country, t.source::"RawMaterialSource", NOW(), NOW()
    FROM unnest(
        ${names}::text[],
        ${slugs}::text[],
        ${countries}::text[],
        ${sources}::text[]
    ) AS t(name, slug, country, source)
    ON CONFLICT (slug) DO UPDATE SET
        source = EXCLUDED.source,
        country = EXCLUDED.country,
        updated_at = NOW()
    RETURNING id, slug
`;
```

**Aturan baca**: setiap baris raw SQL harus bisa dibaca tanpa stack trace mental. Bila >20 baris dan kompleks, pecah jadi helper function dengan nama deskriptif (`bulkUpsertRawMaterials`, `backfillSupplierSlugs`).

### C. Service yang Optimal, Simple, dan Mudah Dibaca

Service yang baik **terbaca dalam 1 napas**. Optimasi tidak berarti rumit — sering kali optimasi = menghapus query dan loop.

**Aturan readability**:

1. **Top-down**: handler publik di atas, helper privat di bawah. Reviewer baca file dari atas → langsung paham flow.
2. **Helper privat eksplisit**: `private static toDTO(row)`, `private static normalizeX(input)`, `private static rethrowPrismaError(e)`. Jangan inline mapping panjang di tengah `create` / `update`.
3. **Satu `$transaction` per request**: kumpulkan semua mutasi terkait di dalam satu `prisma.$transaction(async (tx) => { … })` — jangan beberapa transaction berurutan.
4. **Early-return validasi**: cek ID exist / state valid **sebelum** masuk transaction. `findUnique({ where, select: { id: true } })` jauh lebih murah daripada rollback transaction yang sudah berjalan.
5. **`select` hemat**: gunakan `select` (atau `Prisma.<Model>Select satisfies`) untuk read-only path. `include` hanya kalau benar-benar butuh seluruh row + relasi.
6. **Konstanta bermakna**: `EXPORT_MAX_ROWS = 50_000`, `CHUNK_SIZE = 500`, `LOCK_TTL_SECONDS = 60`. Bukan magic number tersebar.
7. **Nama method = nama domain**: `bulkStatus`, `clean`, `restore`, `getPreview` — bukan `doUpdate2`, `handleStuff`.
8. **`satisfies` untuk shape**: `const INCLUDE = { … } satisfies Prisma.RawMaterialInclude;` — tetap typed tanpa lebar literal hilang.

**Anti-pattern**:

| Anti-pattern                                                    | Fix                                                                          |
| :-------------------------------------------------------------- | :--------------------------------------------------------------------------- |
| 200 baris method dengan 5 level if nested                       | Pecah ke helper privat. Setiap helper < 40 baris.                            |
| `prisma.x.findMany(...)` lalu `for (const r of rows) prisma.y…` | Lihat §1.J.D — ini N+1. Gabungkan via `include` atau bulk fetch dengan `IN`. |
| Mapping field di tengah handler (`return { id: row.id, … }` 30 baris) | Pindah ke `private static toDTO(row): ResponseDTO`.                  |
| Magic number `50000`, `300`, `60` di tengah code                | `const EXPORT_MAX_ROWS = 50_000;` di top-of-file.                             |
| `try/catch` membungkus seluruh method tanpa narrow              | `try` hanya di sekitar operasi yang spesifik gagal; lempar `ApiError` typed. |
| `as any` di tengah service                                      | Lihat §1.F — pakai tipe Prisma generated atau type literal eksplisit.        |

### D. Anti-Bug: N+1, Race Condition, dan Teman-temannya

Bug-bug ini **diam-diam** di test (test pakai 2 row) tapi membakar production (10rb row). Wajib dicek sebelum merge.

#### D.1 N+1 query

**Gejala**: loop yang setiap iterasi panggil DB.

```ts
// ❌ ANTI: N+1 — 1 query list + N query detail per row
const products = await prisma.product.findMany();
for (const p of products) {
    p.type = await prisma.productType.findUnique({ where: { id: p.type_id } });
}

// ✅ Cara 1 — gunakan include (1 query JOIN)
const products = await prisma.product.findMany({ include: { product_type: true } });

// ✅ Cara 2 — kalau JOIN tidak cocok (relasi banyak / opsional), batch dengan IN
const products = await prisma.product.findMany();
const typeIds = [...new Set(products.map((p) => p.type_id).filter(Boolean))];
const types = await prisma.productType.findMany({ where: { id: { in: typeIds } } });
const typeMap = new Map(types.map((t) => [t.id, t]));
// merge in memory → O(N) tanpa query tambahan
```

**Wajib cek**: tiap `for`/`map`/`forEach` yang isinya `await prisma.*` = N+1. Refactor ke include / batch.

#### D.2 Race condition (TOCTOU — Time Of Check, Time Of Use)

**Gejala**: cek dulu lalu mutasi — antara cek & mutasi, request lain bisa menyelip.

```ts
// ❌ ANTI: TOCTOU — request paralel sama-sama lolos cek, lalu duplikat
const existing = await prisma.product.findFirst({ where: { code: body.code } });
if (existing) throw new ApiError(400, "Kode sudah dipakai");
return prisma.product.create({ data: body });  // P2002 race-prone

// ✅ Cara 1 — Race-safe: andalkan unique constraint, tangkap P2002
try {
    return await prisma.product.create({ data: body });
} catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ApiError(400, "Kode sudah dipakai");
    }
    throw e;
}

// ✅ Cara 2 — Untuk decrement stock / counter: gunakan atomic update, bukan read-modify-write
await prisma.product.update({
    where: { id, stock: { gte: qty } },   // guard via where
    data: { stock: { decrement: qty } },
});
```

**Pola race-safe yang wajib dipakai**:

- **Unique violation**: tangkap `P2002` daripada pre-check `findFirst`.
- **Counter / stock**: `{ decrement: n }` / `{ increment: n }` + guard `where: { stock: { gte: n } }` — atomic di SQL.
- **Lock proses (BullMQ, import session)**: Redis `SET key val EX ttl NX` — return `"OK"` artinya dapat lock; release di `finally`.
- **Read-then-write yang complex**: bungkus dalam `prisma.$transaction` dengan `isolationLevel: "Serializable"` kalau benar-benar butuh — biasanya level default cukup kalau pakai unique constraint.

#### D.3 Cross-table consistency

**Gejala**: dua tabel terkait, hanya satu yang ter-update saat error.

```ts
// ❌ ANTI: dua mutasi tidak atomic
await prisma.order.create({ data: order });
await prisma.stockMovement.create({ data: movement });   // gagal → order yatim

// ✅ Wajib: satu transaction
await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({ data: orderData });
    await tx.stockMovement.create({ data: { ...movement, order_id: order.id } });
    return order;
}, { maxWait: 5_000, timeout: 30_000 });
```

#### D.4 Implicit transaction timeout di bulk operation

**Gejala**: import 5000 row → `Transaction API error: Transaction already closed`.

```ts
// ❌ ANTI: 1 transaction untuk semua chunk → timeout default 5s
await prisma.$transaction(async (tx) => {
    for (const row of allRows) await tx.raw.create({ data: row });
});

// ✅ Pecah ke chunk, transaction per chunk + timeout eksplisit
const chunks = chunkArray(rows, 500);
for (const chunk of chunks) {
    await prisma.$transaction(
        async (tx) => bulkUpsertRawMaterials(tx, chunk, maps),
        { maxWait: 60_000, timeout: 120_000 },
    );
}
```

#### D.5 Serial promise yang seharusnya paralel

```ts
// ❌ ANTI: serial — 3x latency
const unitId = await getOrCreateSlug(tx.unit, body.unit);
const categoryId = await getOrCreateSlug(tx.category, body.category);
const supplierIds = await upsertSuppliers(tx, body.suppliers);

// ✅ Paralel — Promise.all (tetap dalam 1 transaction)
const [unitId, categoryId, supplierIds] = await Promise.all([
    getOrCreateSlug(tx.unit, body.unit),
    getOrCreateSlug(tx.category, body.category),
    upsertSuppliers(tx, body.suppliers),
]);
```

**Catatan**: paralel **hanya** aman bila operasi tidak menulis ke row yang sama. Bila iya, harus serial untuk hindari deadlock.

#### D.6 Forgotten `await`

```ts
// ❌ ANTI: tanpa await → unhandled promise + race ke response
prisma.logging.create({ data: log });    // return Promise yang dilempar ke event loop
return ApiResponse.sendSuccess(c, data);

// ✅ Tunggu sebelum return
await prisma.logging.create({ data: log });
return ApiResponse.sendSuccess(c, data);
```

ESLint rule `@typescript-eslint/no-floating-promises` wajib aktif di config — bila tidak, scan manual.

### E. Verifikasi Sebelum Commit

1. **Buka `prisma/schema.prisma`** — pastikan kolom di `where` / `orderBy` baru sudah ada `@@index` / `@unique`. Bila belum, tambahkan + migration.
2. **Grep N+1 candidates**: `grep -nE "for .*await|map.*async.*await" src/module/application/<scope>/`. Tiap match harus dijustifikasi (atau di-refactor jadi `include` / batch `IN`).
3. **`EXPLAIN ANALYZE`** untuk query baru di endpoint list/search high-traffic — pastikan plan pakai index (`Index Scan`, bukan `Seq Scan` di tabel besar).
4. **`rtk tsc --noEmit`** hijau — terutama untuk raw SQL yang tipe row-nya manual.
5. **Test race condition**: kalau ada unique constraint baru, tulis 1 integration test yang fire 2 request paralel — harus 1 sukses + 1 error 400 (bukan crash / duplikat).
6. **Cek lock & transaction**: setiap `acquireLock` punya `releaseLock` di `finally`. Setiap `$transaction` panjang punya `timeout` eksplisit.

---

## 🧪 2. Fase Testing (Vitest)

Setelah seluruh lapisan backend (Service, Controller, Routes) selesai dibuat, tulis unit test dan integration test **sebelum** melanjutkan ke Frontend. Ini memastikan kontrak API stabil dan bug tertangkap lebih awal.

### A. Struktur Folder Testing

Semua file test diletakkan di folder **terpisah** `api/src/tests/[feature]/` agar tidak bercampur dengan source code modul.

```
api/src/
├── module/
│   └── application/
│       └── [feature]/         ← Source code (service, controller, routes, schema)
│           ├── [feature].service.ts
│           ├── [feature].controller.ts
│           └── ...
└── tests/                     ← Semua test files (TERPISAH dari module)
    ├── [feature]/
    │   ├── [feature].service.test.ts   ← Unit test: business logic
    │   └── [feature].routes.test.ts    ← Integration test: API endpoints
    └── ...
```

### B. Setup Global (`src/test/setup.ts`)

File `setup.ts` berisi mock global yang di-load sebelum setiap test suite:

- **Mock `env`**: Menyediakan variabel lingkungan dummy agar `envalid` tidak memanggil `process.exit`.
- **Mock `prisma`**: Menggantikan semua operasi database dengan `vi.fn()` bereturn value yang terdefinisi.
- **Mock `redis`**: Menggantikan koneksi Redis (termasuk `keys`, `get`, `set`, dll.).
- **Mock `logger`**: Mencegah output log selama test berjalan.

Konfigurasi setup file didaftarkan di `vitest.config.ts`:

```ts
test: {
    setupFiles: ["./src/test/setup.ts"],
}
```

### C. Unit Test – Service (`[feature].service.test.ts`)

Tujuan: Menguji business rule dan logika data **secara terisolasi** tanpa HTTP layer.

```ts
// Contoh: src/tests/product/product.service.test.ts
describe("ProductService", () => {
  it("should throw error if product code already exists", async () => {
    prisma.product.findUnique.mockResolvedValue({ id: 1 });
    await expect(ProductService.create(body)).rejects.toThrow(ApiError);
  });
});
```

**Yang diuji per service:**

- `create`: duplikasi kode, sukses create via `$transaction`
- `list`: hasil raw SQL + konversi BigInt count
- `detail`: data ditemukan, data tidak ditemukan (404)
- `status`: update status via `product.update`

### D. Integration Test – Routes (`[feature].routes.test.ts`)

Tujuan: Menguji seluruh alur HTTP — dari request Hono → middleware → controller → service — menggunakan `app.request()`.

```ts
// Contoh: src/tests/product/product.routes.test.ts
it("GET /api/app/products should return 200", async () => {
  const res = await app.request("/api/app/products", { method: "GET" });
  expect(res.status).toBe(200);
  expect((await res.json()).status).toBe("success");
});
```

**Mock tambahan di file routes test:**

- `../../config/redis.js` — langsung di dalam file test (bukan hanya setup) agar menimpa mock `Cache.invalidateList` dengan benar.
- `hono/cookie` — agar `getCookie` mengembalikan session ID dummy.
- `../../middleware/csrf.js` — bypass CSRF validation selama test.

### E. Menjalankan Test

```bash
# Semua test
npm test

# Test file spesifik
npm test src/tests/product/product.service.test.ts

# Watch mode (development)
npx vitest
```

---
