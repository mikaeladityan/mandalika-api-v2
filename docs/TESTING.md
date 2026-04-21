# Technical Guide: Testing & Stabilization

Dokumen ini menjelaskan strategi pengujian (testing) dan stabilisasi yang diterapkan pada backend ERP v0.1.1 menggunakan **Vitest**.

---

## 1. Arsitektur Testing
Sistem menggunakan pendekatan **Isolated Testing** dengan mocking data yang agresif untuk memastikan tes dapat berjalan secara instan tanpa membutuhkan database nyata (SQLite/PostgreSQL).

### Perangkat Utama:
- **Vitest**: Test runner utama.
- **Hono Testing**: Menggunakan `app.request` untuk API integration testing.
- **Prisma Mocking**: Menggunakan Mock Factory untuk menggantikan `prisma client`.

---

## 2. Strategi Mocking (The Mega Mock Pattern)

Untuk menghindari error `TypeError: Cannot read properties of undefined` pada transaksi kompleks, kita menggunakan pola **Mega Mock** terpusat di setiap file tes.

### Contoh Implementasi:
```ts
vi.mock("../../config/prisma.js", () => {
    const mockPrisma = {
        $transaction: vi.fn(),
        $queryRaw: vi.fn(),
        product: { 
            findUnique: vi.fn(), 
            findMany: vi.fn(), 
            update: vi.fn(), 
            create: vi.fn() 
        },
        // ... model lainnya
    };
    
    // Mock Transaction agar menjalankan callback dengan mock client
    mockPrisma.$transaction.mockImplementation(async (cb) => {
        if (Array.isArray(cb)) return Promise.all(cb);
        return cb(mockPrisma);
    });
    
    return { default: mockPrisma };
});
```

---

## 3. Jenis Testing

### A. Route Integration Test (`routes.test.ts`)
Menguji API endpoint dari HTTP request hingga response.
- **Fokus**: Validasi input (Zod), status code, dan struktur respons API.
- **Mocking**: Semua database dan service level di-mock di level Prisma.

### B. Service Unit Test (`service.test.ts`)
Menguji logika bisnis di level kelas Service.
- **Fokus**: Kalkulasi stok, transisi status, dan integrasi antar model.
- **Mocking**: Prisma client di-mock untuk mensimulasikan berbagai skenario data.

---

## 4. Cara Menjalankan Tes

Pastikan `/usr/local/bin` ada di PATH sistem Anda jika menggunakan lingkungan macOS tertentu.

```bash
# Menjalankan semua tes
npm run test

# Menjalankan modul tertentu (misal: Manufacturing)
npm run test src/tests/manufacturing

# Menjalankan file secara spesifik
npm run test src/tests/rawmat/rawmat.routes.test.ts
```

---

## 5. Checklist Stabilisasi
Setiap penambahan fitur baru harus menyertakan tes yang mencakup:
1.  **Success Case**: Respons 200/201 dengan payload lengkap.
2.  **Validation Case**: Respons 400 saat input skema Zod tidak valid.
3.  **Edge Case**: Respons 404 saat data tidak ditemukan di mock database.
4.  **Transaction Consistency**: Memastikan `$transaction` berjalan lancar tanpa `unhandled rejection`.
