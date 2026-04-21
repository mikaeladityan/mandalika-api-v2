# Inventory V2 Module – API Endpoints

Base path: `/api/app/inventory-v2`  
Auth: Required (session cookie + CSRF header)

---

## 1. Delivery Order (DO)
Path: `/do`

| Method | Path | Description |
|---|---|---|
| GET | `/` | List DO dengan pagination & filter |
| GET | `/:id` | Detail DO |
| POST | `/` | Create DO baru (Warehouse → Outlet) |
| PATCH | `/:id/status` | Update status DO (`APPROVED`, `SHIPMENT`, `RECEIVED`, `FULFILLMENT`, `CANCELLED`) |
| GET | `/stock` | Cek ketersediaan stok produk untuk DO |
| GET | `/export` | Export data DO ke CSV |

---

## 2. Goods Receipt (GR)
Path: `/gr`

| Method | Path | Description |
|---|---|---|
| GET | `/` | List GR dengan pagination & filter |
| GET | `/:id` | Detail GR |
| POST | `/` | Create GR baru (Pending) |
| POST | `/:id/post` | Finalisasi GR (Menambah stok ke gudang) |
| PATCH | `/:id/cancel` | Membatalkan GR (hanya jika masih PENDING) |
| GET | `/export` | Export data GR ke CSV |

---

## 3. Transfer Gudang (TG)
Path: `/tg`

| Method | Path | Description |
|---|---|---|
| GET | `/` | List TG dengan pagination & filter |
| GET | `/:id` | Detail TG |
| POST | `/` | Create TG baru (Warehouse → Warehouse) |
| PATCH | `/:id/status` | Update status TG (`APPROVED`, `SHIPMENT`, `RECEIVED`, `FULFILLMENT`, `CANCELLED`) |
| GET | `/stock` | Cek ketersediaan stok produk untuk TG |
| GET | `/export` | Export data TG ke CSV |

---

## 4. Monitoring & Reports
Path: `/monitoring`

### Stock Total
`GET /monitoring/stock-total`  
Rekap total saldo stok produk.

### Stock Card
`GET /monitoring/stock-card`  
Laporan histori mutasi stok per barang.

### Stock per Location
`GET /monitoring/stock-location`  
Saldo stok per gudang/outlet.

### Discrepancy
`GET /monitoring/discrepancy`  
Laporan selisih antara pengiriman (packed) vs penerimaan (fulfilled).

---

## 5. Return
Path: `/return`

| Method | Path | Description |
|---|---|---|
| GET | `/` | List Return dengan pagination & filter |
| GET | `/:id` | Detail Return |
| POST | `/` | Create Return manual |
| POST | `/:id/post` | Finalisasi Return (Mengembalikan stok ke gudang) |
