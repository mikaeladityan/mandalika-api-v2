# System Flowchart — Mandalika ERP
## All Module Business Flows (v2.0)

**Last Updated:** 2026-03-18
**Render:** https://mermaid.live

---

## 1. Alur Sistem Utama

```mermaid
flowchart TD
    START([User / POS Device]) --> AUTH{Autentikasi}

    AUTH -->|User Login| DASH[Dashboard ERP]
    AUTH -->|POS Token| POS_API[POS API Endpoints]
    AUTH -->|Gagal| ERR[401 Unauthorized]

    DASH --> M1[📦 Gudang & Bahan Baku]
    DASH --> M2[🏪 Outlet Management]
    DASH --> M3[🛒 Purchase Order]
    DASH --> M4[🔄 Stock Transfer]
    DASH --> M5[📋 Stock Adjustment]
    DASH --> M6[📊 Forecasting]
    DASH --> M7[🔔 Alerts]
    DASH --> M8[📈 Reports]

    POS_API --> P1[Sync Transaksi]
    POS_API --> P2[Cek Stok Outlet]
    POS_API --> P3[Sync Katalog Produk]
```

---

## 2. Alur Outlet Management

```mermaid
flowchart TD
    START([Admin/Owner]) --> CREATE[Buat Outlet Baru]
    CREATE --> INPUT[Input: Nama, Kode, Telepon, Alamat]
    INPUT --> SAVE[(Simpan Outlet)]
    SAVE --> ASSIGN_STAFF[Assign Staff/Manager ke Outlet]
    ASSIGN_STAFF --> ENABLE_POS{Aktifkan POS?}

    ENABLE_POS -->|Ya| REG_DEVICE[Daftarkan POS Device]
    REG_DEVICE --> GEN_TOKEN[Generate Device Token JWT]
    GEN_TOKEN --> INSTALL[Install Token di POS Device]
    INSTALL --> READY_POS([POS Siap Digunakan])

    ENABLE_POS -->|Tidak| INIT_STOCK[Inisialisasi Stok Outlet = 0]
    READY_POS --> INIT_STOCK
    INIT_STOCK --> RESUPPLY[Lakukan Stock Transfer\ndari Warehouse ke Outlet]
    RESUPPLY --> OUTLET_ACTIVE([Outlet Aktif & Beroperasi])
```

---

## 3. Alur Purchase Order (PO) — Lengkap

```mermaid
flowchart TD
    START([Purchasing Team]) --> SELECT_SUPPLIER[Pilih Supplier]
    SELECT_SUPPLIER --> SELECT_WH[Pilih Gudang Tujuan]
    SELECT_WH --> ADD_ITEMS[Tambah Item Bahan Baku\n+ Qty + Harga]
    ADD_ITEMS --> MORE{Tambah Item Lagi?}
    MORE -->|Ya| ADD_ITEMS
    MORE -->|Tidak| REVIEW[Review PO]
    REVIEW --> SUBMIT[Submit PO → Status: SUBMITTED]

    SUBMIT --> APPROVE{Manager/Owner\nApprove?}
    APPROVE -->|Tolak| REJECT[Status: REJECTED]
    APPROVE -->|Setuju| APPROVED[Status: APPROVED]
    REJECT --> END1([Selesai])

    APPROVED --> WAIT_GOODS{Barang Datang?}
    WAIT_GOODS -->|Belum| WAIT[Tunggu]
    WAIT --> WAIT_GOODS

    WAIT_GOODS -->|Ya| RECEIVE[Input Qty Diterima per Item]
    RECEIVE --> UPDATE_STOCK[Update RawMaterialInventory\ndi Gudang]
    UPDATE_STOCK --> LOG_MOVE[Log StockMovement\ntype: IN]
    LOG_MOVE --> CHECK_COMPLETE{Semua Item\nTerpenuhi?}

    CHECK_COMPLETE -->|Tidak| STATUS_PARTIAL[Status: PARTIAL\nBisa Terima Lagi Nanti]
    CHECK_COMPLETE -->|Ya| STATUS_DONE[Status: COMPLETED]

    STATUS_PARTIAL --> END2([Selesai — Bisa Receive Lagi])
    STATUS_DONE --> CHECK_REC[Update Recommendation Order\njika ada Open PO terkait]
    CHECK_REC --> END3([Selesai])
```

---

## 4. Alur Stock Transfer — 10 Status (W→W, W→O, O→O, O→W)

