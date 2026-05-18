---
name: frontend-dev-flow
description: ERP Mandalika Frontend Development Flow. Panduan end-to-end membangun modul frontend — dari Schema/DTO, Service, Query Hooks, Page, Columns, List Component, Form, sampai Dialog. Gunakan saat memulai fitur baru di app/src/app/(application)/[feature]/.
---

# ERP Mandalika — Frontend Development Flow

Panduan canonical membangun modul frontend baru. Ikuti urutan step ini untuk setiap fitur.

**Prasyarat:** Backend selesai. Endpoint stabil, schema backend terdefinisi di `api/`.

---

## SOP — Module Path & Naming Mirror Backend

**Frontend module path WAJIB cermin backend module path** supaya kontrak end-to-end konsisten dan navigasi cepat.

| Layer    | Backend                                            | Frontend                                                   |
| -------- | -------------------------------------------------- | ---------------------------------------------------------- |
| Module   | `api/src/module/application/[module]/`             | `app/src/app/(application)/[module]/server/`               |
| Sub      | `api/src/module/application/[module]/[sub]/`       | `app/src/app/(application)/[module]/[sub]/server/`         |
| Component| —                                                  | `app/src/components/pages/[module]/[sub]/`                 |

**Aturan tambahan:**

- Sub-module yang berdiri sendiri (punya endpoint/CRUD sendiri) WAJIB punya folder `server/` sendiri di frontend.
- Schema field, enum, dan response shape WAJIB sinkron 1:1 dengan backend Zod schema. Kalau backend ekspor enum (`APStatusEnum`, `STATUS`), frontend re-derive dari sumber yang sama (`@/shared/types`) atau salin enum value persis.
- Plural/singular ikut backend. Backend `product` → kalau frontend folder sudah `products`, sub-module tetap mengikuti backend (`product/stock` → `products/stocks` boleh, tapi nama file tetap dot-chain backend identifier — lihat aturan naming di bawah).

---

## Arsitektur Direktori

```
app/src/
├── app/(application)/[module]/
│   ├── page.tsx                          # Next.js entry — Suspense wrapper saja
│   ├── [id]/page.tsx                     # Detail page
│   ├── [id]/edit/page.tsx
│   ├── create/page.tsx                   # Create page (jika tidak pakai dialog)
│   ├── server/                           # Module-level layer
│   │   ├── [module].schema.ts            # Zod DTOs
│   │   ├── [module].service.ts           # Axios fetchers (static class)
│   │   └── use.[module].ts               # TanStack Query + Mutation hooks
│   └── [sub]/                            # Sub-module — mirror backend api/src/module/application/[module]/[sub]/
│       ├── page.tsx
│       ├── [id]/page.tsx
│       └── server/
│           ├── [module].[sub].schema.ts  # Dot-chain naming (lihat aturan)
│           ├── [module].[sub].service.ts
│           └── use.[module].[sub].ts
└── components/pages/[module]/
    ├── index.tsx                         # List component ("use client")
    ├── detail.tsx
    ├── form/
    │   ├── create.tsx                    # Form body (reusable: dialog + page)
    │   ├── edit.tsx
    │   └── [module]-form-dialog.tsx
    ├── table/columns.tsx                 # ColumnDef array
    └── [sub]/                            # Komponen sub-module
        ├── index.tsx
        ├── form/
        └── table/columns.tsx
```

**Aturan naming file sub-module:**

- Dot-chain: `[parent].[sub].(schema|service).ts`, `use.[parent].[sub].ts`. Contoh: `product.stock.schema.ts`, `product.stock.service.ts`, `use.product.stock.ts`.
- Class service: `[Parent][Sub]Service` (contoh: `ProductStockService`).
- Hook: `use[Parent][Sub]`, `use[Parent][Sub]Detail`, `useForm[Parent][Sub]`, `use[Parent][Sub]TableState`, `use[Parent][Sub]Query`.
- Alasan dot-chain: file gampang dikenali tanpa konteks folder — penting saat search global (`Cmd+P`).

---

## Step 1 — Zod Schema & DTO

`app/src/app/(application)/[module]/server/[module].schema.ts`
Sub-module: `app/src/app/(application)/[module]/[sub]/server/[module].[sub].schema.ts`

