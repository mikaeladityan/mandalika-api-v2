# Module: Inventory / Monitoring / Stock Movement (Pergerakan Stock)

**Base path**: `/api/app/inventory/monitoring/stock-movement`
**Source**: `src/module/application/inventory/monitoring/stock-movement/`
**Tests**: `src/tests/inventory/monitoring/stock-movement/`
**Prisma model**: `StockMovement` (tabel `stock_movements`)

Audit-trail (ledger) pergerakan stok lintas-entity (Product / RawMaterial) dan lintas-lokasi (Warehouse / Outlet), termasuk referensi ke dokumen sumber (Stock Transfer / Stock Return / Goods Receipt). Read-only — semua mutasi terjadi di modul sumber (FG, RM, GR, DO, TG, Return) yang menulis row ke `stock_movements` saat menjalankan transaksi mereka.

> **Catatan khusus**:
> - **Polymorphic discriminator**: tiga kolom discriminator runtime — `entity_type` (PRODUCT vs RAW_MATERIAL), `location_type` (WAREHOUSE vs OUTLET), `reference_type` (STOCK_TRANSFER / STOCK_RETURN / GOODS_RECEIPT). JOIN dinamis berdasarkan nilai kolom ini.
> - **Raw SQL justified**: Prisma ORM `include` tidak bisa kondisional berdasarkan discriminator runtime → akan menjadi N+1 nightmare. `$queryRaw` dengan parameterized tagged template + identifier whitelist untuk ORDER BY (lihat §1.J.B dev-flow SOP).
> - **Default lokasi**: bila filter `location_type` / `location_id` tidak dikirim, service auto-apply warehouse `GFG-SBY` agar UI tidak meledak menampilkan semua history lintas-warehouse.
> - **Export cap**: 50.000 baris. Lebih → 400. Counter dijalankan sebelum SELECT untuk hindari render dulu lalu cap.

---

## 1. Scope & Fitur (PRD ringkas)

| Fitur                                  | Endpoint                                                   | Catatan                                                                                                       |
| :------------------------------------- | :--------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------ |
| List pergerakan stok (paginated)       | `GET /`                                                    | Filter polymorphic (entity, location, movement, reference) + search produk/RM + date range. Default lokasi GFG-SBY. |
| Export CSV                             | `GET /export`                                              | RFC 4180 + UTF-8 BOM + CRLF. Cap `EXPORT_MAX_ROWS = 50_000`; lebih → 400.                                      |

### Out of scope (tidak dihandle di sini)

- **Membuat / memutasi stok** (in/out, transfer, return, GR) — service ini hanya **membaca** `stock_movements`. Tulis-nya dilakukan di:
  - `inventory/fg` (Create/Update FG) — initial / adjust
  - `inventory/rm/stock` (RM stock entries)
  - `inventory-v2/gr` (Goods Receipt → +stock)
  - `inventory-v2/do` & `inventory-v2/tg` (Stock Transfer Out/In)
  - `inventory-v2/return` (Stock Return)
- **Snapshot stok per-lokasi current** — lihat `inventory/monitoring/stock-distribution/{fg|rm}`.
- **Single-location stock detail** — lihat `inventory-v2/monitoring/stock-location` (legacy).
- **Discrepancy report** — lihat `inventory-v2/monitoring/discrepancy` (legacy).

---

## 2. Arsitektur & Flow

### 2.1 Layer map