```mermaid
flowchart TD
    START([Manager/Staff]) --> FROM[Pilih Sumber:\nWarehouse atau Outlet]
    FROM --> TO[Pilih Tujuan:\nWarehouse atau Outlet]

    TO --> SAME{Sumber = Tujuan?}
    SAME -->|Ya| ERROR[Error: Lokasi harus berbeda]
    ERROR --> FROM

    SAME -->|Tidak| ADD_ITEMS[Pilih Produk + Input Qty]
    ADD_ITEMS --> CHECK_STOCK{Stok Sumber\nCukup per Item?}
    CHECK_STOCK -->|Tidak| WARN[Warning: Stok Tidak Cukup]
    WARN --> ADD_ITEMS
    CHECK_STOCK -->|Ya| PENDING_ST[Simpan Transfer\nStatus: PENDING]

    PENDING_ST --> APPROVE{Disetujui?}
    APPROVE -->|Tidak| CANCELLED[Status: CANCELLED]
    APPROVE -->|Ya| APPROVED_ST[Status: APPROVED]

    APPROVED_ST --> CANCEL2{Batalkan\nsebelum kirim?}
    CANCEL2 -->|Ya| CANCELLED
    CANCEL2 -->|Tidak| PACK[Input Qty Dikemas\nper Item]
    PACK --> SHIPMENT_ST[Status: SHIPMENT\nKurangi Stok Sumber]
    SHIPMENT_ST --> LOG_OUT[Log StockMovement\nTRANSFER_OUT per Item]

    LOG_OUT --> ARRIVAL[Barang Tiba di Tujuan\nInput Qty Diterima per Item]
    ARRIVAL --> RECEIVED_ST[Status: RECEIVED]

    RECEIVED_ST --> CHECK_ITEMS[Proses Pengecekan Barang\nper Item]
    CHECK_ITEMS --> FULFILLMENT_ST[Status: FULFILLMENT\nInput qty_fulfilled, qty_missing, qty_rejected]

    FULFILLMENT_ST --> RESULT{Hasil\nKeseluruhan}
    RESULT -->|Semua item sempurna\nmissing=0, rejected=0| COMPLETED[Status: COMPLETED]
    RESULT -->|Qty fulfilled\nkurang dari requested| PARTIAL[Status: PARTIAL]
    RESULT -->|Ada item\nhilang dalam transit| MISSING[Status: MISSING]
    RESULT -->|Ada item\nrusak atau ditolak| REJECTED_ST[Status: REJECTED]

    COMPLETED --> ADD_STOCK[Tambah Stok Tujuan\nsesuai qty_fulfilled]
    PARTIAL --> ADD_STOCK
    MISSING --> ADD_STOCK
    REJECTED_ST --> ADD_STOCK

    ADD_STOCK --> LOG_IN[Log StockMovement\nTRANSFER_IN per Item]
    LOG_IN --> ALERT_CHECK{Stok Sumber\n< Minimum?}
    ALERT_CHECK -->|Ya| ALERT[Trigger StockAlert]
    ALERT_CHECK -->|Tidak| DONE([Selesai])
    ALERT --> DONE
    CANCELLED --> DONE
```

### Skenario Transfer yang Didukung (Optimasi Finish Goods)

| Skenario | From | To | Keterangan |
|----------|------|----|-----------|
| **W→O** | Warehouse | Outlet | Resupply ke toko (Fokus Utama) |
| **O→O** | Outlet | Outlet | Redistribusi stok antar toko |
| **O→W** | Outlet | Warehouse | Retur stok dari toko ke gudang |
| **W→W** | Warehouse | Warehouse | *Pending/Custom Flow untuk Raw Material* |

### Tracking Quantity Per Item

```
quantity_requested  ← Set saat PENDING    (berapa yang diminta)
quantity_packed     ← Set saat SHIPMENT   (berapa yang dikemas)
quantity_received   ← Set saat RECEIVED   (berapa yang tiba fisik)
quantity_fulfilled  ← Set saat FULFILLMENT (berapa yang OK/diterima)
quantity_missing    ← Set saat FULFILLMENT (berapa yang hilang)
quantity_rejected   ← Set saat FULFILLMENT (berapa yang rusak/ditolak)

Invariant: fulfilled + missing + rejected = received
```

---

## 5. Alur Stock Adjustment / Opname