**End-to-end contract:** sebelum tulis schema, baca dulu `api/src/module/application/[module]/[sub]/[sub].schema.ts`. Field name, enum value, optional/required, dan default WAJIB persis sama. Diff = bug runtime.

```ts
import z from "zod";
import { STATUS } from "@/shared/types";

export const Request[Feature]Schema = z.object({
    name: z.string().min(3).max(100),
    status: z.enum(STATUS).default("PENDING").optional(),
});

export const Response[Feature]Schema = Request[Feature]Schema.extend({
    id: z.number(),
    created_at: z.coerce.date(),
    updated_at: z.coerce.date(),
    deleted_at: z.coerce.date().nullable(),
});

export const Query[Feature]Schema = z.object({
    page: z.number().int().positive().default(1).optional(),
    take: z.number().int().positive().max(100).default(25).optional(),
    search: z.string().optional(),
    status: z.enum(STATUS).optional(),
    sortBy: z.enum(["name", "created_at", "updated_at"]).default("created_at"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export type Request[Feature]DTO = z.input<typeof Request[Feature]Schema>;
export type Response[Feature]DTO = z.infer<typeof Response[Feature]Schema>;
export type Query[Feature]DTO = z.infer<typeof Query[Feature]Schema>;
```

- `z.input<>` untuk Request, `z.infer<>` untuk Response & Query
- `STATUS` dari `@/shared/types` — jangan re-define
- `z.coerce.date()` untuk semua field tanggal dari API

---

## Step 2 — Service Layer

`app/src/app/(application)/[feature]/server/[feature].service.ts`

```ts
import { api, setupCSRFToken } from "@/lib/api";
import { ApiSuccessResponse, STATUS } from "@/shared/types";
import { Query[Feature]DTO, Request[Feature]DTO, Response[Feature]DTO } from "./[feature].schema";

const API = `${process.env.NEXT_PUBLIC_API}/api/app/[feature]`;

export class [Feature]Service {
    static async list(params: Query[Feature]DTO) {
        try {
            const { data } = await api.get<ApiSuccessResponse<{ len: number; data: Array<Response[Feature]DTO> }>>(API, { params });
            return data.data;
        } catch (error) {
            throw error;
        }
    }
    static async detail(id: number) {
        try {
            const { data } = await api.get<ApiSuccessResponse<Response[Feature]DTO>>(`${API}/${id}`);
            return data.data;
        } catch (error) {
            throw error;
        }
    }
    static async create(body: Request[Feature]DTO) {
        try {
            await setupCSRFToken();
            await api.post(API, body);
        } catch (error) {
            throw error;
        }
    }
    static async update(body: Partial<Request[Feature]DTO>, id: number) {
        try {
            await setupCSRFToken();
            await api.put(`${API}/${id}`, body);
        } catch (error) {
            throw error;
        }
    }
    static async changeStatus(id: number, status: (typeof STATUS)[number]) {
        try {
            await setupCSRFToken();
            await api.patch(`${API}/status/${id}`, null, { params: { status } });
        } catch (error) {
            throw error;
        }
    }
    static async bulkStatus(ids: number[], status: (typeof STATUS)[number]) {
        try {
            await setupCSRFToken();
            await api.put(`${API}/bulk-status`, { ids, status });
        } catch (error) {
            throw error;
        }
    }
}
```

- Static class — tidak perlu instantiasi
- `setupCSRFToken()` **wajib** sebelum POST/PUT/PATCH/DELETE
- **Wajib try/catch + `throw error`** di setiap method. Error tetap bubble ke hook layer (`FetchError(err, setErr)`), tapi pattern try/catch konsisten di seluruh service supaya gampang inject logging/transform di masa depan tanpa refactor besar
- Jangan handle error di dalam catch (no toast, no alert) — biar hook yang urus via `onError`

---

## Step 3 — Query & Mutation Hooks

`app/src/app/(application)/[module]/server/use.[module].ts` (atau `use.[module].[sub].ts` untuk sub-module)

