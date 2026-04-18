# RM Receipt (Automated Transfers) – ENDPOINTS

Base Path: `/api/app/manufacturing/inventory/rm-receipt`

---

## 1. List Penerimaan RM
Mengambil daftar stok transfer (TRM) yang terkait dengan pesanan manufaktur.

- **URL**: `/`
- **Method**: `GET`
- **Query Params**:
  - `page` (number, default: 1)
  - `take` (number, default: 10)
  - `search` (string) - Cari No. Transfer atau No. Produksi
  - `status` (string) - Filter status (`PENDING`, `APPROVED`, dll)
  - `fromDate` (string, ISO Date)
  - `toDate` (string, ISO Date)

### Response Sukses (200)
```json
{
  "status": "success",
  "data": {
    "data": [
      {
        "id": 1,
        "transfer_number": "TRM-20260418-1234",
        "status": "PENDING",
        "date": "2026-04-18T08:00:00.000Z",
        "production_order": { "mfg_number": "MFG-202604-0001" },
        "from_warehouse": { "name": "Gudang Kandangan" },
        "to_warehouse": { "name": "Gudang Produksi" },
        "items": [...]
      }
    ],
    "total": 1
  }
}
```

---

## 2. Detail Penerimaan RM
Mengambil informasi lengkap satu dokumen transfer beserta item-itemnya.

- **URL**: `/:id`
- **Method**: `GET`

### Response Sukses (200)
```json
{
  "status": "success",
  "data": {
    "id": 1,
    "transfer_number": "TRM-20260418-1234",
    "items": [
      {
        "id": 10,
        "raw_material_id": 5,
        "quantity_requested": "100",
        "raw_material": {
          "name": "Bahan Baku A",
          "unit_raw_material": { "name": "ML" }
        }
      }
    ]
  }
}
```

---

## 3. Update Kuantitas Permintaan
Melakukan penyesuaian kuantitas pada draf transfer (hanya jika status `PENDING`).

- **URL**: `/:id`
- **Method**: `PATCH`
- **Body**:
```json
{
  "items": [
    {
      "id": 10,
      "quantity_requested": 150
    }
  ]
}
```

### Response Sukses (200)
```json
{
  "status": "success",
  "data": { ... updated transfer object ... }
}
```

### Error Responses
- **400**: "Hanya draf transfer (PENDING) yang dapat diubah kuantitasnya"
## 4. Update Status (Lifecycle Transition)
Melakukan transisi status dalam alur pengiriman dan penerimaan.

- **URL**: `/:id/status`
- **Method**: `PATCH`
- **Body Options**:

### A. Persetujuan (APPROVED)
```json
{ "status": "APPROVED", "notes": "Disetujui untuk dikirim" }
```

### B. Pengiriman (SHIPMENT)
```json
{
  "status": "SHIPMENT",
  "notes": "Dikirim via kendaraan logistik",
  "items": [
    { "id": 10, "quantity_packed": 150 }
  ],
  "photos": ["https://storage.url/photo-shipment.jpg"]
}
```

### C. Penerimaan (RECEIVED)
```json
{
  "status": "RECEIVED",
  "notes": "Barang sudah sampai di pos sekuriti",
  "items": [
    { "id": 10, "quantity_received": 150 }
  ]
}
```

### D. Verifikasi & Penyelesaian (FULFILLMENT)
```json
{
  "status": "FULFILLMENT",
  "notes": "Pengecekan akhir gudang",
  "items": [
    { 
      "id": 10, 
      "quantity_fulfilled": 145, 
      "quantity_missing": 2, 
      "quantity_rejected": 3 
    }
  ]
}
```

### Response Sukses (200)
```json
{
  "status": "success",
  "data": { ... updated transfer object ... }
}
```
