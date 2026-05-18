# 🧱 Coding Conventions

Standar wajib untuk semua kontribusi backend. Ringkas, terukur, anti-debat di PR.

---

## 1. Module Layout

Setiap fitur = 1 folder dengan 4 file inti:

```
<feature>/
├── <feature>.routes.ts
├── <feature>.controller.ts
├── <feature>.service.ts
└── <feature>.schema.ts
```

Sub-fitur (mis. import, stock) jadi sub-folder dengan struktur yang sama.

**Aturan**:
- Tidak ada logic Prisma di controller.
- Tidak ada `c` (Hono Context) di service.
- Tidak ada validasi mendalam di route — pakai `validateBody`.

---

## 2. Routes

```ts
// foo.routes.ts
import { Hono } from "hono";
import { validateBody } from "../../../middleware/validation.js";
import { FooController } from "./foo.controller.js";
import { CreateFooSchema, UpdateFooSchema } from "./foo.schema.js";

const FooRoutes = new Hono();

FooRoutes.get("/", FooController.list);
FooRoutes.get("/:id", FooController.detail);
FooRoutes.post("/", validateBody(CreateFooSchema), FooController.create);
FooRoutes.put("/:id", validateBody(UpdateFooSchema), FooController.update);
FooRoutes.delete("/:id", FooController.destroy);

export default FooRoutes;        // atau `export const FooRoutes = ...`
```

**Order**:
1. Static path (`/export`, `/stats`, `/open-po`) DI ATAS dynamic (`/:id`).
2. Sub-route mount terakhir.
3. Naming endpoint mengikuti REST (`/`, `/:id`, `/:id/action`).

---

## 3. Controller

Static class:

```ts
import { Context } from "hono";
import { ApiResponse } from "../../../lib/api.response.js";
import { FooService } from "./foo.service.js";
import { QueryFooSchema } from "./foo.schema.js";

export class FooController {
    static async list(c: Context) {
        const query = QueryFooSchema.parse(c.req.query());
        const { data, total } = await FooService.list(query);
        return ApiResponse.sendSuccess(c, data, 200, { total, page: query.page, take: query.take });
    }

    static async create(c: Context) {
        const body = c.get("body");                  // sudah divalidasi
        const user = c.get("user");
        const data = await FooService.create(body, user);
        return ApiResponse.sendSuccess(c, data, 201);
    }
}
```

**Aturan**:
- `static async` method.
- Parse query lewat schema (`QueryFooSchema.parse(c.req.query())`).
- Param id konversi pakai `Number()` atau Zod coerce.
- Tidak ada try/catch — error otomatis ke `error.handler.ts`.

---

## 4. Service

Static class. Berisi business rule + Prisma.

```ts
import prisma from "../../../config/prisma.js";
import { ApiError } from "../../../lib/errors/api.error.js";
import type { CreateFooDTO } from "./foo.schema.js";

export class FooService {
    static async list(query: QueryFooDTO) {
        const where = {
            deleted_at: null,
            ...(query.search && { name: { contains: query.search, mode: "insensitive" as const } }),
        };
        const [data, total] = await Promise.all([
            prisma.foo.findMany({
                where,
                skip: (query.page - 1) * query.take,
                take: query.take,
                orderBy: { [query.sortBy]: query.order },
            }),
            prisma.foo.count({ where }),
        ]);
        return { data, total };
    }

    static async create(input: CreateFooDTO, user: { id: string }) {
        const exists = await prisma.foo.findUnique({ where: { code: input.code } });
        if (exists) throw new ApiError(409, "Kode sudah digunakan");

        return prisma.$transaction(async (tx) => {
            const foo = await tx.foo.create({ data: { ...input, created_by: user.id } });
            // operasi multi-tabel di sini
            return foo;
        });
    }
}
```

**Aturan**:
- Throw `ApiError(status, message, details?)`. Tidak return `{ ok: false }`.
- Operasi multi-tabel → `prisma.$transaction`.
- Hindari N+1: pakai `include` / `select` eksplisit.
- Soft delete pakai `deleted_at: new Date()`; query default `where: { deleted_at: null }`.

---

## 5. Schema (Zod)

```ts
// foo.schema.ts
import { z } from "zod";

export const CreateFooSchema = z.object({
    code: z.string({ error: "Kode wajib diisi" }).max(50),
    name: z.string().min(1).max(100),
    qty: z.number().int().nonnegative(),
});
export type CreateFooDTO = z.infer<typeof CreateFooSchema>;

export const UpdateFooSchema = CreateFooSchema.partial();
export type UpdateFooDTO = z.infer<typeof UpdateFooSchema>;

export const QueryFooSchema = z.object({
    page: z.coerce.number().min(1).default(1),
    take: z.coerce.number().min(1).max(100).default(25),
    search: z.string().optional(),
    sortBy: z.enum(["name", "code", "created_at", "updated_at"]).default("updated_at"),
    order: z.enum(["asc", "desc"]).default("desc"),
});
export type QueryFooDTO = z.infer<typeof QueryFooSchema>;
```

**Aturan**:
- Pesan error **Bahasa Indonesia**.
- Default page=1, take=25 (atau 50 utk Finance), max 100/200.
- Coerce query string (`z.coerce.number()`).
- Export DTO type pakai `z.infer`.
- Untuk update, gunakan `.partial()` jika seluruh field opsional.

---

## 6. Response Shape

Selalu via `ApiResponse`:

```ts
ApiResponse.sendSuccess(c, data, statusCode = 200, queryMeta?)
ApiResponse.sendError(c, statusCode = 500, message)
```

### Success

```json
{
  "query": { "total": 120, "page": 1, "take": 25 },
  "status": "success",
  "data": [...]
}
```

