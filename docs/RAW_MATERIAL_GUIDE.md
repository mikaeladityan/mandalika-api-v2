# 🧱 Raw Material Control Guide

Dokumen ini mengkonsolidasikan seluruh alur, logika bisnis, dan panduan integrasi untuk **Bahan Baku (Raw Materials)** di Mandalika ERP.

---

## 1. Konsep Bahan Baku
Bahan baku dalam sistem ini dikategorikan menjadi beberapa tipe utama yang menentukan bagaimana mereka diperlakukan dalam resep (BOM):
*   **FO (Fragrance Oil)**: Bahan inti parfum. Penggunaannya dalam resep biasanya menggunakan multiplier otomatis berdasarkan ukuran produk.
*   **PCKG (Packaging)**: Botol, tutup, label, box. Biasanya dihitung per unit (pcs).
*   **LOKAL / IMPOR**: Klasifikasi tambahan untuk membedakan sumber pengadaan (mempengaruhi lead time).

---

## 2. Manajemen Inventaris (Warehouse)
Berbeda dengan Outlet yang real-time, stok Bahan Baku di Warehouse dikelola dengan pendekatan **Snapshot**:
*   **Snapshot Bulanan**: Stok dicatat per akhir bulan untuk kebutuhan laporan keuangan dan forecasting.
*   **Safety Stock**: Setiap bahan baku memiliki parameter `z_value` dan `lead_time` untuk menghitung stok aman agar produksi tidak terhenti.
*   **Audit Trail**: Setiap mutasi (PO masuk, produksi keluar, adjustment) wajib tercatat di `StockMovement`.

---

## 3. Alur Pengadaan (Purchase Order)
Proses pengadaan bahan baku mengikuti alur formal:
1.  **Supplier Management**: Master data supplier (kontak, alamat, termin pembayaran).
2.  **Procurement Recommendation**: Sistem memberikan saran jumlah order berdasarkan `Forecast Penjualan - Stok Saat Ini - Open PO`.
3.  **PO Creation**: Membuat draft pesanan ke supplier.
4.  **Approval**: Verifikasi oleh Manager/Owner.
5.  **Receiving**: Input jumlah barang yang benar-benar diterima (mendukung partial receipt). Saat barang diterima, stok di `ProductInventory` (snapshot) akan terupdate otomatis dan log `StockMovement (IN)` dibuat.

---

## 4. Bill of Materials (BOM) & Produksi
Bahan baku dihubungkan ke Produk Jadi melalui Recipe/Formula:
*   **BOM Explosion**: Melihat kebutuhan total bahan baku untuk memenuhi target produksi tertentu.
*   **BOM Implosion**: Melihat dampak jika suatu bahan baku (misal Botol tertentu) stoknya habis, produk apa saja yang akan terganggu produksinya.

---

## 5. Rencana Pengembangan (Pending)
Sesuai arahan, beberapa fitur berikut masih dalam tahap pengembangan atau ditangguhkan:
*   **Warehouse to Warehouse (W→W) Transfer**: Pengiriman bahan baku antar gudang pendukung. Saat ini difokuskan pada gudang utama saja.
*   **Stock Adjustment (RM)**: Fitur opname khusus bahan baku untuk sinkronisasi fisik vs sistem.
*   **Integration with Production**: Link otomatis antara pengurangan stok RM saat produksi selesai.

---

## 6. Referensi Terkait
*   [ENDPOINT.md](file:///Users/mandalika/Documents/erpV2/api/docs/ENDPOINT.md) — Lihat section `Raw Materials`.
*   [FLOW.md](file:///Users/mandalika/Documents/erpV2/api/docs/FLOW.md) — Lihat `Alur Purchase Order`.
*   [SCHEMA.md](file:///Users/mandalika/Documents/erpV2/api/docs/SCHEMA.md) — Detail tabel `RawMaterial`, `PurchaseOrder`, dll.
