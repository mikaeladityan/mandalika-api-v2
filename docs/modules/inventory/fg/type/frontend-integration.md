# Inventory / FG / Type — Frontend Integration (Scope Level)

Kontrak BE→FE untuk scope master data tipe produk FG. Dokumen ini fokus pada **kontrak schema + endpoint + service + hooks**. Component (List/Form/Dialog/Columns/Page) mengikuti SOP canonical [frontend-dev-flow](../../../../.claude/skills/frontend-dev-flow/SKILL.md) — tidak di-duplicate di sini.

**Backend scope path**: `api/src/module/application/inventory/fg/type/`
**Frontend scope path**: `app/src/app/(application)/inventory/fg/types/server/`
**Endpoint base**: `/api/app/inventory/fg/types`
**Status FE**: 🚧 TBD <!-- ubah ke ✅ Ready setelah file FE dibuat -->

**Dependencies**:

- Konvensi global modul ([`../../frontend-integration.md`](../../frontend-integration.md)) — CSRF, queryKey naming, error pattern, debounce, design tokens, status code expectation.
- BE scope doc ([`./README.md`](./README.md)) — Zod schema source, endpoint detail, error catalog.
- SOP canonical: [frontend-dev-flow](../../../../.claude/skills/frontend-dev-flow/SKILL.md).

Master data **ProductType** (mis. `Parfum EDP`, `Parfum EDT`) yang dipakai sebagai FK `Product.type_id`. Slug auto-derived dari `name` di service (`normalizeSlug(name)`) — FE **tidak** mengirim slug. Master ini juga di-upsert otomatis lewat `getOrCreateSlug` saat FG create/update/import; endpoint scope ini hanya untuk manual CRUD master.

---

## 1. Schema Mirror End-to-End

**Source BE**: `src/module/application/inventory/fg/type/type.schema.ts`. FE mirror WAJIB 1:1.

### 1.1 `RequestFGTypeSchema` (BE — verbatim)

```ts
import z from "zod";

export const RequestFGTypeSchema = z.object({
    name: z
        .string()
        .trim()
        .min(1, "Nama tipe wajib diisi")
        .max(50, "Nama tipe maksimal 50 karakter"),
});
```

**Field detail**:

| Field  | Type     | Required | Default | Constraint                    | Error msg                                                          | Catatan                                              |
| :----- | :------- | :------- | :------ | :---------------------------- | :----------------------------------------------------------------- | :--------------------------------------------------- |
| `name` | `string` | ✅       | —       | `trim()`, `min(1)`, `max(50)` | `"Nama tipe wajib diisi"` / `"Nama tipe maksimal 50 karakter"`     | Service derive `slug` lewat `normalizeSlug(name)`.   |

> ⚠️ **Tidak ada field `slug` di Request**. FE hanya kirim `name`. BE generate `slug` lewat `normalizeSlug(name)` di `src/lib/index.ts`. Lihat §6.

### 1.2 `ResponseFGTypeSchema` & DTO (BE — verbatim)

```ts
export const ResponseFGTypeSchema = z.object({
    id: z.number(),
    name: z.string(),
    slug: z.string(),
});

export type ResponseFGTypeDTO = z.infer<typeof ResponseFGTypeSchema>;
```

**Field response**:

| Field di response | Sumber Prisma         | Transformasi service                                  |
| :---------------- | :-------------------- | :---------------------------------------------------- |
| `id`              | `ProductType.id`      | as-is.                                                |
| `name`            | `ProductType.name`    | as-is.                                                |
| `slug`            | `ProductType.slug`    | auto-generated server-side via `normalizeSlug(name)`. |

> 💡 Tidak ada `created_at` / `updated_at` / `deleted_at` di model `ProductType` (master data sederhana, tanpa soft delete & timestamps).

### 1.3 `QueryFGTypeSchema` — GET / (BE — verbatim)

```ts
export const QueryFGTypeSchema = z.object({
    search: z.string().trim().min(1).optional(),
    page: z.coerce.number().int().positive().default(1),
    take: z.coerce.number().int().positive().max(100).default(25),
});

export type QueryFGTypeDTO = z.infer<typeof QueryFGTypeSchema>;
```

**Param detail**:

| Param    | Type     | Default | Constraint                       | Catatan                                          |
| :------- | :------- | :------ | :------------------------------- | :----------------------------------------------- |
| `search` | `string` | —       | `trim()`, `min(1)`               | ILIKE insensitive pada `name`. Trigram GIN.      |
| `page`   | `number` | `1`     | `coerce`, `int()`, `positive()`  | —                                                |
| `take`   | `number` | `25`    | `coerce`, `int()`, `1..100`      | Max 100 per page.                                |

> 💡 Tidak ada `sortBy` / `sortOrder` di query — BE hardcode `orderBy: { name: "asc" }`.

### 1.4 Tidak ada Bulk Action

Scope ini **tidak** punya bulk status / bulk delete / soft-delete / trash. CRUD only.

### 1.5 Prisma model referensi

```prisma
model ProductType {
  id       Int       @id @default(autoincrement())
  slug     String    @unique @db.VarChar(100)
  name     String    @db.VarChar(100)
  products Product[]

  @@index([name])
  @@map("product_types")
}
```

Lokasi BE: `prisma/schema.prisma`. Tidak ada enum khusus untuk scope ini.

---

## 2. FE Schema Mirror

**File**: `app/src/app/(application)/inventory/fg/types/server/inventory.fg.type.schema.ts` 🚧 TBD

```ts
import { z } from "zod";

export const RequestFGTypeSchema = z.object({
    name: z
        .string()
        .trim()
        .min(1, "Nama tipe wajib diisi")
        .max(50, "Nama tipe maksimal 50 karakter"),
});

export type RequestFGTypeDTO = z.input<typeof RequestFGTypeSchema>;

export const ResponseFGTypeSchema = z.object({
    id: z.number(),
    name: z.string(),
    slug: z.string(),
});

export type ResponseFGTypeDTO = z.infer<typeof ResponseFGTypeSchema>;

export const QueryFGTypeSchema = z.object({
    search: z.string().trim().min(1).optional(),
    page: z.coerce.number().int().positive().default(1),
    take: z.coerce.number().int().positive().max(100).default(25),
});

export type QueryFGTypeDTO = z.infer<typeof QueryFGTypeSchema>;
```

**Diff vs BE**: tidak ada deviation. Mirror 1:1.

---

## 3. Routing — Endpoint Table

Path prefix: **`/api/app/inventory/fg/types`**. Verified terhadap `type.routes.ts` + status code di `type.controller.ts`.

| Method | Path    | Body                            | Query              | Success status | Response shape                                    | Handler                  |
| :----- | :------ | :------------------------------ | :----------------- | :------------- | :------------------------------------------------ | :----------------------- |
| GET    | `/`     | —                               | `QueryFGTypeDTO`   | `200`          | `{ data: ResponseFGTypeDTO[]; len: number }`      | `FGTypeController.list`  |
| POST   | `/`     | `RequestFGTypeDTO`              | —                  | `201`          | `ResponseFGTypeDTO`                               | `FGTypeController.create`|
| PUT    | `/:id`  | `Partial<RequestFGTypeDTO>`     | —                  | `200`          | `ResponseFGTypeDTO`                               | `FGTypeController.update`|
| DELETE | `/:id`  | —                               | —                  | `200`          | `{}`                                              | `FGTypeController.delete`|

**Catatan**:

- **Slug auto-generated server-side** — FE **JANGAN** kirim `slug` di body POST/PUT. BE generate via `normalizeSlug(name)`.
- **`:id`** integer positif. Controller throw `400 "ID tidak valid"` bila bukan integer ≥ 1.
- **`PUT`** menerima body partial (lewat `RequestFGTypeSchema.partial()`); body kosong → no-op return existing.
- **Error catalog** (slug duplicate `P2002`, not-found `P2025`, FK guard `_count.products > 0`) lihat [`./README.md`](./README.md) §Error.
- **Mutation endpoints** (POST/PUT/DELETE) butuh CSRF → FE wajib `setupCSRFToken()` sebelum call.

---

## 4. Service Class — FULL CODE

**File**: `app/src/app/(application)/inventory/fg/types/server/inventory.fg.type.service.ts` 🚧 TBD