```text
┌──────────────────── stock-movement.routes.ts ────────────────────┐
│ Hono router: GET /export → controller.export                     │
│              GET /       → controller.list                       │
│  (NOTE: /export DIDAFTARKAN SEBELUM / supaya tidak bentrok       │
│   dengan pattern :id di masa depan)                              │
└──────────────────────────────────┬───────────────────────────────┘
                                   ▼
                StockMovementController
                ┌─────────────────────────────────────────┐
                │ list(c):                                │
                │  - parse Query schema                   │
                │  - delegate service.list                │
                │  - ApiResponse.sendSuccess(200, q)      │
                │ export(c):                              │
                │  - parse Query schema                   │
                │  - delegate service.export              │
                │  - empty → 200 JSON message             │
                │  - else → buildCsv + Response(CSV)      │
                └────────────────┬────────────────────────┘
                                 ▼
                StockMovementService
                ┌─────────────────────────────────────────┐
                │ list(q):                                │
                │  applyDefaultLocation (warehouse lookup)│
                │  buildClauses (where + orderBy SQL)     │
                │  Promise.all([count, rows raw SQL])     │
                │  rows.map(toDTO)                        │
                │ export(q):                              │
                │  applyDefaultLocation                   │
                │  buildClauses                           │
                │  count > 50_000 → throw 400             │
                │  fetch rows + map(toDTO)                │
                │ Static BASE_SELECT + BASE_JOINS         │
                └────────────────┬────────────────────────┘
                                 ▼
                       Prisma → PostgreSQL
                       ($queryRaw parametrized)
```

### 2.2 Mermaid: List flow

```mermaid
sequenceDiagram
    autonumber
    actor FE as Frontend
    participant R as stock-movement.routes
    participant C as StockMovementController
    participant S as StockMovementService
    participant DB as Prisma/PG

    FE->>R: GET /api/app/inventory/monitoring/stock-movement?...
    R->>C: list(c)
    C->>C: QueryStockMovementSchema.parse
    C->>S: list(query)
    alt query.location_type || query.location_id
        S-->>S: skip default lookup
    else
        S->>DB: warehouse.findFirst({ code:"GFG-SBY", deleted_at:null })
        DB-->>S: { id }
        S-->>S: inject location_type=WAREHOUSE + location_id
    end
    S->>S: buildClauses (whereClause + orderBySql)
    par
        S->>DB: $queryRaw COUNT(*)::bigint AS total
    and
        S->>DB: $queryRaw SELECT BASE_SELECT FROM BASE_JOINS WHERE ... ORDER BY ... LIMIT take OFFSET skip
    end
    DB-->>S: [{ total }], rows
    S->>S: rows.map(toDTO) — Number(Decimal) konversi quantity/qty_before/qty_after
    S-->>C: { data, len }
    C-->>FE: 200 { status:"success", data:{ data, len }, query }
```

### 2.3 Mermaid: Export flow

```mermaid
sequenceDiagram
    autonumber
    actor FE as Frontend
    participant R as stock-movement.routes
    participant C as StockMovementController
    participant S as StockMovementService
    participant DB as Prisma/PG

    FE->>R: GET /api/app/inventory/monitoring/stock-movement/export?...
    R->>C: export(c)
    C->>C: QueryStockMovementSchema.parse
    C->>S: export(query)
    S->>S: applyDefaultLocation + buildClauses
    S->>DB: $queryRaw COUNT(*)::bigint
    DB-->>S: total
    alt total > 50_000
        S--xC: throw ApiError(400, "Hasil melebihi batas export...")
        C-->>FE: 400 { status:"error", message }
    else
        S->>DB: $queryRaw SELECT ... LIMIT 50_000
        DB-->>S: rows
        S->>S: rows.map(toDTO)
        S-->>C: ResponseStockMovementDTO[]
        alt rows empty
            C-->>FE: 200 { data:{ message:"Tidak ada data untuk di-export" } }
        else
            C->>C: buildCsv(rows, EXPORT_COLUMNS) — UTF-8 BOM + CRLF
            C-->>FE: 200 text/csv; Content-Disposition: attachment
        end
    end
```

---

## 3. DTO / Schemas (end-to-end SSOT)

Sumber: [`src/module/application/inventory/monitoring/stock-movement/stock-movement.schema.ts`](../../../../../src/module/application/inventory/monitoring/stock-movement/stock-movement.schema.ts).

### 3.1 `QueryStockMovementSchema`