**Import wajib:**

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { useDebounce, useQueryParams } from "@/shared/hooks";   // ← bukan @/lib
import { errorAtom, notificationAtom } from "@/shared/store";
import { FetchError } from "@/lib/utils/error";
```

**Responsibility split per hook (WAJIB pisah, jangan campur):**

| Hook                       | Tanggung jawab                                            | Dipakai di                            |
| -------------------------- | --------------------------------------------------------- | ------------------------------------- |
| `use[Module]`              | LIST + DETAIL (gabung, dipisah via `enabled` flag)        | List page + Detail page               |
| `useForm[Module]`          | Mutation create/update                                    | Form component (dialog/page)          |
| `useAction[Module]`        | Mutation action: status change, bulk, custom verb         | Bulk bar, action button per row       |
| `use[Module]TableState`    | Search debounced, sort, filter, pagination via URL params | List component                        |
| `use[Module]Query`         | Wrapper konsumsi `use[Module]` + flatten `data/meta`      | List component (data binding)         |

Sub-module ikuti pola sama dengan prefix nama: `useProductStock`, `useFormProductStock`, dst.

**READ hook:**

```ts
export function use[Feature](params?: Query[Feature]DTO, id?: number) {
    const list = useQuery({
        queryKey: ["[feature]s", params],
        queryFn: () => [Feature]Service.list(params as Query[Feature]DTO),
        enabled: !!params && !id,
    });
    const detail = useQuery({
        queryKey: ["[feature]s", id],
        queryFn: () => [Feature]Service.detail(Number(id)),
        enabled: !!id && !params,
    });
    return { [feature]s: list.data, [feature]: detail.data,
        isLoading: detail.isLoading, isError: list.isError || detail.isError,
        isFetching: list.isFetching || detail.isFetching,
        isRefetching: list.isRefetching || detail.isRefetching };
}
```

**WRITE hook (pola create — update sama):**

```ts
export function useForm[Feature]() {
    const setErr = useSetAtom(errorAtom);
    const setNotif = useSetAtom(notificationAtom);
    const queryClient = useQueryClient();

    const create = useMutation<unknown, ResponseError, Request[Feature]DTO>({
        mutationKey: ["[feature]", "create"],
        mutationFn: (body) => [Feature]Service.create(body),
        onSuccess: () => {
            setNotif({ title: "Tambah [Feature]", message: "Berhasil menambahkan data baru" });
            queryClient.invalidateQueries({ queryKey: ["[feature]s"], type: "all" });
        },
        onError: (err) => FetchError(err, setErr),
    });
    // update: mutationFn: ({ body, id }) => [Feature]Service.update(body, id)
    return { create, update };
}
```

**ACTION hook:** sama pola WRITE — pisah jadi `useAction[Module]` untuk verb non-CRUD (status change, bulk, restore, approve, dll).

```ts
export function useAction[Feature]() {
    const setErr = useSetAtom(errorAtom);
    const setNotif = useSetAtom(notificationAtom);
    const queryClient = useQueryClient();

    const changeStatus = useMutation({
        mutationFn: ({ id, status }: { id: number; status: (typeof STATUS)[number] }) => [Feature]Service.changeStatus(id, status),
        onSuccess: () => {
            setNotif({ title: "Ubah Status", message: "Status berhasil diubah" });
            queryClient.invalidateQueries({ queryKey: ["[feature]s"], type: "all" });
        },
        onError: (err) => FetchError(err, setErr),
    });
    const bulkStatus = useMutation({ /* sama pola, terima { ids, status } */ });
    return { changeStatus, bulkStatus };
}
```

**TABLE STATE hook:**

```ts
export function use[Feature]TableState() {
    const { get, batchSet, searchParams } = useQueryParams();
    const [search, setSearch] = useState(get("search") ?? "");
    const debouncedSearch = useDebounce(search, 500);
    useEffect(() => { batchSet({ search: debouncedSearch || undefined, page: "1" }); }, [debouncedSearch]);

    const sortBy = get("sortBy") ?? "created_at";
    const sortOrder = (get("sortOrder") as "asc" | "desc") ?? "desc";
    const onSort = useCallback((key: string) => {
        const nextOrder = sortBy === key && sortOrder === "asc" ? "desc" : "asc";
        batchSet({ sortBy: key, sortOrder: nextOrder, page: "1" });
    }, [sortBy, sortOrder]);

    const status = get("status") as Query[Feature]DTO["status"];
    const isTrashMode = status === "DELETE";
    const toggleTrashMode = () => batchSet({ status: isTrashMode ? undefined : "DELETE", page: "1" });
    const resetFilters = () => { setSearch(""); batchSet({ search: undefined, status: undefined, sortBy: undefined, sortOrder: undefined, page: "1" }); };

    const queryParams = useMemo<Query[Feature]DTO>(() => ({
        take: Number(get("take") ?? 25), page: Number(get("page") ?? 1),
        search: get("search") ?? undefined, sortBy: sortBy as any, sortOrder, status,
    }), [searchParams]);

    return { search, setSearch, sortBy, sortOrder, onSort, isTrashMode, toggleTrashMode,
        resetFilters, queryParams, setPage: (p: number) => batchSet({ page: String(p) }),
        setPageSize: (t: number) => batchSet({ take: String(t), page: "1" }) };
}

