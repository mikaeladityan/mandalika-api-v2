# 🖥️ Frontend Integration Guide: Outlets & Inventory Control

Dokumen ini adalah panduan spesifik bagi tim Frontend untuk mengimplementasikan fungsionalitas **Outlet**, **Stock Transfer**, dan **Stock Movement** dari sisi klien (UI). Integrasi ini dioptimalkan untuk pergerakan **Finish Goods (Produk Jadi)** dari Warehouse ke Outlet.

---

## 1. Arsitektur & Struktur Kode Backend
Penting untuk memahami letak logic di Backend untuk mendiagnosis request/response atau jika dibutuhkan modifikasi di masa mendatang.

* **Letak File:** `api/src/module/application/`
* **Polanya:** 
  * `*.schema.ts` — Berisi Zod Validation Rules. Selalu samakan payload JSON form UI dengan `ZodSchema` yang didefinisikan disini.
  * `*.controller.ts` — Handler API. Selalu mengirimkan object format konstan via `ApiResponse.sendSuccess`.
  * `*.service.ts` — Business logic murni tempat state transactions direkam.
* **Response Format Dasar (yang Frontend akan terima):**
  ```json
  {
    "status": "success",
    "data": { ... } // Untuk List biasanya "data": { "data": [...list], "meta": {...pagination} }
  }
  ```

---

## 2. Modul Outlet (`/outlets`)
Modul master untuk mendefinisikan lokasi fisik "Toko" beserta integrasi ke Gudang barang jadi.

### 2.1 API yang Digunakan Frontend:
* `GET /api/app/outlets` - Table List & Filter (Gunakan di halaman `index.tsx`)
* `GET /api/app/outlets/:id` - Fetch Data untuk Halaman Detail/Edit Form.
* `POST /api/app/outlets` - Membuat Outlet (Pastikan form Warehouse meng-select yang tipe `FINISH_GOODS` saja di frontend dropdown).
* `PUT /api/app/outlets/:id` - Edit Data Outlet & Alamat.
* `PATCH /api/app/outlets/:id/status` - Switch Button untuk Toggle Active / Inactive.

### 2.2 Tampilan UI:
* **Outlet List:** Tampilkan Badge Status aktif/inaktif. Jika inaktif, beri treatment UI redup.
* **Form Outlet:** Dapat disatukan di 1 komponen. Address dipisahkan section-nya.

---

## 3. Modul Outlet Inventory (`/outlets/:id/inventory`)
Stok real-time per toko. Backend *tidak pernah* memanipulasi stok outlet secara independen kecuali lewat inisialisasi awal.

### 3.1 Flow & API:
* Saat User mendaftarkan SKU baru, front end wajib memanggil: `POST /api/app/outlets/:id/inventory/init` beserta array `product_ids` agar status stokenya 0 di toko tersebut.
* Fitur Utama dari Halaman Detail Outlet adalah Tab "Stok" -> Menampilkan `GET /api/app/outlets/:id/inventory`. Di tabel ini, sediakan fitur **Inline Edit Minimum Stock** yang memanggil `PATCH /api/app/outlets/:id/inventory/:product_id/min-stock`.
* Terdapat badge jika `is_low_stock` == `true` (qty <= min_stock). 

---

## 4. Modul Stock Transfer (`/stock-transfers`)
Proses Mutasi Barang. Di sistem ini, mutasi barang memiliki 4 stages yang dikerjakan runut. Modul ini secara konseptual adalah State Machine. Frontend direkomedasikan membuat view visualisasi stages progres perpindahan barang.

### 4.1 UI Flow - End-to-End:
1. **List Transfer:** Tampilkan `GET /api/app/stock-transfers`. Gunakan pills/chip color untuk tiap Status (`PENDING` = kuning, `SHIPMENT` = biru, `COMPLETED` = hijau).
2. **Halaman Buat Transfer (Create):**
   * UI Memilih Jenis Asal (Dari Gudang `from_type: WAREHOUSE` vs Dari Toko `from_type: OUTLET`).
   * UI Memilih Detail Dropdown (ID Asal & ID Tujuan). Pastikan *From* ≠ *To*.
   * Dynamic Table Input Items: Barcode scannable -> Add to list -> Enter product_id, quantity_requested.
   * Tombol "Submit" -> Memanggil `POST /api/app/stock-transfers`.
3. **Halaman Detail Transfer:**
   * Di atas berisikan informasi nomor TRF, Tipe Transfer, Tanggal, dll.
   * Di bagian tabel *Transfer Item*, perlu disajikan field (dinamis tergantung status): *Requested, Packed, Received, Fulfilled, Missing, Rejected*.

### 4.2 Endpoint State Transition (`PATCH /api/app/stock-transfers/:id/status`):
*Semua update form/action dari UI harus berpusat mengirim update ke endpoint patch tunggal ini. Frontend tinggal menyesuaikan body sesuai tombol action yang diklik*
* **Aksi "Approve" (Manager):** Kirim payload `{ status: "APPROVED" }`
* **Aksi "Pengepakan / Kirim" (Warehouse Staff):** Membuka modal input `quantity_packed`. Payload: `{ status: "SHIPMENT", items: [...] }`.
* **Aksi "Terima Fisik" (Outlet Staff):** Membuka modal input `quantity_received`. Payload `{ status: "RECEIVED", items: [...] }`.
* **Aksi "Pengecekan Detail / Fulfillment" (QC Staff):** 
  * Di UI ini Frontend harus memiliki form field untuk ketiga nilai setiap item: `quantity_fulfilled`, `quantity_missing`, `quantity_rejected`.
  * **PENTING (Validasi Frontend):** Total ke-3 field tersebut **Wajib** = `quantity_received`. Jika user memasukkan invalid summation, halang action-nya.
  * Backend akan mencerna request `status: FULFILLMENT` tersebut dan menyimpulkannya otomatis menjadi status final `COMPLETED`/`PARTIAL`/`MISSING`/`REJECTED`. 

---

## 5. Modul Stock Movement Log (`/stock-movements`)
Log Mutasi Murni — Dibuat otomatis tak terlihat oleh user per aksi transaksi.

### 5.1 Tabel & UI:
Halaman Khusus bernama "Audit Log Mutasi Stok".
* Tabel read-only (`GET /api/app/stock-movements`).
* Jangan ada tombol Edit (karena mutasi ini sifatnya Immutable).
* **Fitur Utama UI:** Sediakan komponen filter lanjutan (Date Picker, Dropdown `movement_type`, dsb) supaya bagian keuangan dapat merekonsiliasi. Jika di-klik baris datanya, berikan opsi untuk routing kembali menuju source reference `reference_id` + `reference_type` (Misalnya dari log "Transfer IN" pindah rute ke Detail View di Stock Transfer modul).
