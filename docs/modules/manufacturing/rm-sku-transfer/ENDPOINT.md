# Endpoints: RM SKU Transfer

Dokumentasi API untuk modul perpindahan SKU Raw Material.

## Base Path
`/api/app/manufacturing/inventory/rm-sku-transfer`

## Daftar Endpoint

### 1. Pindah SKU Stock (POST)
Memindahkan quantity stok dari satu Raw Material ke Raw Material lainnya.

- **Method**: `POST`
- **Path**: `/`
- **Auth Required**: Yes (Session Cookie)
- **Content-Type**: `application/json`

#### Request Body
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `source_rm_id` | `number` | Yes | ID Raw Material asal (sumber stok) |
| `target_rm_id` | `number` | Yes | ID Raw Material tujuan (penerima stok) |
| `warehouse_id` | `number` | Yes | ID Gudang tempat perpindahan stok |
| `quantity` | `number` | Yes | Jumlah stok yang dipindahkan (min 0.01) |
| `notes` | `string` | No | Catatan tambahan untuk audit trail |

#### Response Sukses (201 Created)
```json
{
  "status": "success",
  "message": "Berhasil memindahkan stok SKU",
  "data": {
    "source": { ... },
    "target": { ... }
  }
}
```

### 2. Cek Stock Avail (GET)
Mendapatkan informasi stok tersedia (Avail = On Hand - Booked) untuk Raw Material tertentu di gudang tertentu.

- **Method**: `GET`
- **Path**: `/stock`
- **Query Params**:
  - `rm_id`: ID Raw Material
  - `warehouse_id`: ID Gudang

#### Response Sukses (200 OK)
```json
{
  "status": "success",
  "data": {
    "on_hand": 100,
    "booked": 10,
    "avail": 90
  }
}
```

#### Response Error (400 Bad Request)
- RM Asal dan Tujuan sama.
- RM Asal tidak ditemukan.
- RM Tujuan tidak ditemukan.
- Gudang tidak ditemukan.
- Stok RM Asal tidak mencukupi (dilempar oleh `InventoryHelper`).

#### Contoh Request
```bash
curl -X POST http://localhost:3000/api/app/manufacturing/inventory/rm-sku-transfer \
  -H "Content-Type: application/json" \
  -d '{
    "source_rm_id": 1,
    "target_rm_id": 2,
    "warehouse_id": 3,
    "quantity": 10.5,
    "notes": "Penyesuaian stok botol"
  }'
```