```ts
const isoDateString = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}(T.*)?$/, "Format tanggal harus ISO (YYYY-MM-DD)");

export const QueryStockMovementSchema = z.object({
    page:           z.coerce.number().int().positive().default(1).optional(),
    take:           z.coerce.number().int().positive().max(5000).default(50).optional(),
    /** Cari berdasarkan nama produk, kode produk, nama bahan baku, atau barcode */
    search:         z.string().trim().min(1).optional(),
    entity_type:    z.enum(MovementEntityType).optional(),
    entity_id:      z.coerce.number().int().positive().optional(),
    location_type:  z.enum(MovementLocationType).optional(),
    location_id:    z.coerce.number().int().positive().optional(),
    movement_type:  z.enum(MovementType).optional(),
    reference_type: z.enum(MovementRefType).optional(),
    reference_id:   z.coerce.number().int().positive().optional(),
    date_from:      isoDateString.optional(),
    date_to:        isoDateString.optional(),
    created_by:     z.string().trim().min(1).optional(),
    sortBy:         z.enum(["created_at", "quantity"]).default("created_at").optional(),
    sortOrder:      z.enum(["asc", "desc"]).default("desc").optional(),
});

export type QueryStockMovementDTO = z.infer<typeof QueryStockMovementSchema>;
```

| Field            | Type                    | Required | Default       | Constraint                                  | Error msg                                          | Catatan                                                                  |
| :--------------- | :---------------------- | :------- | :------------ | :------------------------------------------ | :------------------------------------------------- | :----------------------------------------------------------------------- |
| `page`           | `number`                | No       | `1`           | `int >= 1`                                  | (Zod default)                                      | Coerce dari string query                                                  |
| `take`           | `number`                | No       | `50`          | `int 1..5000`                                | (Zod default)                                      | Cap 5000 untuk mencegah satu request berat                               |
| `search`         | `string`                | No       | —             | `trim, min 1 char`                          | (Zod default)                                      | Match ILIKE `%search%` ke `p.name/code` + `rm.name/barcode`              |
| `entity_type`    | `MovementEntityType`    | No       | —             | enum                                        | (Zod default)                                      | `PRODUCT` \| `RAW_MATERIAL`                                              |
| `entity_id`      | `number`                | No       | —             | `int positive`                              | (Zod default)                                      | Coerce                                                                    |
| `location_type`  | `MovementLocationType`  | No       | (auto GFG-SBY) | enum                                        | (Zod default)                                      | `WAREHOUSE` \| `OUTLET`. Bila tidak dikirim, default warehouse GFG-SBY    |
| `location_id`    | `number`                | No       | (auto)        | `int positive`                              | (Zod default)                                      | Coerce                                                                    |
| `movement_type`  | `MovementType`          | No       | —             | enum                                        | (Zod default)                                      | `IN/OUT/TRANSFER_IN/TRANSFER_OUT/RETURN_IN/RETURN_OUT/INITIAL/POS_SALE`  |
| `reference_type` | `MovementRefType`       | No       | —             | enum                                        | (Zod default)                                      | `STOCK_TRANSFER` \| `STOCK_RETURN` \| `GOODS_RECEIPT`                     |
| `reference_id`   | `number`                | No       | —             | `int positive`                              | (Zod default)                                      | Coerce                                                                    |
| `date_from`      | `string` (ISO date)     | No       | —             | regex `^\d{4}-\d{2}-\d{2}(T.*)?$`           | `"Format tanggal harus ISO (YYYY-MM-DD)"`           | `new Date(date_from)` → bind sebagai timestamp param                      |
| `date_to`        | `string` (ISO date)     | No       | —             | regex `^\d{4}-\d{2}-\d{2}(T.*)?$`           | `"Format tanggal harus ISO (YYYY-MM-DD)"`           | Service set ke `setUTCHours(23,59,59,999)` agar konsisten lintas-timezone |
| `created_by`     | `string`                | No       | —             | `trim, min 1`                                | (Zod default)                                      | Match ILIKE `%created_by%` ke `sm.created_by`                             |
| `sortBy`         | `"created_at"\|"quantity"` | No    | `"created_at"` | enum                                        | (Zod default)                                      | Whitelist via `SORT_COLUMN` Record sebelum `Prisma.raw`                  |
| `sortOrder`      | `"asc"\|"desc"`         | No       | `"desc"`      | enum                                        | (Zod default)                                      | Di-normalize ke literal `"ASC"`/`"DESC"` sebelum `Prisma.raw`            |

### 3.2 `ResponseStockMovementDTO`