export function use[Feature]Query(params: Query[Feature]DTO) {
    const q = use[Feature](params);
    return { data: q.[feature]s?.data ?? [], meta: q.[feature]s, ...q };
}
```

**Aturan hooks:**

- `useDebounce` & `useQueryParams` import dari `@/shared/hooks` — bukan dari `@/lib`
- queryKey: `["domain", params]` list, `["domain", id]` detail. Sub-module pakai prefix dot: `["product.stock", params]`
- `onError` selalu `FetchError(err, setErr)`
- `invalidateQueries({ queryKey: ["[feature]s"], type: "all" })` setelah mutasi sukses — invalidate semua varian queryKey domain
- Pisah strict: READ (`use[Module]`) / WRITE (`useForm[Module]`) / ACTION (`useAction[Module]`) / STATE (`use[Module]TableState`) / QUERY-WRAPPER (`use[Module]Query`)
- Search WAJIB pakai `useDebounce(search, 500)` + sync ke URL via `useQueryParams.batchSet`

---

## Step 4 — Page Entry

`app/src/app/(application)/[feature]/page.tsx`

```tsx
import { Suspense } from "react";
import { [Feature]s } from "@/components/pages/[feature]";

export default function [Feature]Page() {
    return <Suspense fallback={<div>Loading data...</div>}><[Feature]s /></Suspense>;
}
```

Hanya Suspense wrapper — tidak ada logic, tidak ada `"use client"`.

---

## Step 5 — Table Columns

`app/src/components/pages/[feature]/table/columns.tsx`

```tsx
"use client";
export const [Feature]Columns = ({ sortBy, sortOrder, onSort, onEdit }: Props): ColumnDef<Response[Feature]DTO>[] => [
    {
        id: "name", accessorKey: "name", enableHiding: false,
        header: () => <SortableHeader label="NAMA" sortKey="name" activeSortBy={sortBy} activeSortOrder={sortOrder} onSort={onSort} />,
        cell: ({ row }) => <span className="font-medium text-slate-800">{row.original.name}</span>,
    },
    {
        id: "created_at", header: "DIBUAT",
        cell: ({ row }) => <span className="text-zinc-500">{ParseDate(row.original.created_at)}</span>,
    },
    {
        id: "actions", header: "AKSI",
        cell: ({ row }) => (
            <Button variant="outline" size="sm"
                className="h-7 text-[10px] py-0 px-2 font-bold text-blue-600 hover:bg-blue-50 border-blue-200"
                onClick={() => onEdit?.(row.original.id)}>
                <Pencil className="h-3 w-3 mr-1" /> Edit
            </Button>
        ),
    },
];
```

- Header uppercase, `SortableHeader` untuk sortable columns
- Cell aksi: `h-7 text-[10px]`, warna semantik per aksi
- `enableHiding: false` untuk kolom identitas utama
- Tanggal: `ParseDate()` dari `@/lib/utils`

---

## Step 6 — List Component

`app/src/components/pages/[feature]/index.tsx` — `"use client"`

Struktur wajib:

```tsx
export function [Feature]s() {
    const table = use[Feature]TableState();
    const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
    const [createOpen, setCreateOpen] = useState(false);
    const [editId, setEditId] = useState<number | null>(null);
    const { data, meta, isLoading, isFetching, isRefetching } = use[Feature]Query(table.queryParams);
    const { bulkStatus } = useAction[Feature]();
    const columns = useMemo(() => [Feature]Columns({ ...table, onEdit: setEditId }), [table.sortBy, table.sortOrder]);
    const selectedIds = getSelectedIds(rowSelection).map(Number);
    const isTableLoading = isLoading || isFetching || isRefetching;

    return (
        <div className="flex flex-col gap-5">
            {/* h1 + p.text-muted-foreground */}
            <Card>
                <CardHeader className="space-y-4">
                    {/* InputGroup search — h-9 text-xs font-medium, result count */}
                    {/* Filter row: filter kiri | action kanan */}
                    {/* Filter: SelectFilter h-9 text-xs font-bold */}
                    {/* Reset button: variant="ghost" + FilterX — tampil jika hasActiveFilters */}
                    {/* Actions: bulk select bar | trash toggle (rose) | create button */}
                </CardHeader>
                <CardContent>
                    {isTableLoading ? <TableSkeleton /> : (
                        <DataTable tableId="[feature]-table" columns={columns} data={data}
                            page={table.queryParams.page || 1} pageSize={table.queryParams.take || 25}
                            total={meta?.len ?? 0} onPageChange={table.setPage} onPageSizeChange={table.setPageSize}
                            enableMultiSelect rowSelection={rowSelection} onRowSelectionChange={setRowSelection}
                            getRowId={(row: any) => String(row.id)} />
                    )}
                </CardContent>
            </Card>
            {/* Create + Edit dialogs */}
        </div>
    );
}
```

**Aturan layout:**

- Filter kiri, action kanan (flex justify-between)
- Bulk bar: N terpilih + Restore (trash mode) / Hapus (normal) + X clear
- Trash toggle: rose variant saat normal, muted saat trash mode
- Reset filter: tampil hanya saat `hasActiveFilters`

---

## Step 7 — Form Component

`app/src/components/pages/[feature]/form/create.tsx`

```tsx
"use client";
export function Create[Feature]Body({ onSuccess, onCancel }: Props) {
    const { create } = useForm[Feature]();
    const form = useForm<Request[Feature]DTO>({
        resolver: zodResolver(Request[Feature]Schema),
        defaultValues: { name: "", status: "ACTIVE" },
    });
    const onSubmit = async (body: Request[Feature]DTO) => {
        const res = await create.mutateAsync(body);
        onSuccess?.(res as Response[Feature]DTO);
    };
    return (
        <Form methods={form} onSubmit={form.handleSubmit(onSubmit)}>
            <div className="space-y-4">
                <InputForm required control={form.control} name="name" label="Nama"
                    placeholder="..." type="text" error={form.formState.errors.name} autoFocus />
            </div>
            <div className="flex gap-2 pt-4 justify-end border-t mt-4">
                <Button variant="ghost" size="sm" type="button" onClick={onCancel} className="w-1/4">Batal</Button>
                <Button size="sm" type="submit" disabled={create.isPending} className="w-1/2 font-bold shadow-lg shadow-primary/20">
                    {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Simpan
                </Button>
            </div>
        </Form>
    );
}
```

**WAJIB:** wrapper `<Form methods={...}>` dari `@/components/ui/form/main.tsx`. Jangan pakai `<form>` HTML langsung — context `FormProvider` dipakai semua field component.

**Komponen form tersedia di `@/components/ui/form/`:**

| Komponen                      | File                      | Kegunaan                         |
| ----------------------------- | ------------------------- | -------------------------------- |
| `<Form>`                      | `main.tsx`                | **WAJIB** — FormProvider wrapper |
| `<InputForm>`                 | `input.tsx`               | Text, number, email, password    |
| `<SelectForm>`                | `select.tsx`              | Dropdown static                  |
| `<SelectFilter>`              | `select.tsx`              | Filter di table                  |
| `<EnhancedCreatableCombobox>` | `createable.combobox.tsx` | Search + create                  |
| `<TextAreaForm>`              | `text.area.tsx`           | Textarea                         |
| `<MultiSelectForm>`           | `multi.select.tsx`        | Multi select                     |
| `<CheckboxForm>`              | `checkbox.tsx`            | Checkbox                         |
| `<DatePicker>`                | `date-picker.tsx`         | Date picker                      |
| `<MonthPicker>`               | `month-picker.tsx`        | Month picker                     |

- `<Form methods={form}>` — jangan pakai `<form>` langsung
- Resolver: `zodResolver(Request[Feature]Schema)`
- Setiap field: `control={form.control}` + `error={form.formState.errors.field}`

---

## Step 8 — Dialog Wrapper

`app/src/components/pages/[feature]/form/[feature]-form-dialog.tsx`

```tsx
export function Create[Feature]Dialog({ open, onOpenChange, children }: Props) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>Tambah [Feature] Baru</DialogTitle></DialogHeader>
                {children}
            </DialogContent>
        </Dialog>
    );
}
// Edit dialog sama, title: "Edit [Feature] #{[feature]Id}"
```

---

## API Client & Error Handling

**`app/src/lib/api/index.ts` — jangan diubah:**

- `withCredentials: true` aktif, cookie otomatis
- CSRF: cookie `NEXT_PUBLIC_XSRF_NAME` → header `NEXT_PUBLIC_XSRF_HEADER_NAME`
- 401 → `authErrorAtom("UNAUTHORIZED")`, 403 → `authErrorAtom("FORBIDDEN")`
- `setupCSRFToken()` = `GET /csrf` — wajib sebelum mutasi

**Error di hook layer:**

```ts
onError: (err) => FetchError(err, setErr),  // dari @/lib/utils/error
```

- Error → global `errorAtom` → global error UI
- Sukses → `notificationAtom`
- Jangan handle error manual di komponen atau service

---

## UI Design System (Gold/Zinc)

| Token               | Nilai                                                        | Penggunaan            |
| ------------------- | ------------------------------------------------------------ | --------------------- |
| `bg-primary`        | Gold `#D4AF37`                                               | CTA, active state     |
| Sidebar             | Zinc 950 `#18181B`                                           | Sidebar bg            |
| Background          | Slate 50 `#F8FAFC`                                           | Main bg               |
| Font                | Plus Jakarta Sans                                            | Semua teks            |
| Mono                | IBM Plex Mono                                                | SKU, kode, referensi  |
| Card                | `rounded-xl` 18px                                            | Semua card            |
| Button/Input radius | 10px                                                         | Input, select, button |
| Label               | `uppercase text-[10px] font-extrabold text-muted-foreground` | Semua label form      |
| Table header        | `text-[9px] uppercase`, sticky, Slate 50 bg                  | —                     |

