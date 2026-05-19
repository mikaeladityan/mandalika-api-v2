# Inventory / RM / Unit — Frontend Integration (Scope Level)

Kontrak BE→FE untuk scope ini: schema mirror, endpoint routing, service class, hooks, flow Mermaid, edge cases. Komponen React (List/Form/Dialog/Columns) **diserahkan ke SOP [frontend-dev-flow](../../../../.claude/skills/frontend-dev-flow/SKILL.md)** saat FE engineer kerja di `app/`.

**Backend scope path**: `api/src/module/application/inventory/rm/unit/`
**Frontend scope path**: `app/src/app/(application)/inventory/rm/units/server/`
**Endpoint base**: `/api/app/inventory/rm/units`
**Status FE**: 🚧 TBD <!-- ubah ke ✅ Ready setelah file FE dibuat -->

**Dependencies**: konvensi global modul ([`../../frontend-integration.md`](../../frontend-integration.md)), BE scope doc ([`./README.md`](./README.md)), SOP [frontend-dev-flow](../../../../.claude/skills/frontend-dev-flow/SKILL.md).

Master data **satuan/UoM** untuk Raw Material (mis. `ML`, `KG`, `PCS`, `LITER`). Slug auto-generate server-side via `normalizeSlug(name)`; FE hanya kirim `name`. Hard delete dengan FK pre-check ke `RawMaterial`.

---

## 1. Schema Mirror End-to-End

**Source BE**: `src/module/application/inventory/rm/unit/unit.schema.ts`. FE mirror WAJIB 1:1.

### 1.1 Block Zod verbatim BE

```ts
import { z } from "zod";

export const IdParamSchema = z.object({
    id: z.coerce.number().int().positive("ID unit tidak valid"),
});

export const RequestRawMaterialUnitSchema = z.object({
    name: z
        .string({ error: "Nama unit tidak boleh kosong" })
        .min(1, "Nama unit tidak boleh kosong")
        .max(100, "Nama unit maksimal 100 karakter"),
});

export const UpdateRawMaterialUnitSchema = RequestRawMaterialUnitSchema.partial().refine(
    (v) => v.name !== undefined,
    { message: "Field name wajib diisi" },
);

export const QueryRawMaterialUnitSchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    take: z.coerce.number().int().positive().max(100).default(25),
    search: z.string().trim().min(1).optional(),
    sortBy: z.enum(["name", "slug", "id"]).default("name"),
    sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

export const ResponseRawMaterialUnitSchema = z.object({
    id: z.number(),
    name: z.string(),
    slug: z.string(),
});
```

### 1.2 Tabel field

**`RequestRawMaterialUnitSchema`**:

| Field  | Type     | Required | Constraint            | Error msg                                                              | Catatan                       |
| :----- | :------- | :------- | :-------------------- | :--------------------------------------------------------------------- | :---------------------------- |
| `name` | `string` | ✅       | `min(1)`, `max(100)`  | `"Nama unit tidak boleh kosong"` / `"Nama unit maksimal 100 karakter"` | Trim + slug auto di service.  |

**`UpdateRawMaterialUnitSchema`** — partial + refine `v.name !== undefined`:

| Field  | Type      | Required    | Constraint                              | Error msg                  | Catatan                                                                |
| :----- | :-------- | :---------- | :-------------------------------------- | :------------------------- | :--------------------------------------------------------------------- |
| `name` | `string?` | ✅ (refine) | inherits `min(1)`, `max(100)` saat ada  | `"Field name wajib diisi"` | Service defense ekstra: 400 `"Nama unit wajib diisi"` saat falsy.      |

**`QueryRawMaterialUnitSchema`**:

| Param       | Type                       | Default  | Constraint                | Catatan                                          |
| :---------- | :------------------------- | :------- | :------------------------ | :----------------------------------------------- |
| `page`      | `number` (int)             | `1`      | `coerce`, `int`, `> 0`    | —                                                |
| `take`      | `number` (int)             | `25`     | `coerce`, `int`, `1..100` | —                                                |
| `search`    | `string?`                  | —        | `trim`, `min(1)`          | ILIKE `name` + `slug` (`insensitive`).           |
| `sortBy`    | `"name" \| "slug" \| "id"` | `"name"` | whitelist                 | Dropdown FE wajib match.                         |
| `sortOrder` | `"asc" \| "desc"`          | `"asc"`  | enum                      | —                                                |

