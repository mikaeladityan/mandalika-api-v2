# RFQ Module – Frontend Integration Guide

Base route frontend: `/app/(application)/rfq`

---

## 1. Types & DTOs

Buat file `rfq.schema.ts` di folder server feature. Gunakan Zod schema yang **mirror** backend:

```typescript
// app/src/app/(application)/rfq/server/rfq.schema.ts
import { z } from "zod";

export const RFQStatusEnum = z.enum([
    "DRAFT", "SENT", "RECEIVED", "APPROVED",
    "PARTIAL_CONVERTED", "CONVERTED", "CANCELLED",
]);

export type RFQStatus = z.infer<typeof RFQStatusEnum>;

export const RFQItemSchema = z.object({
    id: z.number().optional(),
    raw_material_id: z.number(),
    purchase_draft_id: z.number().nullable().optional(),
    quantity: z.number().positive(),
    unit_price: z.number().nonnegative().nullable().optional(),
    notes: z.string().nullable().optional(),
});

export const CreateRFQSchema = z.object({
    vendor_id: z.number().nullable().optional(),
    warehouse_id: z.number().nullable().optional(),
    date: z.string().optional(),
    notes: z.string().nullable().optional(),
    items: z.array(RFQItemSchema).min(1),
});

export const UpdateRFQStatusSchema = z.object({
    status: RFQStatusEnum,
});

export const ConvertToPOSchema = z.object({
    item_ids: z.array(z.number()).min(1),
    expected_arrival: z.string().optional(),
});

export const QueryRFQSchema = z.object({
    page: z.number().default(1),
    take: z.number().default(50),
    search: z.string().optional(),
    status: RFQStatusEnum.optional(),
    vendor_id: z.number().optional(),
    month: z.number().optional(),
    year: z.number().optional(),
    sortBy: z.string().optional(),
    order: z.enum(["asc", "desc"]).optional(),
});

export type CreateRFQDTO = z.infer<typeof CreateRFQSchema>;
export type QueryRFQDTO = z.infer<typeof QueryRFQSchema>;
export type ConvertToPODTO = z.infer<typeof ConvertToPOSchema>;

// Response types
export interface RFQItemResponse {
    id: number;
    rfq_id: number;
    raw_material_id: number;
    purchase_draft_id: number | null;
    quantity: string;
    unit_price: string | null;
    notes: string | null;
    raw_material: {
        id: number;
        barcode: string | null;
        name: string;
        unit_raw_material: { name: string };
    };
    purchase_draft?: {
        id: number;
        quantity: string;
        horizon: number;
        month: number;
        year: number;
    } | null;
}

export interface RFQResponse {
    id: number;
    rfq_number: string;
    status: RFQStatus;
    date: string;
    notes: string | null;
    vendor: { id: number; name: string; country: string } | null;
    warehouse: { id: number; name: string; code: string } | null;
    items: RFQItemResponse[];
    open_pos?: { id: number; po_number: string | null; quantity: string; status: string }[];
    _count?: { items: number; open_pos: number };
}
```

---

## 2. Service Layer

```typescript
// app/src/app/(application)/rfq/server/rfq.service.ts
import { api } from "@/lib/axios";
import { CreateRFQDTO, QueryRFQDTO, ConvertToPODTO } from "./rfq.schema";

export const RFQService = {
    list: (params: QueryRFQDTO) =>
        api.get<{ data: RFQResponse[]; total: number }>("/purchase/rfq", { params }).then((r) => r.data),

    detail: (id: number) =>
        api.get<RFQResponse>(`/purchase/rfq/${id}`).then((r) => r.data),

    create: (body: CreateRFQDTO) =>
        api.post<RFQResponse>("/purchase/rfq", body).then((r) => r.data),

    update: (id: number, body: Partial<CreateRFQDTO>) =>
        api.put<RFQResponse>(`/purchase/rfq/${id}`, body).then((r) => r.data),

    updateStatus: (id: number, status: string) =>
        api.patch<RFQResponse>(`/purchase/rfq/${id}/status`, { status }).then((r) => r.data),

    convertToPO: (id: number, body: ConvertToPODTO) =>
        api.post(`/purchase/rfq/${id}/convert`, body).then((r) => r.data),

    destroy: (id: number) =>
        api.delete(`/purchase/rfq/${id}`).then((r) => r.data),
};
```

---

## 3. TanStack Query Hooks