```ts
export interface ResponseStockMovementDTO {
    id:                number;
    entity_type:       string;
    entity_id:         number;
    product_code:      string | null;
    product_name:      string | null;
    barcode:           string | null;
    category:          string | null;
    size:              string | null;
    location_type:     string;
    location_id:       number;
    location_name:     string | null;
    movement_type:     string;
    quantity:          number;
    /** Running balance sebelum mutasi */
    qty_before:        number;
    /** Running balance setelah mutasi */
    qty_after:         number;
    reference_id:      number | null;
    reference_type:    string | null;
    reference_code:    string | null;
    reference_subtype: string | null;
    destination_name:  string | null;
    created_by:        string | null;
    created_at:        Date;
}
```

| Field               | Source SQL                                                  | Catatan                                                                                  |
| :------------------ | :---------------------------------------------------------- | :--------------------------------------------------------------------------------------- |
| `id`                | `sm.id`                                                     | PK row pergerakan                                                                         |
| `entity_type`       | `sm.entity_type::text`                                       | `PRODUCT` \| `RAW_MATERIAL`                                                              |
| `entity_id`         | `sm.entity_id`                                              | FK ke `products.id` atau `raw_materials.id` (tergantung `entity_type`)                   |
| `product_code`      | `COALESCE(p.code, '')`                                       | Selalu string (empty kalau null) — untuk konsistensi UI                                  |
| `product_name`      | `COALESCE(p.name, rm.name)`                                  | Polymorphic — ambil dari product atau raw_material                                       |
| `barcode`           | `COALESCE(rm.barcode, p.code)`                               | Fallback ke product code agar selalu ada identifier                                       |
| `category`          | `COALESCE(pt.name, rmc.name)`                                | Tipe produk atau kategori raw material                                                   |
| `size`              | `ps.size::text`                                              | Hanya untuk PRODUCT entity                                                                |
| `location_type`     | `sm.location_type::text`                                     | `WAREHOUSE` \| `OUTLET`                                                                  |
| `location_id`       | `sm.location_id`                                            | FK ke `warehouses.id` atau `outlets.id`                                                   |
| `location_name`     | `CASE location_type → w.name \| o.name`                       | Resolved dari tabel union                                                                 |
| `movement_type`     | `sm.movement_type::text`                                     | `IN/OUT/TRANSFER_IN/TRANSFER_OUT/RETURN_IN/RETURN_OUT/INITIAL/POS_SALE`                |
| `quantity`          | `sm.quantity::numeric`                                       | Decimal(18,2) → number via `Number()` di toDTO                                            |
| `qty_before`        | `sm.qty_before::numeric`                                     | Running balance sebelum                                                                   |
| `qty_after`         | `sm.qty_after::numeric`                                      | Running balance sesudah                                                                   |
| `reference_id`      | `sm.reference_id`                                            | FK ke STxx / SRxx / GRxx (tergantung `reference_type`)                                   |
| `reference_type`    | `sm.reference_type::text`                                    | `STOCK_TRANSFER` \| `STOCK_RETURN` \| `GOODS_RECEIPT` \| `null`                          |
| `reference_code`    | `CASE reference_type → st/sr/gr.number`                       | `transfer_number` / `return_number` / `gr_number`                                         |
| `reference_subtype` | `CASE → 'DO'/'TG'/'RETURN'/'GR'`                              | Sub-tipe DO (Delivery Order ke outlet) vs TG (Transfer Gudang antar warehouse)            |
| `destination_name`  | `CASE movement_type + reference_type → tujuan/asal`           | "OUTBOUND" / "INBOUND" / "PRODUCTION / INBOUND" fallback bila tidak resolvable            |
| `created_by`        | `sm.created_by`                                              | Email atau identifier user yang trigger movement (di-set oleh modul sumber)               |
| `created_at`        | `sm.created_at`                                              | Timestamp dibuat                                                                          |

### 3.3 Enum referensi (Prisma)

