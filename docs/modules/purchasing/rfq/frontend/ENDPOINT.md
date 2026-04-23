# RFQ Module – API Endpoints

Base path: `/api/app/purchase/rfq`  
Auth: Required (session cookie + CSRF header)

---

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | List RFQ dengan pagination & filter |
| `GET` | `/:id` | Detail RFQ beserta items & open POs |
| `POST` | `/` | Buat RFQ baru (manual atau dari konsolidasi) |
| `PUT` | `/:id` | Update header & items RFQ (hanya DRAFT/SENT/RECEIVED) |
| `PATCH` | `/:id/status` | Transisi status RFQ |
| `POST` | `/:id/convert` | Konversi item RFQ ke Open PO |
| `DELETE` | `/:id` | Hapus RFQ (hanya DRAFT) |

---

## 1. List RFQ

`GET /api/app/purchase/rfq`

### Query Parameters

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | number | 1 | Halaman |
| `take` | number | 50 | Baris per halaman (max 500) |
| `search` | string | — | Filter rfq_number, nama vendor, notes |
| `status` | RFQStatus | — | Filter by status |
| `vendor_id` | number | — | Filter by supplier |
| `month` | number | — | Filter by bulan (1–12) |
| `year` | number | — | Filter by tahun |
| `sortBy` | string | `created_at` | `date` \| `rfq_number` \| `status` \| `created_at` |
| `order` | string | `desc` | `asc` \| `desc` |

### Response

```json
{
  "data": [
    {
      "id": 1,
      "rfq_number": "RFQ-20260422-1234",
      "status": "DRAFT",
      "date": "2026-04-22T00:00:00.000Z",
      "notes": null,
      "vendor": { "id": 3, "name": "PT Supplier A", "country": "Indonesia" },
      "warehouse": { "id": 1, "name": "Gudang Utama", "code": "WH-01" },
      "items": [
        {
          "id": 10,
          "rfq_id": 1,
          "raw_material_id": 5,
          "purchase_draft_id": 42,
          "quantity": "500.00",
          "unit_price": null,
          "notes": null,
          "raw_material": {
            "id": 5,
            "barcode": "RM-001",
            "name": "Ethanol 96%",
            "unit_raw_material": { "name": "Liter" }
          }
        }
      ],
      "_count": { "items": 1, "open_pos": 0 }
    }
  ],
  "total": 42
}
```

---

## 2. Detail RFQ

`GET /api/app/purchase/rfq/:id`

Response includes full `vendor`, `warehouse`, `items` (with `raw_material` + `purchase_draft`), and `open_pos`.

---

## 3. Create RFQ

`POST /api/app/purchase/rfq`

### Request Body

```json
{
  "vendor_id": 3,
  "warehouse_id": 1,
  "date": "2026-04-22",
  "notes": "Urgent order",
  "items": [
    {
      "raw_material_id": 5,
      "purchase_draft_id": 42,
      "quantity": 500,
      "unit_price": null,
      "notes": null
    },
    {
      "raw_material_id": 8,
      "quantity": 200
    }
  ]
}
```

- `vendor_id` — opsional, bisa diisi belakangan
- `purchase_draft_id` — opsional, diisi jika RFQ dibuat dari konsolidasi (auto-link ke draft)
- `items` — wajib min 1

### Response: `201 Created` — objek RFQ yang baru dibuat

---

## 4. Update RFQ

`PUT /api/app/purchase/rfq/:id`

Hanya bisa diupdate jika status bukan `CONVERTED` atau `CANCELLED`.  
Jika `items` disertakan, seluruh items lama dihapus dan diganti (replace strategy).

```json
{
  "vendor_id": 4,
  "notes": "Updated notes",
  "items": [
    { "raw_material_id": 5, "quantity": 600, "unit_price": 15000 }
  ]
}
```

---

## 5. Update Status

`PATCH /api/app/purchase/rfq/:id/status`

```json
{ "status": "SENT" }
```

### Valid Transitions

```
DRAFT           → SENT, CANCELLED
SENT            → RECEIVED, CANCELLED
RECEIVED        → APPROVED, CANCELLED
APPROVED        → PARTIAL_CONVERTED, CONVERTED, CANCELLED
PARTIAL_CONVERTED → CONVERTED, CANCELLED
CONVERTED       → (terminal)
CANCELLED       → (terminal)
```

---

## 6. Convert to Open PO

`POST /api/app/purchase/rfq/:id/convert`

RFQ harus berstatus `APPROVED` atau `PARTIAL_CONVERTED`.

```json
{
  "item_ids": [10, 11],
  "expected_arrival": "2026-05-15"
}
```

### Response

```json
{
  "created_pos": [
    { "id": 101, "raw_material_id": 5, "quantity": "500.00", "status": "OPEN", "rfq_id": 1 }
  ],
  "rfq_status": "CONVERTED"
}
```

- Jika semua items dikonversi → status RFQ menjadi `CONVERTED`
- Jika sebagian → status menjadi `PARTIAL_CONVERTED`

---

## 7. Delete RFQ

`DELETE /api/app/purchase/rfq/:id`

Hanya bisa dihapus jika status `DRAFT`.

---

## Status Reference

| Status | Label | Warna |
|---|---|---|
| `DRAFT` | Draft | Slate |
| `SENT` | Terkirim | Blue |
| `RECEIVED` | Diterima | Indigo |
| `APPROVED` | Disetujui | Green |
| `PARTIAL_CONVERTED` | Sebagian PO | Orange |
| `CONVERTED` | Selesai → PO | Emerald |
| `CANCELLED` | Dibatalkan | Red |
