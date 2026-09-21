# Raw Material Import API

Base path: `/api/app/rawmat/import`. Endpoint mengikuti autentikasi middleware Raw Material.

## `POST /preview`

Request `multipart/form-data` dengan field `file` CSV/XLSX. Response berisi `import_id`, jumlah total, valid, dan invalid.

Header CSV utama: `BARCODE`, `MATERIAL NAME`, `CATEGORY`, `UOM`, `SUPPLIER`, `PRICE`, `MOQ`, `MIN STOCK`, dan `LEAD TIME`.

- `LOCAL/IMPORT` atau `SOURCE`: `LOCAL`/`LOKAL` atau `IMPORT`.
- `COUNTRY` atau `NEGARA`: negara supplier.
- `SUPPLIER` berbentuk `SUP-001` sampai `SUP-999`, atau `SUP1000` sampai `SUP9999`, adalah kode anonimisasi dan didecode menjadi `supplier_id`. Nama supplier biasa tetap dicocokkan memakai slug.

## `GET /preview/:import_id`

Menampilkan baris hasil preview. Error validasi berada pada `rows[].errors`.

## `POST /execute`

Body JSON:

```json
{ "import_id": "uuid" }
```

Membuat atau memperbarui Raw Material berdasarkan barcode, lalu upsert relasi `supplier_materials`.

Error: kode supplier anonimisasi tanpa supplier ID menghasilkan error `Supplier dengan kode SUP-... tidak ditemukan`; import dibatalkan dan supplier baru tidak dibuat.

Data cleanup 2026-09-21: 28 supplier kode palsu dan 371 relasi `supplier_materials` duplikat dipindahkan ke supplier kanonis atau dihapus bila relasi kanonis sudah ada. PO, RFQ, dan utang tidak dihapus.