```mermaid
flowchart TD
    START([Manager/Staff]) --> SELECT_LOC[Pilih Lokasi\nWarehouse atau Outlet]
    SELECT_LOC --> SELECT_TYPE[Pilih Tipe\nProduk FG atau Bahan Baku]
    SELECT_TYPE --> SELECT_ITEMS[Pilih Item yang Akan Diopname]

    SELECT_ITEMS --> SHOW_SYS[Tampilkan Stok Sistem Saat Ini]
    SHOW_SYS --> INPUT_FISIK[Staff Hitung & Input\nStok Fisik Aktual]
    INPUT_FISIK --> CALC_DIFF[Hitung Selisih:\nFisik - Sistem]

    CALC_DIFF --> DIFF{Ada Selisih?}
    DIFF -->|Tidak| NO_CHANGE[Tidak Ada Perubahan]
    NO_CHANGE --> MORE_ITEMS{Item Lain?}

    DIFF -->|Ya| SHOW_DIFF[Tampilkan Selisih + Atau -]
    SHOW_DIFF --> REASON[Pilih Alasan:\nDamage / Loss / Correction /\nExpired / Found / Other]
    REASON --> MORE_ITEMS

    MORE_ITEMS -->|Ya| SELECT_ITEMS
    MORE_ITEMS -->|Tidak| REVIEW[Review Semua Adjustment Draft]

    REVIEW --> CONFIRM{Konfirmasi Apply?}
    CONFIRM -->|Tidak| EDIT[Edit Kembali]
    EDIT --> REVIEW

    CONFIRM -->|Ya| APPLY[Apply Adjustment\nUpdate Stok di Sistem]
    APPLY --> LOG_MOVE[Log StockMovement\ntype: OPNAME per item]
    LOG_MOVE --> CHECK_ALERT{Ada Item\n< Minimum Setelah Adjust?}
    CHECK_ALERT -->|Ya| ALERT[Trigger StockAlert]
    CHECK_ALERT -->|Tidak| END([Selesai])
    ALERT --> END
```

---

## 6. Alur POS Integration — Device Setup

```mermaid
flowchart TD
    START([Admin ERP]) --> SELECT_OUTLET[Pilih Outlet]
    SELECT_OUTLET --> ADD_DEVICE[Tambah POS Device\nInput: Nama Device]
    ADD_DEVICE --> GEN[Generate Device Token\nJWT dengan outlet_id + expire 1 tahun]
    GEN --> STORE_REDIS[Simpan token hash di Redis\nuntuk fast lookup]
    STORE_REDIS --> COPY_TOKEN[Copy Token ke POS Device]
    COPY_TOKEN --> CONFIG_POS[Konfigurasi di POS:\nSet ERP_URL + X-POS-Token]
    CONFIG_POS --> TEST_CONN[Test Koneksi:\nGET /api/pos/products]
    TEST_CONN --> OK{Response 200?}
    OK -->|Tidak| RECHECK[Periksa Token & URL]
    RECHECK --> TEST_CONN
    OK -->|Ya| READY([POS Device Siap])
```

---

## 7. Alur POS Sync Transaksi

```mermaid
flowchart TD
    CASHIER([Kasir Input Transaksi di POS]) --> POS_LOCAL[Simpan di Local POS DB]
    POS_LOCAL --> ONLINE{Ada Koneksi\nInternet?}

    ONLINE -->|Tidak| QUEUE[Queue Transaksi\ndi POS Device]
    QUEUE --> WAIT_CONN[Tunggu Koneksi]
    WAIT_CONN --> ONLINE

    ONLINE -->|Ya| BATCH[Kumpulkan Transaksi\nBelum Tersync]
    BATCH --> SEND[POST /api/pos/sync/transactions\ndengan X-POS-Token]

    SEND --> VALID_TOKEN{Token Valid?}
    VALID_TOKEN -->|Tidak| ERR[401 - Token Invalid/Expired]
    ERR --> NOTIFY_ADMIN[Notifikasi Admin untuk\nRenew Token]

    VALID_TOKEN -->|Ya| PROCESS[Proses Setiap Transaksi]
    PROCESS --> IDEM{transaction_uuid\nSudah Ada?}

    IDEM -->|Ya| SKIP[Skip - Sudah Tersync\nReturn: already_processed]
    IDEM -->|Tidak| DEDUCT[Kurangi OutletInventory\nper Item Terjual]
    DEDUCT --> LOG_MOVE[Log StockMovement\ntype: POS_SALE per item]
    LOG_MOVE --> CHECK_ALERT{Stok < Minimum?}
    CHECK_ALERT -->|Ya| ALERT[Trigger StockAlert\nLOW_STOCK]
    CHECK_ALERT -->|Tidak| NEXT

    SKIP --> NEXT{Transaksi\nBerikutnya?}
    ALERT --> NEXT
    NEXT -->|Ya| PROCESS
    NEXT -->|Tidak| AGGREGATE[Aggregate ke SalesActual\nper bulan otomatis]
    AGGREGATE --> RESPONSE[Return: sync_summary\nsuccess + skipped count]
    RESPONSE --> POS_MARK[POS Mark Transaksi\nsebagai Synced]
    POS_MARK --> END([Selesai])
```