**`ResponseRawMaterialUnitSchema`** — fields `id`, `name`, `slug` saja. **TIDAK** ada `created_at`/`updated_at`/`deleted_at`/`status` (model `UnitRawMaterial` tidak punya kolom tersebut). Lihat §6.

### 1.3 DTO export & enum

```ts
export type IdParamDTO = z.infer<typeof IdParamSchema>;
export type RequestRawMaterialUnitDTO = z.infer<typeof RequestRawMaterialUnitSchema>;
export type UpdateRawMaterialUnitDTO = z.infer<typeof UpdateRawMaterialUnitSchema>;
export type QueryRawMaterialUnitDTO = z.infer<typeof QueryRawMaterialUnitSchema>;
export type ResponseRawMaterialUnitDTO = z.infer<typeof ResponseRawMaterialUnitSchema>;
```

Enum: scope ini **tidak memakai enum** (tidak ada `status`/`gender`). Tidak perlu import dari `@/shared/types`.

---

## 2. FE Schema Mirror

**File**: `app/src/app/(application)/inventory/rm/units/server/inventory.rm.unit.schema.ts` 🚧 TBD

Copy block §1.1 + §1.3 verbatim ke file FE (hilangkan `IdParamSchema` jika tidak dipakai — path param di-handle axios). Diff vs BE = **empty**.

Response tidak memuat `created_at`/`updated_at`/`deleted_at`/`status`. FE jangan mendeklarasikan kolom timestamp/status di DTO / column tabel — model `UnitRawMaterial` di Prisma tidak punya field tersebut.

---

## 3. Routing — Endpoint Table

Path prefix: `/api/app/inventory/rm/units`. Sumber: `unit.routes.ts` + status code dari `unit.controller.ts` (`ApiResponse.sendSuccess(c, data, <code>)`).

| #   | Method        | Path        | Body / Query                            | Response (status) | Error utama                                                                                                                  |
| :-- | :------------ | :---------- | :-------------------------------------- | :---------------- | :--------------------------------------------------------------------------------------------------------------------------- |
| 1   | `GET`         | `/`         | Query `QueryRawMaterialUnitDTO`         | `200` `{ data: ResponseRawMaterialUnitDTO[], len: number }` | 400 (Zod fail di `QueryRawMaterialUnitSchema.parse`)                                                                          |
| 2   | `POST`        | `/`         | Body `RequestRawMaterialUnitDTO`        | `201` `ResponseRawMaterialUnitDTO` | 400 `"Unit dengan nama tersebut sudah tersedia"` (P2002 slug dup) / 400 Zod (`"Nama unit tidak boleh kosong"` / `"Nama unit maksimal 100 karakter"`) |
| 3   | `GET`         | `/:id`      | Path `id` (int)                         | `200` `ResponseRawMaterialUnitDTO` | 400 `"ID unit tidak valid"` / 404 `"Unit tidak ditemukan"` (P2025)                                                              |
| 4   | `PUT`         | `/:id`      | Body `UpdateRawMaterialUnitDTO`         | `200` `ResponseRawMaterialUnitDTO` | 400 `"Field name wajib diisi"` (refine) / 400 `"Nama unit wajib diisi"` (service defense) / 400 P2002 / 404 P2025               |
| 4b  | `PATCH`       | `/:id`      | Body `UpdateRawMaterialUnitDTO`         | `200` `ResponseRawMaterialUnitDTO` | Sama persis dengan PUT — handler & schema identik (alias).                                                                    |
| 5   | `DELETE`      | `/:id`      | Path `id` (int)                         | `200` `{ deleted: number }` | 400 `"Satuan masih digunakan oleh beberapa Raw Material"` (FK pre-check di `rawMaterial.count({ where: { unit_id } })`) / 404 P2025 |

Catatan:

- **Hard delete** — tidak ada `?trash=1` filter, tidak ada `restore`. FK pre-check 400 = bukan 409.
- **Tidak ada endpoint `/status`** — model `UnitRawMaterial` tidak punya kolom `status`. Tidak ada `changeStatus` / `bulkStatus`.
- **Tidak ada endpoint `/bulk`** — belum ada bulk operasi di scope ini.
- **Tidak ada `/export` / `/import`** — scope minimal CRUD.
- 201 hanya pada `POST /`. Read / update / delete = 200.

---

## 4. Service Class — FULL CODE

**File**: `app/src/app/(application)/inventory/rm/units/server/inventory.rm.unit.service.ts` 🚧 TBD

```ts
import api from "@/lib/api";
import { setupCSRFToken } from "@/shared/api/csrf";
import type { ApiSuccessResponse } from "@/shared/types/api";
import type {
    QueryRawMaterialUnitDTO,
    RequestRawMaterialUnitDTO,
    ResponseRawMaterialUnitDTO,
} from "./inventory.rm.unit.schema";

const API = `${process.env.NEXT_PUBLIC_API}/api/app/inventory/rm/units`;

export class InventoryRMUnitService {
    static async list(params: QueryRawMaterialUnitDTO): Promise<{ data: ResponseRawMaterialUnitDTO[]; len: number }> {
        try {
            const { data } = await api.get<ApiSuccessResponse<{ data: ResponseRawMaterialUnitDTO[]; len: number }>>(API, { params });
            return data.data;
        } catch (error) { throw error; }
    }

    static async detail(id: number): Promise<ResponseRawMaterialUnitDTO> {
        try {
            const { data } = await api.get<ApiSuccessResponse<ResponseRawMaterialUnitDTO>>(`${API}/${id}`);
            return data.data;
        } catch (error) { throw error; }
    }

    static async create(body: RequestRawMaterialUnitDTO): Promise<void> {
        try {
            await setupCSRFToken();
            await api.post(API, body);
        } catch (error) { throw error; }
    }

    static async update(id: number, body: Partial<RequestRawMaterialUnitDTO>): Promise<void> {
        try {
            await setupCSRFToken();
            // BE accept PUT atau PATCH dengan schema yang sama (UpdateRawMaterialUnitSchema)
            await api.put(`${API}/${id}`, body);
        } catch (error) { throw error; }
    }

    static async remove(id: number): Promise<{ deleted: number }> {
        try {
            await setupCSRFToken();
            const { data } = await api.delete<ApiSuccessResponse<{ deleted: number }>>(`${API}/${id}`);
            return data.data;
        } catch (error) {
            // BE 400 "Satuan masih digunakan oleh beberapa Raw Material" kalau FK masih dipakai.
            throw error;
        }
    }
}
```

> **Tidak ada** `changeStatus`/`bulkStatus`/`clean`/`exportCsv` — scope ini minimal CRUD; tidak ada status field & belum ada bulk endpoint.

---

## 5. Hooks — 5 Hook Split FULL CODE

**File**: `app/src/app/(application)/inventory/rm/units/server/use.inventory.rm.unit.ts` 🚧 TBD

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
import { InventoryRMUnitService } from "./inventory.rm.unit.service";
import type {
    QueryRawMaterialUnitDTO,
    RequestRawMaterialUnitDTO,
    ResponseRawMaterialUnitDTO,
} from "./inventory.rm.unit.schema";

const KEY = ["inventory.rm.unit"] as const;

// 5.1 READ
export function useInventoryRMUnit(params: QueryRawMaterialUnitDTO, enabled = true) {
    return useQuery<{ data: ResponseRawMaterialUnitDTO[]; len: number }, ResponseError>({
        queryKey: [...KEY, params],
        queryFn: () => InventoryRMUnitService.list(params),
        enabled,
        staleTime: 30_000,
    });
}
export function useInventoryRMUnitDetail(id: number, enabled = true) {
    return useQuery<ResponseRawMaterialUnitDTO, ResponseError>({
        queryKey: [...KEY, id],
        queryFn: () => InventoryRMUnitService.detail(id),
        enabled: enabled && Boolean(id),
    });
}