```ts
import api from "@/lib/api";
import { setupCSRFToken } from "@/shared/api/csrf";
import type { ApiSuccessResponse } from "@/shared/types/api";
import type {
    RequestFGTypeDTO,
    ResponseFGTypeDTO,
    QueryFGTypeDTO,
} from "./inventory.fg.type.schema";

const API = `${process.env.NEXT_PUBLIC_API}/api/app/inventory/fg/types`;

export class InventoryFGTypeService {
    static async list(
        params: QueryFGTypeDTO,
    ): Promise<{ data: ResponseFGTypeDTO[]; len: number }> {
        try {
            const { data } = await api.get<
                ApiSuccessResponse<{ data: ResponseFGTypeDTO[]; len: number }>
            >(API, { params });
            return data.data;
        } catch (error) {
            throw error;
        }
    }

    static async create(body: RequestFGTypeDTO): Promise<ResponseFGTypeDTO> {
        try {
            await setupCSRFToken();
            const { data } = await api.post<ApiSuccessResponse<ResponseFGTypeDTO>>(
                API,
                body,
            );
            return data.data;
        } catch (error) {
            throw error;
        }
    }

    static async update(
        id: number,
        body: Partial<RequestFGTypeDTO>,
    ): Promise<ResponseFGTypeDTO> {
        try {
            await setupCSRFToken();
            const { data } = await api.put<ApiSuccessResponse<ResponseFGTypeDTO>>(
                `${API}/${id}`,
                body,
            );
            return data.data;
        } catch (error) {
            throw error;
        }
    }

    static async remove(id: number): Promise<void> {
        try {
            await setupCSRFToken();
            await api.delete(`${API}/${id}`);
        } catch (error) {
            throw error;
        }
    }
}
```

> 💡 **Tidak ada** `detail`, `changeStatus`, `bulkStatus`, `clean`, `exportCsv` di scope ini — BE tidak expose endpoint-endpoint tersebut.

---

## 5. Hooks — 5 Hook Split FULL CODE

**File**: `app/src/app/(application)/inventory/fg/types/server/use.inventory.fg.type.ts` 🚧 TBD

```ts
"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { useState, useMemo, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useDebounce, useQueryParams } from "@/shared/hooks";
import { errorAtom, notificationAtom } from "@/shared/atoms";
import { FetchError } from "@/shared/api/errors";
import type { ResponseError } from "@/shared/types/api";
import { InventoryFGTypeService } from "./inventory.fg.type.service";
import type {
    RequestFGTypeDTO,
    ResponseFGTypeDTO,
    QueryFGTypeDTO,
} from "./inventory.fg.type.schema";

const KEY = ["inventory.fg.type"] as const;
// Invalidate juga ke FG list (relasi Product.type_id)
const FG_KEY = ["inventory.fg"] as const;

// ──────────────────────────────────────────────────────────────────────────────
// 5.1 READ — useQuery wrapper
// ──────────────────────────────────────────────────────────────────────────────
export function useInventoryFGType(params: QueryFGTypeDTO, enabled = true) {
    return useQuery<{ data: ResponseFGTypeDTO[]; len: number }, ResponseError>({
        queryKey: [...KEY, params],
        queryFn: () => InventoryFGTypeService.list(params),
        enabled,
        staleTime: 30_000,
    });
}

// ──────────────────────────────────────────────────────────────────────────────
// 5.2 WRITE — create + update mutations
// ──────────────────────────────────────────────────────────────────────────────
export function useFormInventoryFGType() {
    const setErr = useSetAtom(errorAtom);
    const setNotif = useSetAtom(notificationAtom);
    const queryClient = useQueryClient();

    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: KEY, type: "all" });
        queryClient.invalidateQueries({ queryKey: FG_KEY, type: "all" });
    };

    const create = useMutation<ResponseFGTypeDTO, ResponseError, RequestFGTypeDTO>({
        mutationKey: [...KEY, "create"],
        mutationFn: (body) => InventoryFGTypeService.create(body),
        onSuccess: () => {
            setNotif({
                title: "Tambah Tipe",
                message: "Berhasil menambahkan tipe produk baru",
            });
            invalidate();
        },
        onError: (err) => FetchError(err, setErr),
    });

    const update = useMutation<
        ResponseFGTypeDTO,
        ResponseError,
        { id: number; body: Partial<RequestFGTypeDTO> }
    >({
        mutationKey: [...KEY, "update"],
        mutationFn: ({ id, body }) => InventoryFGTypeService.update(id, body),
        onSuccess: () => {
            setNotif({
                title: "Ubah Tipe",
                message: "Berhasil memperbarui tipe produk",
            });
            invalidate();
        },
        onError: (err) => FetchError(err, setErr),
    });

    return { create, update };
}

// ──────────────────────────────────────────────────────────────────────────────
// 5.3 ACTION — delete (hard delete)
// ──────────────────────────────────────────────────────────────────────────────
export function useActionInventoryFGType() {
    const setErr = useSetAtom(errorAtom);
    const setNotif = useSetAtom(notificationAtom);
    const queryClient = useQueryClient();
    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: KEY, type: "all" });
        queryClient.invalidateQueries({ queryKey: FG_KEY, type: "all" });
    };

    const remove = useMutation<unknown, ResponseError, number>({
        mutationKey: [...KEY, "remove"],
        mutationFn: (id) => InventoryFGTypeService.remove(id),
        onSuccess: () => {
            setNotif({
                title: "Hapus Tipe",
                message: "Tipe produk berhasil dihapus",
            });
            invalidate();
        },
        onError: (err) => FetchError(err, setErr),
    });

    return { remove };
}

// ──────────────────────────────────────────────────────────────────────────────
// 5.4 TableState — URL sync + debounce search
// ──────────────────────────────────────────────────────────────────────────────
export function useInventoryFGTypeTableState() {
    const searchParams = useSearchParams();
    const { batchSet } = useQueryParams();

    const rawSearch = searchParams.get("search") ?? "";
    const [search, setSearchState] = useState(rawSearch);
    const debouncedSearch = useDebounce(search, 500);

    const setSearch = useCallback((val: string) => {
        setSearchState(val);
    }, []);

    // Sync ke URL setelah debounce
    useMemo(() => {
        batchSet({ search: debouncedSearch || null, page: "1" });
    }, [debouncedSearch, batchSet]);

    const page = Number(searchParams.get("page") ?? 1);
    const take = Number(searchParams.get("take") ?? 25);

    const queryParams = useMemo<QueryFGTypeDTO>(
        () => ({ page, take, search: debouncedSearch || undefined }),
        [page, take, debouncedSearch],
    );

    return { search, setSearch, page, take, queryParams };
}

// ──────────────────────────────────────────────────────────────────────────────
// 5.5 Query-wrapper — bundling list + tableState untuk page consumer
// ──────────────────────────────────────────────────────────────────────────────
export function useInventoryFGTypeQuery() {
    const tableState = useInventoryFGTypeTableState();
    const query = useInventoryFGType(tableState.queryParams);
    return { ...tableState, query };
}
```

