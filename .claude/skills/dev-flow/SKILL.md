---
name: dev-flow
description: Full Stack Development Flow untuk ERP Mandalika. Panduan end-to-end dari Backend (Prisma, Zod, service, controller, route) ke Frontend (DTO, query/mutation hooks, komponen). Gunakan saat memulai fitur baru atau ingin mengikuti standar arsitektur proyek ini.
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