// 5.2 WRITE — create + update
export function useFormInventoryRMUnit() {
    const setErr = useSetAtom(errorAtom);
    const setNotif = useSetAtom(notificationAtom);
    const qc = useQueryClient();
    const invalidate = () => qc.invalidateQueries({ queryKey: KEY, type: "all" });

    const create = useMutation<unknown, ResponseError, RequestRawMaterialUnitDTO>({
        mutationKey: [...KEY, "create"],
        mutationFn: (body) => InventoryRMUnitService.create(body),
        onSuccess: () => { setNotif({ title: "Tambah Unit", message: "Berhasil menambahkan satuan baru" }); invalidate(); },
        onError: (err) => FetchError(err, setErr),
    });
    const update = useMutation<unknown, ResponseError, { id: number; body: Partial<RequestRawMaterialUnitDTO> }>({
        mutationKey: [...KEY, "update"],
        mutationFn: ({ id, body }) => InventoryRMUnitService.update(id, body),
        onSuccess: () => { setNotif({ title: "Ubah Unit", message: "Berhasil memperbarui satuan" }); invalidate(); },
        onError: (err) => FetchError(err, setErr),
    });
    return { create, update };
}

// 5.3 ACTION — delete only (NO status — model UnitRawMaterial tidak punya kolom status)
export function useActionInventoryRMUnit() {
    const setErr = useSetAtom(errorAtom);
    const setNotif = useSetAtom(notificationAtom);
    const qc = useQueryClient();
    const invalidate = () => qc.invalidateQueries({ queryKey: KEY, type: "all" });

    const remove = useMutation<{ deleted: number }, ResponseError, { id: number }>({
        mutationKey: [...KEY, "remove"],
        mutationFn: ({ id }) => InventoryRMUnitService.remove(id),
        onSuccess: () => { setNotif({ title: "Hapus Unit", message: "Satuan berhasil dihapus" }); invalidate(); },
        onError: (err) => FetchError(err, setErr),
    });
    return { remove };
}

// 5.4 TableState — URL sync + debounce
export function useInventoryRMUnitTableState() {
    const sp = useSearchParams();
    const { batchSet } = useQueryParams();
    const [search, setSearchState] = useState(sp.get("search") ?? "");
    const debouncedSearch = useDebounce(search, 500);
    const setSearch = useCallback((v: string) => setSearchState(v), []);
    useMemo(() => { batchSet({ search: debouncedSearch || null, page: "1" }); }, [debouncedSearch, batchSet]);

    const page = Number(sp.get("page") ?? 1);
    const take = Number(sp.get("take") ?? 25);
    const sortBy = (sp.get("sortBy") ?? "name") as QueryRawMaterialUnitDTO["sortBy"];
    const sortOrder = (sp.get("sortOrder") ?? "asc") as QueryRawMaterialUnitDTO["sortOrder"];

    const queryParams = useMemo<QueryRawMaterialUnitDTO>(
        () => ({ page, take, search: debouncedSearch || undefined, sortBy, sortOrder }),
        [page, take, debouncedSearch, sortBy, sortOrder],
    );
    return { search, setSearch, page, take, sortBy, sortOrder, queryParams };
}

// 5.5 Query-wrapper
export function useInventoryRMUnitQuery() {
    const tableState = useInventoryRMUnitTableState();
    const query = useInventoryRMUnit(tableState.queryParams);
    return { ...tableState, query };
}
```

queryKey root: `["inventory.rm.unit", params]`. Tidak ada `changeStatus`/`bulkStatus`/`trash mode` — lihat §7.

---

## 6. End-to-End Flow per Operasi

### 6.1 Create

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant F as Form
    participant H as useFormInventoryRMUnit
    participant S as InventoryRMUnitService
    participant BE as Backend
    participant Q as QueryClient

    U->>F: Submit { name: "Kilogram" }
    F->>F: zodResolver(RequestRawMaterialUnitSchema)
    F->>H: create.mutateAsync(body)
    H->>S: create(body)
    S->>BE: setupCSRFToken() → POST /api/app/inventory/rm/units
    Note over BE: trim(name) + normalizeSlug → "kilogram"
    alt P2002 slug dup
        BE-->>S: 400 "Unit dengan nama tersebut sudah tersedia"
    else ok
        BE-->>S: 201 { id, name, slug }
        H->>Q: invalidateQueries({ queryKey: ["inventory.rm.unit"], type: "all" })
        H-->>F: notif "Tambah Unit"
    end
```

