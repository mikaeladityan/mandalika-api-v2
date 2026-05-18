# FG Import Migration — Design Spec

**Tanggal:** 2026-05-18
**Modul:** `inventory/fg/import`
**Status:** Approved — ready for plan & implementation

## 1. Tujuan

Migrasikan fitur import produk (CSV/XLSX) dari `src/module/application/product/import/` ke
`src/module/application/inventory/fg/import/`, mengikuti SOP yang baru diterapkan di modul FG:
type-safe (no `any`), ORM (no raw SQL), `ApiError` standar, Zod-driven validation.

**Non-tujuan:**
- Tidak mengubah kontrak file Excel (header & semantik kolom).
- Tidak menghapus modul lama (`product/import/`) — tetap dibiarkan aktif.
- Tidak memigrasi modul import lain (rawmat, recipe, stock).
- Tidak mengubah `ImportCacheService` internal.

## 2. Struktur Folder

```
api/src/module/application/inventory/fg/import/
├── import.routes.ts       # Hono router, sub-mount di FGRoutes
├── import.controller.ts   # FGImportController
├── import.service.ts      # FGImportService
└── import.schema.ts       # Zod schemas + DTOs

api/src/tests/inventory/fg/import/
├── import.service.test.ts
└── import.routes.test.ts
```

Mount di `fg.routes.ts`:

```ts
import { FGImportRoutes } from "./import/import.routes.js";
FGRoutes.route("/import", FGImportRoutes);
```

URL final: `/api/app/inventory/fg/import/{preview,execute,preview/:import_id}`.

Modul lama `product/import/` **tidak diubah** — endpoint `/api/app/products/import/*` tetap berfungsi.

## 3. Schema (SOP Compliant)

`import.schema.ts`:

```ts
export const FGImportRowSchema = z.object({
    "PRODUCT CODE": z.string().min(1),
    "PRODUCT NAME": z.string().min(1),
    TYPE: z.string().min(1),
    GENDER: z.string().optional().default(""),
    SIZE: z.preprocess(sanitizeNumber, z.coerce.number().positive()),
    UOM: z.string().min(1),
    EDAR: z.preprocess(sanitizeNumber, z.coerce.number().min(0).optional().default(0)),
    SAFETY: z.preprocess(sanitizeNumber, z.coerce.number().min(0).optional().default(0)),
});

export const RequestExecuteFGImportSchema = z.object({
    import_id: z.string().uuid("Import ID tidak valid"),
});

export type FGImportPreviewDTO = {
    code: string;
    name: string;
    gender: GENDER;
    size: number;
    type: string | null;
    unit: string | null;
    distribution_percentage: number;
    safety_percentage: number;
    errors: string[];
};

export type ResponseFGImportDTO = {
    import_id: string;
    total: number;
    valid: number;
    invalid: number;
};

export type RequestExecuteFGImportDTO = z.infer<typeof RequestExecuteFGImportSchema>;
```

`sanitizeNumber` di-copy dari versi lama (utility lokal).

## 4. Service (SOP Compliant)

`FGImportService`:

### 4.1 `preview(rows)`

Signature: `static async preview(rows: Array<Record<string, unknown>>): Promise<ResponseFGImportDTO>`.

- Parse tiap row dengan `FGImportRowSchema.safeParse`.
- Map ke `FGImportPreviewDTO[]` dengan field `errors[]` dari `parsed.error.issues`.
- Hitung total/valid/invalid.
- Generate `import_id = randomUUID()`.
- Simpan ke cache via `ImportCacheService.save("fg:import:", import_id, payload)`.
- Return summary.

**Cache prefix baru:** `fg:import:` (hindari collision dengan modul lain).

### 4.2 `execute(import_id)`

- Ambil cache → kalau tidak ada atau status `!= "preview"`, lempar `ApiError(400, "Import session expired, not found, or already executed")`.
- Filter `validRows = rows.filter(r => r.errors.length === 0)`. Kalau kosong, lempar `ApiError(400, "Tidak ada baris valid untuk diimport")`.
- Lock session: simpan ulang cache dengan status `"executing"`.
- Bulk insert via `bulkUpsert(validRows)`.
- Bersihkan cache, return `{ import_id, total: validRows.length }`.
- On error: rollback cache status `→ "preview"`, re-throw.

### 4.3 `bulkUpsert(rows)` (private)

Dedup by `code` (Map). Lalu di dalam `prisma.$transaction(async (tx) => { ... })`:

```ts
for (const row of finalData) {
    const [type_id, unit_id, size_id] = await Promise.all([
        row.type ? getOrCreateSlug(tx.productType, row.type) : null,
        row.unit ? getOrCreateSlug(tx.unit, row.unit) : null,
        row.size ? getOrCreateSize(tx, row.size) : null,
    ]);

    await tx.product.upsert({
        where: { code: row.code },
        create: {
            code: row.code,
            name: row.name,
            gender: row.gender,
            type_id,
            unit_id,
            size_id,
            distribution_percentage: row.distribution_percentage,
            safety_percentage: row.safety_percentage,
            status: STATUS.ACTIVE,
        },
        update: {
            name: row.name,
            gender: row.gender,
            type_id,
            unit_id,
            size_id,
            distribution_percentage: row.distribution_percentage,
            safety_percentage: row.safety_percentage,
            updated_at: new Date(),
        },
    });
}
```

