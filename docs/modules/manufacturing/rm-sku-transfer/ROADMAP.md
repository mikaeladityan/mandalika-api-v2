# Roadmap: RM SKU Transfer

## Deskripsi Modul
Modul **Pindah SKU Stock RM** dirancang khusus untuk menangani perpindahan saldo stok antara dua SKU Raw Material yang berbeda dalam satu gudang yang sama. Fitur ini sangat berguna untuk kasus seperti botol produksi yang dipindahkan kategorinya menjadi botol display atau sebaliknya, di mana secara fisik barangnya sama namun secara SKU berbeda di sistem.

## Alur Bisnis
1. **Pemilihan Lokasi**: User memilih gudang tempat stok berada (khusus tipe `RAW_MATERIAL`).
2. **Pemilihan SKU**: User memilih RM Asal (sumber stok) dan RM Tujuan (penerima stok).
3. **Input Quantity**: User memasukkan jumlah yang akan dipindahkan.
4. **Validasi**: Sistem memastikan RM Asal dan Tujuan tidak sama, dan stok di RM Asal mencukupi.
5. **Eksekusi Transaksi**:
    - Saldo stok RM Asal dikurangi.
    - Saldo stok RM Tujuan ditambah.
    - Pencatatan log pergerakan stok untuk kedua belah pihak.
6. **Audit Trail**: Semua aktivitas dicatat sebagai "Pergerakan RM Stock" dengan tipe "STOCK_ADJUSTMENT".

## Detail Implementasi Service (`RmSkuTransferService.transfer`)
- **Input**: `source_rm_id`, `target_rm_id`, `warehouse_id`, `quantity`, `notes`.
- **Output**: Objek hasil transfer (source & target movement).
- **Business Rule**:
    - Menggunakan Prisma `$transaction` untuk menjamin atomisitas (keduanya sukses atau keduanya gagal).
    - Memanfaatkan `InventoryHelper` untuk konsistensi logika pengurangan/penambahan stok di level database.
    - Menambahkan catatan audit otomatis yang menjelaskan asal dan tujuan perpindahan.

## Relasi Tabel Prisma
- `RawMaterial`: Master data produk bahan baku.
- `Warehouse`: Master data lokasi penyimpanan.
- `RawMaterialInventory`: Saldo stok per RM per gudang.
- `StockMovement`: Catatan riwayat masuk/keluar stok (Audit Trail).