```prisma
enum MovementEntityType   { PRODUCT  RAW_MATERIAL }
enum MovementLocationType { WAREHOUSE OUTLET }
enum MovementType         { IN  OUT  TRANSFER_IN  TRANSFER_OUT  RETURN_IN  RETURN_OUT  INITIAL  POS_SALE }
enum MovementRefType      { STOCK_TRANSFER  STOCK_RETURN  GOODS_RECEIPT }
```

---

## 4. Routing untuk integrasi Frontend

Base URL: `/api/app/inventory/monitoring/stock-movement`.

| #   | Method | Path        | Query type                  | Response status code | Error utama                                                                  |
| :-- | :----- | :---------- | :-------------------------- | :------------------- | :--------------------------------------------------------------------------- |
| 1   | `GET`  | `/`         | `QueryStockMovementDTO`     | `200`                | `400` validasi Zod (format date, enum, negatif)                              |
| 2   | `GET`  | `/export`   | `QueryStockMovementDTO`     | `200` (CSV body)     | `400` validasi Zod / hasil > 50.000 baris                                    |

### 4.1 Response wrapper

Semua endpoint (kecuali `/export` yang return CSV) memakai `ApiResponse.sendSuccess(c, data, 200, query)`:

```jsonc
{
  "status":  "success",
  "data":    { "data": [/* ResponseStockMovementDTO[] */], "len": 1234 },
  "query":   { /* echo of parsed query */ },
  "message": null
}
```

`/export` ketika rows kosong → 200 dengan body JSON `{ data: { message: "Tidak ada data untuk di-export" } }`. Ketika ada data → 200 + `Content-Type: text/csv; charset=utf-8` + `Content-Disposition: attachment; filename="stock-movement-YYYY-MM-DD.csv"`.

### 4.2 TanStack Query

Konvensi global (queryKey, mutationKey, error handling) di [../../../frontend-integration.md §2](../../frontend-integration.md). Per-scope wiring di [./frontend-integration.md](./frontend-integration.md).

### 4.3 Header & auth

- `Cookie: session={{session_id}}` (wajib di semua request — diatur via `withCredentials: true`)
- Endpoint ini **GET-only**, **tidak butuh** `x-xsrf-header` (CSRF hanya untuk write methods)

---

## 5. Database / Indexes

```prisma
model StockMovement {
  id             Int                  @id @default(autoincrement())
  entity_type    MovementEntityType
  entity_id      Int
  location_type  MovementLocationType
  location_id    Int
  movement_type  MovementType
  quantity       Decimal              @db.Decimal(18, 2)
  qty_before     Decimal              @db.Decimal(18, 2)
  qty_after     Decimal              @db.Decimal(18, 2)
  reference_id   Int?
  reference_type MovementRefType?
  notes          String?
  created_by     String?              @db.VarChar(100)
  created_at     DateTime             @default(now())

  @@index([entity_type, entity_id])
  @@index([location_type, location_id])
  @@index([movement_type])
  @@index([reference_type, reference_id])
  @@index([created_at])
  @@map("stock_movements")
}
```

### 5.1 Index relevan untuk service ini

| Index                                | Dipakai oleh                                          |
| :----------------------------------- | :---------------------------------------------------- |
| `(entity_type, entity_id)`           | Filter `entity_type` + `entity_id`                    |
| `(location_type, location_id)`       | Filter `location_type` + `location_id` + default GFG-SBY |
| `(movement_type)`                    | Filter `movement_type`                                |
| `(reference_type, reference_id)`     | Filter `reference_type` + `reference_id`              |
| `(created_at)`                       | `ORDER BY sm.created_at` + filter `date_from/date_to` |

### 5.2 Migrasi khusus

`prisma/migrations/20260520150000_rm_barcode_trgm/migration.sql` — GIN trigram untuk `raw_materials.barcode` agar ILIKE `%barcode%` di search service ini tidak full-scan:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "raw_materials_barcode_trgm_idx"
    ON "raw_materials" USING GIN ("barcode" gin_trgm_ops);