> 💡 QueryKey root **`["inventory.fg.type"]`**. Setiap mutasi juga invalidate `["inventory.fg"]` karena FG list join lewat `Product.type_id` — perubahan nama tipe harus refleksi langsung di table FG.

---

## 6. End-to-End Flow per Operasi

### 6.1 Create

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant F as Form (react-hook-form)
    participant H as useFormInventoryFGType
    participant S as InventoryFGTypeService
    participant BE as Backend
    participant Q as QueryClient

    U->>F: Submit { name: "Parfum EDP" }
    F->>H: create.mutateAsync({ name })
    H->>S: InventoryFGTypeService.create(body)
    S->>BE: setupCSRFToken() → POST /api/app/inventory/fg/types
    BE->>BE: slug = normalizeSlug("Parfum EDP") → "parfum-edp"
    alt sukses
        BE-->>S: 201 { id, name, slug }
        H->>Q: invalidateQueries({ queryKey: ["inventory.fg.type"] })
        H->>Q: invalidateQueries({ queryKey: ["inventory.fg"] })
        H-->>F: onSuccess → setNotif("Tambah Tipe")
        F->>U: Dialog close + notif
    else slug duplikat (P2002)
        BE-->>S: 400 "Tipe \"Parfum EDP\" sudah tersedia"
        H-->>F: onError → FetchError(setErr)
    end
```

### 6.2 Update

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant H as useFormInventoryFGType
    participant S as InventoryFGTypeService
    participant BE as Backend

    U->>H: update.mutate({ id, body: { name } })
    H->>S: InventoryFGTypeService.update(id, body)
    S->>BE: setupCSRFToken() → PUT /:id
    alt body kosong (no name)
        BE-->>S: 200 existing (no-op)
    else name diisi
        BE->>BE: slug = normalizeSlug(name)
        alt sukses
            BE-->>S: 200 { id, name, slug }
        else P2025
            BE-->>S: 404 "Tipe produk tidak ditemukan"
        else P2002
            BE-->>S: 400 "Tipe \"...\" sudah digunakan"
        end
    end
    H-->>U: invalidate ["inventory.fg.type"] + ["inventory.fg"] + notif
```