`query` opsional (untuk list/pagination).
`data` boleh object atau array.
Status code 201 untuk `POST` (create).

### Error (dari `error.handler.ts`)

```json
{
  "success": false,
  "error": "ValidationError",
  "message": "Validation failed",
  "details": { "issues": [{ "field": "body.code", "message": "Kode wajib diisi", "code": "..." }] },
  "requestId": "<uuid>"
}
```

---

## 7. Error Handling

```ts
import { ApiError, ConflictError, NotFoundError, UnauthorizedError, ForbiddenError } from "../../../lib/errors/api.error.js";

throw new ApiError(422, "Stok tidak cukup", { requested: 10, available: 3 });
throw new ConflictError("Kode sudah dipakai");
throw new NotFoundError("Purchase Order");
```

**Mapping otomatis** di `middleware/error.handler.ts`:

| Error class           | HTTP |
| :-------------------- | :--- |
| `ValidationError` (Zod) | 400 |
| `UnauthorizedError`   | 401  |
| `ForbiddenError`      | 403  |
| `NotFoundError`       | 404  |
| `ConflictError`       | 409  |
| `RateLimitError`      | 429 (+ headers `Retry-After`) |
| `HTTPException` (Hono) | sesuai status |
| Prisma `P2025`        | 404 (Record not found) |
| Lainnya               | 500  |

Lihat [`ERROR_HANDLING.md`](./ERROR_HANDLING.md).

---

## 8. Logging

```ts
import { logger } from "../../../lib/logger.js";

logger.info("RFQ created", { rfqId, userId });
logger.warn("CSRF mismatch", { path, sessionId });
logger.error("Failed to update stock", { error: err.message });
```

- Dev: pretty format dengan delimiter `==== INIT ==== ... ==== END ====`.
- Prod: JSON (untuk log aggregator).
- Tingkat: `error | warn | info | http | verbose | debug | silly` (atur via `LOG_LEVEL`).
- `dbLogger = logger.child({ label: "DATABASE" })` untuk operasi DB.

---

## 9. Konvensi Penamaan

| Item                    | Pattern                          | Contoh                          |
| :---------------------- | :------------------------------- | :------------------------------ |
| File                    | `kebab-case`                     | `purchase-order.service.ts`     |
| Class                   | `PascalCase`                     | `RFQController`, `POService`    |
| Function / Variable     | `camelCase`                      | `generateRFQNumber`, `dueDate`  |
| Zod schema              | `PascalCaseSchema`               | `CreateRFQSchema`, `QueryAPSchema` |
| DTO type                | `PascalCaseDTO`                  | `CreateRFQDTO`, `PayAPDTO`      |
| Enum prisma             | `PascalCase`                     | `POStatus`, `RFQStatus`         |
| Field DB                | `snake_case`                     | `created_at`, `po_number`       |
| Route path              | `kebab-case`                     | `/vendor-return`, `/stock-card` |
| Document number prefix  | UPPER + tahun-bulan-seq          | `RFQ-20260513-001`              |

---

## 10. Imports

ESM dengan `.js` extension wajib (karena `"type": "module"`):

```ts
// ✅
import { logger } from "../../../lib/logger.js";

// ❌
import { logger } from "../../../lib/logger";   // bakal error di runtime
```

---

## 11. Konvensi Test

- File: `src/tests/<module>/<feature>.<service|routes>.test.ts`.
- Setup global mock Prisma: `src/tests/setup.ts`.
- Unit test → mock Prisma per metode service.
- Integration test → pakai `app.request("/path", { ... })`.
- Coverage prioritas: business rule + edge case + status code.

Lihat [`TESTING.md`](./TESTING.md).

---

## 12. Document Numbering

Gunakan helper di `lib/utils/generate-number.ts`. Jangan generate manual.

```ts
import { generateRFQNumber, generatePONumber } from "../../../lib/utils/generate-number.js";

const rfq_number = await generateRFQNumber(prisma);   // "RFQ-20260513-001"
const po_number  = await generatePONumber(prisma);    // "PO-20260513-001"
```

Detail format → [`DOCUMENT_NUMBERING.md`](./DOCUMENT_NUMBERING.md).

---

## 13. Transaksi & Konsistensi Inventaris

Operasi yang menyentuh **stok** (`ProductInventory`, `RawMaterialInventory`, `OutletInventory`) + **movement audit** WAJIB:

1. Pakai `prisma.$transaction(async (tx) => {...})`.
2. Tulis ke `StockMovement` dengan `ref_type` + `ref_id` yang benar.
3. Validasi stok cukup (throw `422` jika `qty < requested`).
4. Hindari race: gunakan `tx.productInventory.update({ where: { product_id_warehouse_id: ... }, data: { quantity: { decrement: qty } } })`.

Helper bersama: `inventory-v2/inventory.helper.ts` (lihat sub-modul Inventory V2).

---

## 14. Anti-Pola

- ❌ Logic Prisma di controller.
- ❌ `try { ... } catch (e) { return c.json({ error: e.message }, 500); }` di handler — biarkan `error.handler.ts` yang urus.
- ❌ Generate document number manual (`Math.random()`, `Date.now()`, dll).
- ❌ Validasi ulang field yang sudah lewat Zod.
- ❌ Hardcoded warehouse code (`"GFG-SBY"`, `"GRM-PRD"`) di service — pakai parameter atau query DB.
- ❌ String literal enum (`"FINISH_GOODS"`) — pakai enum Prisma (`WarehouseType.FINISH_GOODS`).
- ❌ `console.log` di service/middleware — pakai `logger`.

---

_Lihat juga: [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`TESTING.md`](./TESTING.md)._