**Komponen wajib `@/components/ui/`:** `Card/CardHeader/CardContent`, `Button`, `DataTable`, `SortableHeader`, `TableSkeleton`, `Dialog/DialogContent/DialogHeader/DialogTitle`, `InputGroup/InputGroupInput/InputGroupAddon`, `DialogAlert` (destructive confirm), `Badge`.

Komponen tambahan: gunakan Shadcn UI.

---

## Checklist Sebelum Commit

- [ ] **Module path mirror backend** — `app/(application)/[module]/[sub]/` ↔ `api/module/application/[module]/[sub]/`
- [ ] **Schema sinkron backend** — field, enum, default value persis sama dengan `api/.../[sub].schema.ts`
- [ ] File naming sub-module: dot-chain (`[parent].[sub].schema.ts`, `use.[parent].[sub].ts`)
- [ ] Schema: Request/Response/Query DTOs lengkap, diekspor
- [ ] Service: `setupCSRFToken()` di setiap POST/PUT/PATCH/DELETE
- [ ] Service: setiap method wrap try/catch + `throw error` (error tetap bubble, handler di hook layer)
- [ ] Hooks: pisah READ / WRITE / ACTION / TableState / Query-wrapper
- [ ] Hooks: `useDebounce` & `useQueryParams` import dari `@/shared/hooks`
- [ ] Hooks: queryKey konsisten, `invalidateQueries({ type: "all" })` post-mutasi
- [ ] Hooks: `onError: (err) => FetchError(err, setErr)` di setiap mutation
- [ ] Page entry: Suspense wrapper saja, tanpa logic
- [ ] Form: `<Form methods={form}>` dari `@/components/ui/form/main.tsx` — bukan `<form>` HTML; field pakai komponen di `@/components/ui/form/*`
- [ ] Bulk: trash mode → Restore, normal → Delete
- [ ] Reset filter: tampil hanya saat `hasActiveFilters`
- [ ] UI: Gold/Zinc design, `rounded-xl` card, Plus Jakarta Sans
- [ ] Thin client: tidak ada business logic di frontend