```typescript
// app/src/app/(application)/rfq/server/use.rfq.ts
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RFQService } from "./rfq.service";
import { CreateRFQDTO, ConvertToPODTO, QueryRFQDTO } from "./rfq.schema";

const KEY = "rfq";

export function useRFQList(params: QueryRFQDTO) {
    return useQuery({
        queryKey: [KEY, "list", params],
        queryFn: () => RFQService.list(params),
        staleTime: 30_000,
        placeholderData: keepPreviousData,
    });
}

export function useRFQDetail(id: number) {
    return useQuery({
        queryKey: [KEY, "detail", id],
        queryFn: () => RFQService.detail(id),
        enabled: !!id,
    });
}

export function useRFQMutations() {
    const queryClient = useQueryClient();
    const invalidate = () => queryClient.invalidateQueries({ queryKey: [KEY] });

    const create = useMutation({
        mutationFn: (body: CreateRFQDTO) => RFQService.create(body),
        onSuccess: () => { invalidate(); toast.success("RFQ berhasil dibuat"); },
        onError: (e: any) => toast.error(e.message || "Gagal membuat RFQ"),
    });

    const update = useMutation({
        mutationFn: ({ id, body }: { id: number; body: Partial<CreateRFQDTO> }) =>
            RFQService.update(id, body),
        onSuccess: () => { invalidate(); toast.success("RFQ berhasil diupdate"); },
        onError: (e: any) => toast.error(e.message || "Gagal update RFQ"),
    });

    const updateStatus = useMutation({
        mutationFn: ({ id, status }: { id: number; status: string }) =>
            RFQService.updateStatus(id, status),
        onSuccess: () => { invalidate(); toast.success("Status RFQ diperbarui"); },
        onError: (e: any) => toast.error(e.message || "Gagal update status"),
    });

    const convertToPO = useMutation({
        mutationFn: ({ id, body }: { id: number; body: ConvertToPODTO }) =>
            RFQService.convertToPO(id, body),
        onSuccess: () => { invalidate(); toast.success("Item berhasil dikonversi ke Open PO"); },
        onError: (e: any) => toast.error(e.message || "Gagal konversi ke PO"),
    });

    const destroy = useMutation({
        mutationFn: (id: number) => RFQService.destroy(id),
        onSuccess: () => { invalidate(); toast.success("RFQ dihapus"); },
        onError: (e: any) => toast.error(e.message || "Gagal hapus RFQ"),
    });

    return { create, update, updateStatus, convertToPO, destroy };
}
```

---

## 4. Table State Hook (URL-synced)

```typescript
// use.rfq-table-state.ts — gunakan pola dari useRecomendationV2TableState
import { useState } from "react";
import { useQueryParams } from "@/shared/hooks";

export function useRFQTableState() {
    const { get, batchSet } = useQueryParams();

    const page  = Number(get("page")  ?? 1);
    const take  = Number(get("take")  ?? 50);
    const month = Number(get("month") ?? new Date().getMonth() + 1);
    const year  = Number(get("year")  ?? new Date().getFullYear());
    const status = get("status") as any ?? undefined;
    const [searchKey, setSearchKey] = useState(0);

    const setDebouncedSearch = (val: string) =>
        batchSet({ search: val || undefined, page: "1" });

    const reset = () => {
        setSearchKey((k) => k + 1);
        batchSet({ search: undefined, page: "1", status: undefined });
    };

    const queryParams = {
        page, take, month, year,
        search: get("search") ?? undefined,
        status,
        sortBy: get("sortBy") ?? undefined,
        order: (get("order") as "asc" | "desc") ?? "desc",
    };

    return {
        page, take, month, year, status, searchKey,
        setPage:  (p: number) => batchSet({ page: String(p) }),
        setTake:  (t: number) => batchSet({ take: String(t), page: "1" }),
        setMonth: (m: number) => batchSet({ month: String(m), page: "1" }),
        setYear:  (y: number) => batchSet({ year: String(y), page: "1" }),
        setStatus: (s: string | undefined) => batchSet({ status: s, page: "1" }),
        setDebouncedSearch,
        setSorting: (s: string, o: "asc" | "desc") =>
            batchSet({ sortBy: s, order: o, page: "1" }),
        reset,
        queryParams,
    };
}
```

---

## 5. UI Patterns

### Status Badge

