# Manufacturing Module – API Endpoints

Base path: `/api/app/manufacturing`
Auth: Required (session cookie + CSRF header)

---

## 1. Create Production Order

**POST** `/api/app/manufacturing`

Membuat Production Order baru dengan status `PLANNING`.

### Request Body

| Field | Type | Required | Description |
|---|---|---|---|
| `product_id` | number | Yes | ID produk FG yang akan diproduksi |
| `quantity_planned` | number | Yes | Jumlah rencana produksi (> 0) |
| `target_date` | string (ISO date) | No | Target selesai produksi |
| `notes` | string | No | Catatan tambahan |
| `items` | array | No | BOM manual; jika kosong, auto dari recipe aktif |
| `items[].raw_material_id` | number | Yes* | ID bahan baku |
| `items[].quantity_planned` | number | Yes* | Jumlah bahan baku yang dibutuhkan |

### Response `201`
```json
{
  "status": "success",
  "data": {
    "id": 1,
    "mfg_number": "MFG-202604-0001",
    "product_id": 1,
    "quantity_planned": "100.00",
    "status": "PLANNING",
    "target_date": null,
    "created_by": "user-uuid",
    "items": [
      { "id": 10, "raw_material_id": 5, "quantity_planned": "200.00", "warehouse_id": null }
    ],
    "product": { "id": 1, "name": "Parfum EDP 100ml", "code": "EDP_100" }
  }
}
```

### Errors
| Code | Reason |
|---|---|
| 400 | Product not found / no active BOM |
| 400 | Validation error |

---

## 2. Change Status

**PATCH** `/api/app/manufacturing/:id/status`

Transisi status: `PLANNING→RELEASED`, `RELEASED→PROCESSING`, `COMPLETED→QC_REVIEW`.

### Request Body

| Field | Type | Required | Description |
|---|---|---|---|
| `status` | enum | Yes | `RELEASED` \| `PROCESSING` \| `QC_REVIEW` |
| `notes` | string | No | Catatan transisi |

### Response `200`
```json
{
  "status": "success",
  "data": {
    "id": 1,
    "mfg_number": "MFG-202604-0001",
    "status": "RELEASED",
    "released_at": "2026-04-16T10:00:00.000Z",
    "items": [
      { "id": 10, "warehouse_id": 3, "quantity_planned": "200.00" }
    ]
  }
}
```

### Errors
| Code | Reason |
|---|---|
| 400 | Invalid transition |
| 400 | Insufficient RM stock (saat RELEASED) |
| 400 | Item has no allocated warehouse (saat PROCESSING) |
| 404 | Order not found |

---

## 3. Submit Production Result

**POST** `/api/app/manufacturing/:id/result`

Input hasil aktual produksi. Hanya bisa dari status `PROCESSING`.

### Request Body

| Field | Type | Required | Description |
|---|---|---|---|
| `quantity_actual` | number | Yes | Qty FG aktual yang dihasilkan |
| `items` | array | Yes | Pemakaian RM aktual per item |
| `items[].id` | number | Yes | ID `ProductionOrderItem` |
| `items[].quantity_actual` | number | Yes | Qty RM yang benar-benar terpakai |
| `notes` | string | No | Catatan hasil produksi |

### Response `200`
```json
{
  "status": "success",
  "data": {
    "id": 1,
    "status": "COMPLETED",
    "quantity_actual": "95.00",
    "completed_at": "2026-04-16T14:00:00.000Z",
    "items": [...],
    "wastes": [
      { "id": 1, "waste_type": "RAW_MATERIAL", "raw_material_id": 5, "quantity": "10.00" }
    ]
  }
}
```

### Errors
| Code | Reason |
|---|---|
| 400 | Order not in PROCESSING status |
| 400 | Item ID not found in this order |
| 400 | Insufficient stock for over-usage |
| 404 | Order not found |

---

## 4. QC Action (Finalize)

**POST** `/api/app/manufacturing/:id/qc`

Finalisasi QC. Hanya bisa dari status `QC_REVIEW`.

### Request Body

| Field | Type | Required | Description |
|---|---|---|---|
| `quantity_accepted` | number | Yes | Qty barang bagus (masuk GR) |
| `quantity_rejected` | number | Yes | Qty barang reject (Waste FG) |
| `fg_warehouse_id` | number | Yes | Gudang tujuan FG yang diterima |
| `qc_notes` | string | No | Catatan QC |

### Response `200`
```json
{
  "status": "success",
  "data": {
    "id": 1,
    "status": "FINISHED",
    "quantity_accepted": "90.00",
    "quantity_rejected": "5.00",
    "fg_warehouse_id": 1,
    "finished_at": "2026-04-16T16:00:00.000Z",
    "goods_receipt": {
      "id": 5,
      "gr_number": "GR-202604-0005",
      "type": "QC_FG",
      "status": "COMPLETED"
    },
    "wastes": [
      { "id": 2, "waste_type": "FINISH_GOODS", "product_id": 1, "quantity": "5.00" }
    ]
  }
}
```

### Errors
| Code | Reason |
|---|---|
| 400 | Order not in QC_REVIEW status |
| 400 | total accepted + rejected > quantity_actual |
| 400 | GR already created for this order |
| 404 | Order not found |
| 404 | FG warehouse not found |

---

## 5. List Production Orders

**GET** `/api/app/manufacturing`

### Query Parameters

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | number | 1 | Halaman |
| `take` | number | 10 | Jumlah per halaman (max 100) |
| `sortBy` | string | `created_at` | `created_at` \| `mfg_number` \| `target_date` |
| `sortOrder` | string | `desc` | `asc` \| `desc` |
| `search` | string | — | Cari by `mfg_number` atau nama produk |
| `status` | enum | — | Filter by status |
| `product_id` | number | — | Filter by product |

### Response `200`
```json
{
  "status": "success",
  "data": {
    "data": [...],
    "len": 25
  }
}
```

---

## 6. Detail Production Order

**GET** `/api/app/manufacturing/:id`

### Response `200`
```json
{
  "status": "success",
  "data": {
    "id": 1,
    "mfg_number": "MFG-202604-0001",
    "status": "FINISHED",
    "product": { "id": 1, "name": "Parfum EDP 100ml", "code": "EDP_100" },
    "items": [
      {
        "id": 10,
        "quantity_planned": "200.00",
        "quantity_actual": "190.00",
        "raw_material": { "id": 5, "name": "Etanol 96%", "barcode": "RM-005" },
        "warehouse": { "id": 3, "name": "Gudang Bahan Baku", "type": "RAW_MATERIAL" }
      }
    ],
    "wastes": [...],
    "goods_receipt": { "id": 5, "gr_number": "GR-202604-0005", "status": "COMPLETED" },
    "fg_warehouse": { "id": 1, "name": "Gudang FG" }
  }
}
```

---

## 7. Update Production Order

**PATCH** `/api/app/manufacturing/:id`

Mengubah informasi target date atau catatan pada order yang belum diproses.

---

## 8. Delete Production Order

**DELETE** `/api/app/manufacturing/:id`

Menghapus order yang masih berstatus `PLANNING`.

---

## 9. Clean Cancelled Orders

**DELETE** `/api/app/manufacturing/clean/cancelled`

Membersihkan semua riwayat order produksi yang dibatalkan (termasuk stock transfer terkait).

---

## 10. List Production Wastes

**GET** `/api/app/manufacturing/wastes`

### Query Parameters
- `page`, `take`, `search`
- `waste_type`: `RAW_MATERIAL` | `FINISH_GOODS`