### 6.2 Update

```mermaid
sequenceDiagram
    autonumber
    participant H as useFormInventoryRMUnit
    participant S as InventoryRMUnitService
    participant BE as Backend

    H->>S: update({ id, body })
    S->>BE: setupCSRFToken() → PUT /:id
    Note over BE: refine name!==undefined; service regen slug
    alt refine fail
        BE-->>S: 400 "Field name wajib diisi"
    else P2002
        BE-->>S: 400 "Unit dengan nama tersebut sudah tersedia"
    else P2025
        BE-->>S: 404 "Unit tidak ditemukan"
    else ok
        BE-->>S: 200 { id, name, slug }
        S-->>H: invalidate + notif
    end
```

### 6.3 Delete (HARD with FK pre-check)

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant L as List
    participant H as useActionInventoryRMUnit
    participant S as InventoryRMUnitService
    participant BE as Backend

    U->>L: confirm("Hapus satuan X?") → OK
    L->>H: remove.mutate({ id })
    H->>S: remove(id)
    S->>BE: setupCSRFToken() → DELETE /:id
    Note over BE: pre-check prisma.rawMaterial.count({ unit_id: id })
    alt usedCount > 0
        BE-->>S: 400 "Satuan masih digunakan oleh beberapa Raw Material"
    else P2025
        BE-->>S: 404 "Unit tidak ditemukan"
    else ok
        BE-->>S: 200 { deleted: 1 }
        H-->>L: invalidate + notif
    end
```

---

## 7. Edge Cases & Per-Scope Quirks

- **NO timestamp fields**: model `UnitRawMaterial` tidak punya `created_at`/`updated_at`/`deleted_at`. Jangan render kolom tersebut; jangan harapkan field di response.
- **NO status field**: tidak ada kolom `status`. Tidak ada `changeStatus`/`bulkStatus`/badge status. "Arsip" via hard delete (kalau tidak dipakai).
- **NO trash mode**: hard delete only. Tidak ada `?trash=1` filter.
- **Slug auto-generated server-side**: FE **hanya kirim `name`**. Slug jangan diisi di form — `normalizeSlug(name)` jalan di service. Slug muncul di response untuk display.
- **Hard delete dengan FK pre-check (400)**: BE cek `rawMaterial.count({ where: { unit_id } })`. Kalau > 0 → 400 `"Satuan masih digunakan oleh beberapa Raw Material"`. Surface eksplisit ke user (modal `errorAtom`) — beda dari error generic.
- **Slug unique (P2002)**: nama setelah normalize sama dengan slug existing → 400 `"Unit dengan nama tersebut sudah tersedia"`. Kasus umum: input `"KG"` saat slug `kg` sudah ada.
- **PUT vs PATCH equivalent**: BE pasang handler sama untuk PUT & PATCH dengan `UpdateRawMaterialUnitSchema`. FE pakai PUT konsisten.
- **Debounce search**: 500ms via `useDebounce`. URL sync via `batchSet` setelah debounce.
- **Sort whitelist**: hanya `name`/`slug`/`id`. Input lain → 400 Zod fail.
- **Bulk endpoint**: belum ada. Tambah saat BE provide.
- **Optimistic UI**: tidak diaktifkan — payload kecil, invalidate cukup cepat.

---

## 8. Cross-link

- BE scope doc: [./README.md](./README.md)
- Module-level konvensi FE: [../../frontend-integration.md](../../frontend-integration.md)
- Sibling scope FE doc: [`../category/frontend-integration.md`](../category/frontend-integration.md) (pola identik)
- SOP FE canonical (component implementation — List page, Form, Dialog, Columns markup): [frontend-dev-flow](../../../../.claude/skills/frontend-dev-flow/SKILL.md). **No status badge / timestamp columns** untuk scope ini — pakai variant component di SOP yang minimal (id · name · slug · actions).
- SOP FE testing (Vitest + RTL untuk service stub, hook render, form interaction): [frontend-testing](../../../../.claude/skills/frontend-testing/SKILL.md). Lokasi test: `app/src/__tests__/inventory/rm/unit/` 🚧 TBD.
- Postman folder: `Inventory → RM → Units` di `docs/postman/erp-mandalika.postman_collection.json`.