```

Trigram lain yang sudah ada (dari migrasi modul lain) dan dipakai ulang oleh ILIKE search di sini:

| Table          | Index                                | Dari migrasi                              |
| :------------- | :----------------------------------- | :---------------------------------------- |
| `products`     | `(name) USING GIN gin_trgm_ops`       | `20260516120000_fg_search_trgm_indexes`   |
| `products`     | `(code) USING GIN gin_trgm_ops`       | `20260516120000_fg_search_trgm_indexes`   |
| `raw_materials` | `(name) USING GIN gin_trgm_ops`      | `20260518135000_rm_indexes_and_trgm`      |
| `raw_materials` | `(barcode) USING GIN gin_trgm_ops`   | `20260520150000_rm_barcode_trgm` **(NEW)** |

---

## 6. Error catalog

| HTTP | Message                                                                                    | Trigger                                                              |
| :--- | :----------------------------------------------------------------------------------------- | :------------------------------------------------------------------- |
| 400  | (Zod validation message — mis. `"Format tanggal harus ISO (YYYY-MM-DD)"`)                  | Query param tidak match Zod schema                                   |
| 400  | `"Hasil melebihi batas export (50000 baris). Persempit filter terlebih dahulu."`            | `/export` dipanggil dan COUNT(*) > `EXPORT_MAX_ROWS`                  |
| 401  | `"Unauthorized, please login to access our system"`                                         | Session tidak valid (auth middleware global)                          |
| 500  | (Mask oleh global error handler)                                                            | Unhandled exception — Postgres timeout, dst.                          |

---

## 7. Testing

**Lokasi**: `src/tests/inventory/monitoring/stock-movement/`

| File                                  | Jumlah test | Cakupan                                                                                                                |
| :------------------------------------ | :---------- | :--------------------------------------------------------------------------------------------------------------------- |
| `stock-movement.service.test.ts`      | 9           | list happy/empty/DTO mapping, default warehouse auto-apply, skip default kalau location_id ada, default tidak ditemukan, null reference_id mapping, export rows, export oversize 400, export empty |
| `stock-movement.routes.test.ts`       | 5           | GET / 200, GET / 400 validasi, GET /export 200 CSV, GET /export empty body, GET /export 400 oversize                  |

**Mock setup**:

- `src/tests/setup.ts` — global mock untuk `prisma.warehouse.findFirst`, `prisma.$queryRaw`, redis, logger.
- `stock-movement.routes.test.ts` override Redis `get` → return session JSON valid agar auth middleware lolos.

**Perintah jalanin**:

```bash
rtk npm test -- --run src/tests/inventory/monitoring/stock-movement/
# atau
npx vitest run src/tests/inventory/monitoring/stock-movement/
```

Saat ini 14/14 hijau.

---

## 8. Postman testing

### 8.1 Variable koleksi

| Key          | Value                       | Catatan                                                |
| :----------- | :-------------------------- | :----------------------------------------------------- |
| `base_url`   | `http://localhost:3000`     | Ubah ke staging/prod jika perlu                        |
| `session_id` | (isi setelah login)         | Dari endpoint `POST /api/auth`                          |
| `csrf_token` | (tidak diperlukan untuk GET) | —                                                      |

### 8.2 Header global

```
Cookie: session={{session_id}}
```

### 8.3 Contoh request — List

```http
GET {{base_url}}/api/app/inventory/monitoring/stock-movement?page=1&take=25&sortBy=created_at&sortOrder=desc
Cookie: session={{session_id}}
```

Query optional yang sering dipakai:

```
?search=TSHIRT
?entity_type=PRODUCT&entity_id=10
?location_type=WAREHOUSE&location_id=5
?movement_type=TRANSFER_OUT
?reference_type=STOCK_TRANSFER&reference_id=99
?date_from=2026-05-01&date_to=2026-05-31
?created_by=admin
```

Expected (200):

```jsonc
{
  "status": "success",
  "data": {
    "data": [
      {
        "id": 1,
        "entity_type": "PRODUCT",
        "entity_id": 10,
        "product_code": "P-001",
        "product_name": "T-Shirt",
        "barcode": "P-001",
        "category": "Apparel",
        "size": "M",
        "location_type": "WAREHOUSE",
        "location_id": 5,
        "location_name": "Gudang SBY",
        "movement_type": "TRANSFER_OUT",
        "quantity": 50,
        "qty_before": 100,
        "qty_after": 50,
        "reference_id": 99,
        "reference_type": "STOCK_TRANSFER",
        "reference_code": "TRF-202605-0001",
        "reference_subtype": "DO",
        "destination_name": "Toko Mandalika SBY-A",
        "created_by": "admin@mandalika.com",
        "created_at": "2026-05-20T08:00:00.000Z"
      }
    ],
    "len": 234
  },
  "query": { /* echo */ }
}
```

