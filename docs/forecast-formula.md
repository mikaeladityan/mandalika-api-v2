# Forecast: rumus dan perlindungan periode historis

Engine mengelompokkan produk per aroma dan mengenali keluarga EDP/EXT serta
Parfum/Parfume Intense dari slug jenis produk, bukan awalan kode produk.

- **Main Bottle (PP/PW/PU, 100/110/120 ml):** jumlah rata-rata issuance botol
  EDP/EXT + Parfum selama 3 bulan sebelum periode awal, lalu tambahkan Growth
  bulan tersebut dan bagi ke varian menggunakan persentase EDAR botol.
- **Vial (V2, 2 ml):** jumlah rata-rata issuance Vial EDP/EXT + Parfum selama
  3 bulan sebelum periode awal, lalu tambahkan Growth dan bagi menggunakan
  persentase EDAR Vial. Vial tidak mengambil dasar dari botol atau Atomizer.
- **Atomizer:** total Main Bottle setelah Growth, sebelum pembagian EDAR dan
  pengurangan stok. Issuance Atomizer tidak menjadi dasar perhitungan.

```text
Total botol M1 = (Σ issuance botol M−1..M−3 ÷ 3) × (1 + Growth M1)
Total vial M1  = (Σ issuance vial M−1..M−3 ÷ 3) × (1 + Growth M1)
Forecast varian = Total kelompok × EDAR varian
Forecast Atomizer = Total botol
Total kelompok M2 = Total kelompok M1 × (1 + Growth M2)
```

Total botol dan Vial diteruskan secara terpisah ke bulan berikutnya sebelum
EDAR dan stok dialokasikan. Bulan tanpa issuance tetap termasuk pembagi 3.
Mode ACUAN memakai rumus yang sama dengan persentase distribusi ACUAN;
Vial ACUAN juga memakai issuance Vial sendiri.

`base_forecast` botol/Vial berisi total kelompok setelah Growth, sedangkan
forecast per varian sebelum stok disimpan dalam field legacy `net_forecast`
dan ditampilkan sebagai `gross_forecast`. `final_forecast` adalah kebutuhan
setelah sisa stok tahap Need Produce dialokasikan berurutan ke tiap bulan, per produk.

```text
Need Produce = Maks(0, gross_forecast M1 − stok awal FG)
Sisa stok awal Forecast = Maks(0, stok awal FG − gross_forecast M1)
final_forecast bulan = Maks(0, gross_forecast bulan − sisa stok)
Sisa stok berikutnya = Maks(0, sisa stok − gross_forecast bulan)
```

Alokasi Forecast dimulai lagi pada M1 menggunakan sisa stok tahap Need Produce.
Jika Need Produce positif, Forecast M1 memakai angka Need Produce tersebut;
stok sudah habis dan Forecast M2..Mn memakai permintaan bulanan penuh.
Contoh stok 1.500 dan gross M1..M4 = 500, 300, 200, 500: Need Produce 0,
sisa stok awal Forecast 1.000, dan final M1..M4 = 0, 0, 0, 500.

Aturan existing tetap berlaku: input awal botol mencakup anchor reguler dan
Hampers dalam aroma yang sama; botol reguler menyalin forecast Hampers jika
tersedia. Salinan tersebut tidak dijumlahkan lagi sebagai dasar pertumbuhan
bulan berikutnya. Vial tidak menyalin forecast botol/Hampers. Produk `PENDING`
menghasilkan nol, tetapi issuance historisnya tetap termasuk total kelompok
awal. Forecast berhenti saat Growth suatu bulan kosong atau bernilai nol.

Perubahan rumus berlaku saat menjalankan ulang Forecast. Record lama tidak
otomatis dihitung ulang ketika kode engine berubah.

### Batas periode penulisan

Run Forecast hanya menulis bulan berjalan (M Now) hingga horizon ke depan,
berdasarkan kalender **Asia/Jakarta**. Jika request mengirim bulan lampau,
engine memulai dari bulan berjalan dengan panjang horizon yang sama; pilihan
bulan mulai di masa depan tetap dihormati. Respons `period` dan activity log
menunjukkan periode awal yang benar-benar digunakan. Dasar issuance 3 bulan
dan stok awal dimuat berdasarkan periode awal tersebut.

Batas ini berlaku untuk batch Run, Run per produk, dan rerun setelah perubahan
EDAR/status produk. Safety Stock yang dihasilkan Run juga hanya ditulis untuk
periode berjalan/ke depan. Forecast dan Safety Stock bulan lampau tidak ikut
upsert atau dihitung ulang.

Edit manual untuk bulan lampau ditolak. Alokasi ulang stok setelah edit manual
hanya mengambil dan menulis seri forecast bulan berjalan/ke depan dengan stok
awal seri tersebut; record historis beserta alokasi stoknya tetap tersimpan.