```tsx
// components/rfq-status-badge.tsx
const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
    DRAFT:             { label: "Draft",           className: "bg-slate-100  text-slate-600"   },
    SENT:              { label: "Terkirim",         className: "bg-blue-100   text-blue-700"    },
    RECEIVED:          { label: "Diterima",         className: "bg-indigo-100 text-indigo-700"  },
    APPROVED:          { label: "Disetujui",        className: "bg-green-100  text-green-700"   },
    PARTIAL_CONVERTED: { label: "Sebagian PO",      className: "bg-orange-100 text-orange-700"  },
    CONVERTED:         { label: "Selesai → PO",     className: "bg-emerald-100 text-emerald-700"},
    CANCELLED:         { label: "Dibatalkan",       className: "bg-red-100    text-red-700"     },
};

export function RFQStatusBadge({ status }: { status: string }) {
    const cfg = STATUS_CONFIG[status] ?? { label: status, className: "bg-slate-100 text-slate-600" };
    return (
        <span className={`px-2 py-0.5 rounded-full text-[11px] font-black ${cfg.className}`}>
            {cfg.label}
        </span>
    );
}
```

### Status Transition Buttons

Hanya tampilkan tombol aksi yang valid untuk status saat ini:

```tsx
const NEXT_ACTIONS: Record<string, { label: string; status: string; variant: string }[]> = {
    DRAFT:             [{ label: "Kirim ke Vendor",  status: "SENT",      variant: "blue"   },
                        { label: "Batalkan",         status: "CANCELLED", variant: "red"    }],
    SENT:              [{ label: "Tandai Diterima",  status: "RECEIVED",  variant: "indigo" },
                        { label: "Batalkan",         status: "CANCELLED", variant: "red"    }],
    RECEIVED:          [{ label: "Setujui",          status: "APPROVED",  variant: "green"  },
                        { label: "Batalkan",         status: "CANCELLED", variant: "red"    }],
    APPROVED:          [{ label: "Konversi ke PO",   status: "__convert", variant: "emerald"}],
    PARTIAL_CONVERTED: [{ label: "Konversi Sisa PO", status: "__convert", variant: "orange" }],
};
```

Status `__convert` membuka dialog `ConvertToPODialog` alih-alih langsung patch status.

### ConvertToPO Dialog

Dialog ini muncul saat tombol "Konversi ke PO" diklik:
1. Tampilkan checklist semua items RFQ yang belum dikonversi
2. Input `expected_arrival` (date picker)
3. Submit → `convertToPO.mutate({ id, body: { item_ids: selectedIds, expected_arrival } })`

### Create/Edit Form

Form dua bagian:
1. **Header** — vendor (searchable combobox dari `/api/app/shared/suppliers`), warehouse, date, notes
2. **Items table** — tambah/hapus baris: raw_material (combobox), quantity, unit_price, notes

Gunakan `react-hook-form` + Zod resolver dengan `CreateRFQSchema`.

---

## 6. Page Structure

```
app/(application)/rfq/
├── page.tsx                        # List RFQ (DataTable + filters)
├── [id]/
│   └── page.tsx                    # Detail RFQ + status actions
├── create/
│   └── page.tsx                    # Form buat RFQ manual
└── server/
    ├── rfq.schema.ts
    ├── rfq.service.ts
    └── use.rfq.ts
```

---

## 7. Integration dengan Konsolidasi

Saat user klik **"Buat RFQ"** dari halaman Konsolidasi (setelah approval):

```typescript
// Di ConsolidationPage — tombol per baris atau bulk
const { create } = useRFQMutations();

const handleCreateFromDraft = (draft: ConsolidationRow) => {
    create.mutate({
        vendor_id: draft.supplier_id ?? null,
        items: [{
            raw_material_id: draft.material_id,
            purchase_draft_id: draft.id,   // link ke MaterialPurchaseDraft
            quantity: Number(draft.quantity),
        }],
    });
};
```

Satu RFQ per vendor direkomendasikan — group items berdasarkan `supplier_id` sebelum `create.mutate`.

---

## 8. Troubleshooting

| Masalah | Solusi |
|---|---|
| `400 Bad Request` saat create | Pastikan `items` min 1 dan `raw_material_id` valid |
| `Duplicate purchase_draft_id` error | Draft sudah terhubung ke RFQ lain; cek di halaman Konsolidasi |
| Status tidak bisa ditransisi | Cek valid transitions; `CONVERTED` dan `CANCELLED` adalah terminal |
| Convert gagal | RFQ harus `APPROVED` atau `PARTIAL_CONVERTED`; pastikan `item_ids` ada di RFQ tersebut |
| RFQ tidak bisa dihapus | Hanya `DRAFT` yang bisa dihapus; batalkan dulu jika perlu |