---

## 8. Alur Low Stock Alert

```mermaid
flowchart TD
    TRIGGER([Trigger: Setiap Perubahan Stok]) --> GET_MIN[Ambil min_stock untuk\nentity + lokasi ini]
    GET_MIN --> HAS_MIN{min_stock\nDiset?}
    HAS_MIN -->|Tidak| END1([Tidak Ada Aksi])

    HAS_MIN -->|Ya| CHECK{Stok Saat Ini\n≤ min_stock?}
    CHECK -->|Tidak| CHECK_RESOLVE{Alert ACTIVE\nSudah Ada?}
    CHECK_RESOLVE -->|Ya| AUTO_RESOLVE[Auto-Resolve Alert\nStatus: RESOLVED]
    CHECK_RESOLVE -->|Tidak| END1

    CHECK -->|Ya| EXIST{Alert ACTIVE\nSudah Ada?}
    EXIST -->|Ya| END1
    EXIST -->|Tidak| CREATE_ALERT[Buat StockAlert\nStatus: ACTIVE]
    CREATE_ALERT --> NOTIFY[Tampil di Dashboard\nsebagai Badge]
    NOTIFY --> USER_ACT{User Ambil Tindakan}

    USER_ACT -->|Buat PO| PO[Buat Purchase Order\nke Supplier]
    USER_ACT -->|Buat Transfer| TRANSFER[Buat Stock Transfer\ndari Warehouse ke Outlet]
    USER_ACT -->|Dismiss| DISMISS[Mark: DISMISSED]

    PO --> WAIT_RESOLVE[Alert Auto-Resolve\nSaat Stok Naik > Minimum]
    TRANSFER --> WAIT_RESOLVE
    DISMISS --> END2([Selesai])
    WAIT_RESOLVE --> END2
    AUTO_RESOLVE --> END3([Selesai])
```

---

## 9. Alur Forecasting & Procurement

```mermaid
flowchart TD
    START([Admin]) --> UPLOAD_SALES[Upload / Input Sales Aktual\nper Produk per Bulan]
    UPLOAD_SALES --> SET_TARGET[Set Target Persentase\nPertumbuhan per Bulan]
    SET_TARGET --> RUN_FORECAST[Jalankan Forecast Engine\nHorizon 1-12 Bulan]

    RUN_FORECAST --> CALC[Hitung: SalesActual × ForecastPercentage\nuntuk setiap produk]
    CALC --> SAFETY[Hitung Safety Stock:\nz_value × StdDev × sqrt lead_time]
    SAFETY --> REVIEW_DRAFT[Review Forecast Draft]

    REVIEW_DRAFT --> ADJUST{Perlu\nAdjustment?}
    ADJUST -->|Ya| MANUAL_ADJ[Adjust Manual Final Forecast]
    ADJUST -->|Tidak| FINALIZE[Finalize Forecast\nStatus: FINALIZED]
    MANUAL_ADJ --> FINALIZE

    FINALIZE --> EXPLODE[BOM Explosion:\nBreakdown ke Kebutuhan Bahan Baku]
    EXPLODE --> RECOMMENDATION[Hitung Procurement Recommendation:\nForecast - Stok RM - Open PO\n- Stok FG × Resep - Safety Stock]

    RECOMMENDATION --> PIC[PIC Review &\nAdjust Qty Order]
    PIC --> APPROVE{Approve\nRecommendation?}
    APPROVE -->|Ya| ACC[Status: ACC\nBuat PO Baru]
    APPROVE -->|Tidak| DRAFT_HOLD[Status: DRAFT\nRevisi Nanti]
    ACC --> CREATE_PO[Buat Purchase Order\nke Supplier]
    CREATE_PO --> END([Selesai])
```

---

## 10. Alur Stock Movement Universal

```mermaid
flowchart LR
    PO[PO Received] -->|type: IN| SM[(StockMovement)]
    TRANSFER_OUT[Stock Transfer Dispatch] -->|type: TRANSFER_OUT| SM
    TRANSFER_IN[Stock Transfer Receive] -->|type: TRANSFER_IN| SM
    OPNAME[Stock Adjustment Apply] -->|type: OPNAME| SM
    POS[POS Transaction Sync] -->|type: POS_SALE| SM
    INIT[Inisialisasi Stok] -->|type: INITIAL| SM

    SM --> REPORT[Stock Movement Report]
    SM --> AUDIT[Audit Trail]
```

> Setiap operasi yang mengubah stok **wajib** membuat record di `StockMovement`. Ini adalah prinsip tidak dapat dikompromikan untuk menjamin audit trail 100%.