### 8.4 Contoh request — Export

```http
GET {{base_url}}/api/app/inventory/monitoring/stock-movement/export?location_type=WAREHOUSE&location_id=5&date_from=2026-05-01&date_to=2026-05-31
Cookie: session={{session_id}}
```

Expected (200): `text/csv; charset=utf-8` body diawali UTF-8 BOM, header CRLF-separated:

```
ID,Entity Type,Entity ID,Product Code,Product Name,Location Type,Location ID,Location Name,Movement Type,Quantity,Qty Before,Qty After,Reference ID,Reference Type,Reference Code,Destination/Source,Created By,Created At
```

Bila data kosong (200 JSON):

```jsonc
{
  "status": "success",
  "data":   { "message": "Tidak ada data untuk di-export" }
}
```

Bila > 50.000 baris (400):

```jsonc
{
  "status":  "error",
  "message": "Hasil melebihi batas export (50000 baris). Persempit filter terlebih dahulu."
}
```

---

## 9. Activity log

Service ini **read-only** — tidak menulis ke `logging_activities`. Audit-trail-nya sendiri sudah ada di `stock_movements` (kolom `created_by` + `created_at`) yang ditulis oleh modul mutasi sumber (FG, RM, GR, DO, TG, Return).

> Jika di masa depan ditambah endpoint maintenance (mis. purge / archive), `CreateLogger` payload mengikuti pola modul lain: `{ activity: "STOCK_MOVEMENT_PURGE", description: "...", email: session.email }`.

---

## 10. Checklist saat menambah fitur

- [ ] Update `stock-movement.schema.ts` — Zod chain (preprocess/transform/refine/default/min/max/regex/error msg) verbatim.
- [ ] TDD: tulis test (`src/tests/inventory/monitoring/stock-movement/`) **sebelum** implementasi.
- [ ] Update `stock-movement.service.ts` — tetap `$queryRaw` dengan **Prisma.sql parametrized** dan **identifier whitelist** untuk ORDER BY (lihat §1.J.B dev-flow SOP).
- [ ] Bila ada filter baru yang menyentuh kolom belum terindeks → buat migration index baru (lihat §5.2).
- [ ] Update file ini (§3 DTO, §4 routing, §6 error catalog, §8 Postman example).
- [ ] Update [`./frontend-integration.md`](./frontend-integration.md) — schema verbatim, endpoint table, service code, hook code.
- [ ] Update folder Postman `Inventory → Monitoring → Stock Movement` di `docs/postman/erp-mandalika.postman_collection.json`.
- [ ] Jalankan `rtk tsc --noEmit` → no errors.
- [ ] Jalankan `npx vitest run src/tests/inventory/monitoring/stock-movement/` → all green.

---

## 11. Referensi silang

- [`../../README.md`](../../README.md) — index modul `inventory`
- [`../README.md`](../README.md) — index sub-modul `inventory/monitoring`
- [`../../frontend-integration.md`](../../frontend-integration.md) — konvensi global FE modul inventory
- [`./frontend-integration.md`](./frontend-integration.md) — BE→FE contract per scope
- [`../stock-distribution/README.md`](../stock-distribution/README.md) — sibling: snapshot stok per-lokasi (matrix view)
- [`../../../../../prisma/schema.prisma`](../../../../../prisma/schema.prisma) — model `StockMovement` + enum Movement*Type
- [`../../../../../.claude/skills/dev-flow/SKILL.md`](../../../../../.claude/skills/dev-flow/SKILL.md) — SOP backend (§1.F type safety, §1.G status code, §1.I CSV export, §1.J service)
- ARCHITECTURE / CONVENTIONS / AUTH / ERROR_HANDLING / DATABASE — dokumen lintas-modul di `docs/`