### 6.3 Delete

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant C as List (columns action)
    participant H as useActionInventoryFGType
    participant S as InventoryFGTypeService
    participant BE as Backend

    U->>C: Klik "Hapus" + confirm()
    C->>H: remove.mutate(id)
    H->>S: InventoryFGTypeService.remove(id)
    S->>BE: setupCSRFToken() → DELETE /:id
    BE->>BE: findUnique + select _count.products
    alt not found
        BE-->>S: 404 "Tipe produk tidak ditemukan"
    else _count.products > 0
        BE-->>S: 400 "Tipe produk tidak dapat dihapus karena masih digunakan oleh produk"
    else aman
        BE-->>S: 200 {}
        H->>H: invalidate ["inventory.fg.type"] + ["inventory.fg"]
    end
    H-->>U: notif sesuai outcome
```

---

## 7. Edge Cases & Per-Scope Quirks

- **Slug auto-generated server-side** — FE **JANGAN** mengirim field `slug`. BE generate via `normalizeSlug(name)` di `src/lib/index.ts` (lowercase, kebab-case, ASCII). Field di response read-only untuk display.
- **Unique constraint** — `slug` `@unique`. Dua nama berbeda yang menormalisasi ke slug yang sama (mis. "Parfum EDP" vs "parfum  edp") akan trigger 400 dengan pesan `"Tipe \"<name>\" sudah tersedia"` (create) atau `"Tipe \"<name>\" sudah digunakan"` (update). Tangkap 400 → tampilkan inline di field `name`.
- **Master data auto-upsert lewat FG** — scope endpoint ini untuk **manual CRUD**. Saat FG create/update/import dijalankan, BE memanggil `getOrCreateSlug(productType, name)` yang otomatis insert tipe baru kalau belum ada. Artinya daftar tipe bisa bertambah tanpa user pernah membuka halaman ini → setelah operasi FG, **invalidate `["inventory.fg.type"]`** dari hook FG (atau sebaliknya gunakan `refetchOnWindowFocus`).
- **Delete protection (FK guard)** — BE menolak delete bila `_count.products > 0`. FE wajib `confirm()` user dan tampilkan pesan 400 BE apa adanya (sudah human-readable).
- **No-op update** — `PUT /:id` tanpa body `name` akan return existing tanpa error → consumer hook tetap menerima `ResponseFGTypeDTO`.
- **Tidak ada soft delete / trash** — hard delete only. Tidak ada toggle trash mode di list.
- **Tidak ada timestamps** — model `ProductType` tidak punya `created_at` / `updated_at` / `deleted_at`. Jangan render kolom-kolom ini.
- **Search debounce**: 500ms (via `useDebounce`). URL sync via `useQueryParams.batchSet` setelah debounce, reset `page=1`.
- **Sort fixed**: BE hardcode `orderBy: { name: "asc" }`. Tidak ada `sortBy` / `sortOrder` query param.
- **Cross-query invalidation**: setiap mutasi (create/update/remove) **juga** invalidate `["inventory.fg"]` karena FG table render `product.type.name`. Tanpa invalidate ini, edit nama tipe tidak langsung terlihat di table FG.

---

## 8. Cross-link

- **Component SOP (canonical)** — List, Form, Dialog, Columns, Page entry mengikuti pola di [frontend-dev-flow](../../../../.claude/skills/frontend-dev-flow/SKILL.md). Jangan duplicate snippet di sini.
- **FE testing SOP** — Vitest + RTL test untuk service, hook, dan component mengikuti [frontend-testing](../../../../.claude/skills/frontend-testing/SKILL.md).
- BE scope doc: [./README.md](./README.md)
- Module-level konvensi FE: [../../frontend-integration.md](../../frontend-integration.md)
- Parent scope BE: [../README.md](../README.md)
- Sibling scope: [../size/README.md](../size/README.md), [../import/README.md](../import/README.md)
- Postman folder: `Inventory / FG / Type` di `docs/postman/erp-mandalika.postman_collection.json`.