`getOrCreateSize` di-ekstrak dari `fg.service.ts` ke `lib/utils/upsert-size.ts` agar reusable:

```ts
// lib/utils/upsert-size.ts
import { Prisma } from "../../generated/prisma/client.js";

export async function getOrCreateSize(tx: Prisma.TransactionClient, size: number): Promise<number> {
    const result = await tx.productSize.upsert({
        where: { size },
        update: {},
        create: { size },
        select: { id: true },
    });
    return result.id;
}
```

`fg.service.ts` akan diupdate untuk import helper baru ini (private method dihapus).

### 4.4 `getPreview(import_id)`

Sama seperti versi lama, ganti `Error` → `ApiError(404, ...)` dan `ApiError(400, ...)`.

### 4.5 `mapGender` helper

`private static mapGender(value: string): GENDER` — copy dari versi lama, tetap `WOMEN/MEN/UNISEX`.

## 5. Controller

```ts
export class FGImportController {
    static async preview(c: Context) {
        const { buffer, mimetype, filename } = await GetUploadedFile(c);
        const isXlsx =
            mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
            filename.endsWith(".xlsx");
        const rows = isXlsx ? await ParseXLSX(buffer) : ParseCSV(buffer);
        const result = await FGImportService.preview(rows);
        return ApiResponse.sendSuccess(c, result, 201);
    }

    static async execute(c: Context) {
        const { import_id } = c.get("body") as RequestExecuteFGImportDTO;
        const result = await FGImportService.execute(import_id);
        return ApiResponse.sendSuccess(c, result, 201);
    }

    static async getPreview(c: Context) {
        const import_id = c.req.param("import_id");
        if (!import_id) throw new ApiError(400, "Import ID wajib dilampirkan");
        const result = await FGImportService.getPreview(import_id);
        return ApiResponse.sendSuccess(c, result, 200);
    }
}
```

## 6. Routes

```ts
import { Hono } from "hono";
import { validateBody } from "../../../../../middleware/validation.js";
import { FGImportController } from "./import.controller.js";
import { RequestExecuteFGImportSchema } from "./import.schema.js";

export const FGImportRoutes = new Hono();

FGImportRoutes.get("/preview/:import_id", FGImportController.getPreview);
FGImportRoutes.post("/preview", FGImportController.preview);
FGImportRoutes.post(
    "/execute",
    validateBody(RequestExecuteFGImportSchema),
    FGImportController.execute,
);
```

## 7. Type Safety Verifikasi

Sebelum commit:

```bash
rtk tsc --noEmit
```

Tidak boleh ada:
- `any` (eksplisit/implisit)
- `unknown` tanpa narrow
- Cast paksa tanpa komentar `// reason: ...`

## 8. Tests

`src/tests/inventory/fg/import/import.service.test.ts`:

- `preview`:
  - Row valid → `errors: []`, mapping gender/type/unit benar.
  - Row invalid (missing field, size 0) → `errors[]` terisi.
  - `import_id` tersimpan ke cache.
- `execute`:
  - Cache tidak ada → `ApiError(400)`.
  - Cache status `"executing"` → `ApiError(400)`.
  - No valid rows → `ApiError(400)`.
  - Sukses → upsert dipanggil sesuai jumlah row dedupped, cache dihapus.
  - On error → cache di-rollback ke `"preview"`.
- `getPreview`:
  - Tidak ada → `ApiError(404)`.
  - Sudah executed → `ApiError(400)`.

`src/tests/inventory/fg/import/import.routes.test.ts`:

- `POST /preview` (multipart) → 201.
- `POST /execute` tanpa `import_id` → 400 (validateBody).
- `POST /execute` dengan `import_id` invalid UUID → 400.
- `GET /preview/:import_id` not found → 404.

## 9. Out of Scope (YAGNI)

- Tidak mengubah `ImportCacheService` (TTL, storage backend).
- Tidak mengubah signature `GetUploadedFile`, `ParseCSV`, `ParseXLSX`.
- Tidak refactor `mapGender` ke shared util — biarkan private di service (bisa dipindah saat ada modul ketiga yang butuh).
- Tidak hapus modul lama `product/import/`.

## 10. Resiko

- **Duplikasi kode**: Modul lama dan baru hidup berdampingan. Mitigasi: dokumentasikan di README modul FG bahwa endpoint baru adalah canonical, lama akan dideprekasikan.
- **Cache prefix berbeda**: Sesi yang dibuat oleh `/products/import` tidak bisa di-execute via `/inventory/fg/import` (beda prefix `product:import:` vs `fg:import:`). Ini *intended* — keduanya isolated.
- **`getOrCreateSize` extraction**: Mengubah `fg.service.ts`. Mitigasi: jalankan test FG existing setelah refactor — harus tetap 36/36 pass.
