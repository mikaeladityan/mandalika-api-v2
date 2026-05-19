# Inventory / RM / Import — Frontend Integration (Scope Level)

End-to-end FE integration **lengkap** untuk scope `inventory/rm/import` (bulk upload Raw Material via CSV/XLSX). FE engineer cukup baca file ini saja untuk implement dari nol.

**Backend scope path**: `api/src/module/application/inventory/rm/import/`
**Frontend scope path**: `app/src/app/(application)/inventory/rm/import/server/`
**Component path**: `app/src/components/pages/inventory/rm/import/`
**Endpoint base**: `/api/app/inventory/rm/import`
**Status FE**: 🚧 TBD <!-- ubah ke ✅ Ready setelah file FE dibuat -->

**Dependencies**:

- Konvensi global modul: [`../../frontend-integration.md`](../../frontend-integration.md) — CSRF policy, queryKey naming, error pattern, debounce, design tokens Gold/Zinc, status code expectation (201/202/200).
- BE scope doc: [`./README.md`](./README.md) — Zod schema source, endpoint detail, error catalog, BullMQ worker flow.
- SOP canonical: [frontend-dev-flow](../../../../../.claude/skills/frontend-dev-flow/SKILL.md).
- Counterpart scope: [`../../fg/import/frontend-integration.md`](../../fg/import/frontend-integration.md) — pattern import async identik (RM mengikuti shape FG).

Scope ini meng-handle wizard 3-langkah (Upload → Preview → Progress) untuk import Raw Material massal via Redis-cached preview + BullMQ worker async eksekusi. Header CSV canonical (`RM_IMPORT_HEADERS`) sudah enforced di BE untuk round-trip export ↔ import — tidak ada gap unifikasi seperti FG.

---

## 1. Schema Mirror End-to-End (BE — verbatim)

**Source BE**: `src/module/application/inventory/rm/import/import.schema.ts`. FE mirror WAJIB 1:1.

### 1.1 `RM_IMPORT_HEADERS` — SSOT header CSV

```ts
export const RM_IMPORT_HEADERS = {
    barcode: "BARCODE",
    name: "MATERIAL NAME",
    category: "CATEGORY",
    unit: "UOM",
    moq: "MOQ",
    minStock: "MIN STOCK",
    leadTime: "LEAD TIME",
    supplier: "SUPPLIER",
    source: "LOCAL/IMPORT",
    country: "COUNTRY",
    price: "PRICE",
} as const;
```

> Konstanta ini juga di-export ulang dari `rm.service.ts` (header export CSV) — round-trip export → edit → re-import dijamin valid. SOP `dev-flow §1.I` sudah terpenuhi pada BE; FE hanya perlu re-export konstanta ini.

### 1.2 `RMImportRowSchema` (per-row validate) — Zod verbatim

```ts
import z from "zod";
import { RawMaterialSource } from "../../../../../generated/prisma/client.js";

const sanitizeNumber = (val: unknown): number => {
    if (val === "" || val === null || val === undefined) return 0;
    if (typeof val === "number") return val;
    if (typeof val === "string") {
        const cleaned = val.replace(/[%,\s]/g, "").trim();
        const num = Number(cleaned);
        return isNaN(num) ? 0 : num;
    }
    return Number(val);
};

const sanitizeString = (val: unknown): string | undefined => {
    if (val === null || val === undefined) return undefined;
    const str = String(val).trim();
    return str === "" ? undefined : str;
};

export const RMImportRowSchema = z.object({
    [RM_IMPORT_HEADERS.barcode]: z.string().min(1, "Barcode wajib diisi").max(50),
    [RM_IMPORT_HEADERS.name]: z.string().min(1, "Material name wajib diisi").max(255),
    [RM_IMPORT_HEADERS.category]: z.string().min(1, "Kategori wajib diisi").max(255),
    [RM_IMPORT_HEADERS.unit]: z.preprocess(sanitizeString, z.string().min(1, "UOM wajib diisi").max(100)),
    [RM_IMPORT_HEADERS.moq]: z.preprocess(sanitizeNumber, z.coerce.number().min(0).optional().default(0)),
    [RM_IMPORT_HEADERS.minStock]: z.preprocess(sanitizeNumber, z.coerce.number().min(0).optional().default(0)),
    [RM_IMPORT_HEADERS.leadTime]: z.preprocess(sanitizeNumber, z.coerce.number().int().min(0).optional().default(0)),
    [RM_IMPORT_HEADERS.supplier]: z.preprocess(sanitizeString, z.string().max(100).optional()),
    [RM_IMPORT_HEADERS.source]: z.preprocess(sanitizeString, z.string().max(20).optional()),
    [RM_IMPORT_HEADERS.country]: z.preprocess(sanitizeString, z.string().max(100).optional()),
    [RM_IMPORT_HEADERS.price]: z.preprocess(sanitizeNumber, z.coerce.number().min(0).optional().default(0)),
});
```

**Field detail**:

| Header CSV       | Internal     | Type         | Required | Default | Constraint                            | Error msg                       | Catatan                                        |
| :--------------- | :----------- | :----------- | :------- | :------ | :------------------------------------ | :------------------------------ | :--------------------------------------------- |
| `BARCODE`        | `barcode`    | `string`     | ✅       | —       | `min(1)`, `max(50)`                   | `"Barcode wajib diisi"`         | Key dedup + ON CONFLICT di worker.             |
| `MATERIAL NAME`  | `name`       | `string`     | ✅       | —       | `min(1)`, `max(255)`                  | `"Material name wajib diisi"`   | —                                              |
| `CATEGORY`       | `category`   | `string`     | ✅       | —       | `min(1)`, `max(255)`                  | `"Kategori wajib diisi"`        | UPPER + trim di service; auto-upsert master.   |
| `UOM`            | `unit`       | `string`     | ✅       | —       | preprocess trim, `min(1)`, `max(100)` | `"UOM wajib diisi"`             | Auto-upsert `UnitRawMaterial`.                  |
| `MOQ`            | `min_buy`    | `number`     | ❌       | `0`     | preprocess sanitize, `min(0)`         | (default Zod)                   | Strip `%`/`,`/whitespace.                       |
| `MIN STOCK`      | `min_stock`  | `number`     | ❌       | `0`     | preprocess sanitize, `min(0)`         | (default Zod)                   | —                                              |
| `LEAD TIME`      | `lead_time`  | `number`     | ❌       | `0`     | preprocess sanitize, `int`, `min(0)`  | (default Zod)                   | Satuan hari.                                   |
| `SUPPLIER`       | `supplier`   | `string?`    | ❌       | —       | preprocess trim, `max(100)`           | (default Zod)                   | Empty → `null` di output preview.              |
| `LOCAL/IMPORT`   | `source`     | `string?`    | ❌       | —       | preprocess trim, `max(20)`            | (default Zod)                   | `mapSource()` → `LOCAL` (default) atau `IMPORT`. |
| `COUNTRY`        | `country`    | `string?`    | ❌       | —       | preprocess trim, `max(100)`           | (default Zod)                   | —                                              |
| `PRICE`          | `price`      | `number`     | ❌       | `0`     | preprocess sanitize, `min(0)`         | (default Zod)                   | Decimal di DB; `Number(...)` di output.        |

### 1.3 `RequestExecuteRMImportSchema` — POST /execute body

```ts
export const RequestExecuteRMImportSchema = z.object({
    import_id: z.string().uuid("Import ID tidak valid"),
});

export type RequestExecuteRMImportDTO = z.infer<typeof RequestExecuteRMImportSchema>;
```

| Field       | Type     | Required | Constraint | Error msg                  |
| :---------- | :------- | :------- | :--------- | :------------------------- |
| `import_id` | `string` | ✅       | UUID v4    | `"Import ID tidak valid"`  |

### 1.4 Response types & domain DTOs (verbatim)

```ts
export type RMImportPreviewDTO = {
    barcode: string;
    name: string;
    category: string;
    unit: string;
    min_buy: number;
    min_stock: number;
    lead_time: number;
    supplier: string | null;
    source: RawMaterialSource;
    country: string;
    price: number;
    errors: string[];
};

export type ResponseRMImportDTO = {
    import_id: string;
    total: number;
    valid: number;
    invalid: number;
};

export type ResponseEnqueueRMImportDTO = {
    import_id: string;
    jobId: string;
    state: "queued";
};

export type ImportJobState =
    | "queued"
    | "active"
    | "completed"
    | "failed"
    | "delayed"
    | "waiting-children"
    | "prioritized"
    | "unknown";

export type ResponseRMImportStatusDTO = {
    import_id: string;
    state: ImportJobState;
    progress: number;
    result?: { import_id: string; total: number };
    failedReason?: string;
    attemptsMade?: number;
};
```

### 1.5 Enum referensi (Prisma)

```prisma
enum RawMaterialSource {
    LOCAL
    IMPORT
}
```

Lokasi BE: `prisma/schema.prisma`. FE import via `@/shared/types` — **JANGAN duplikasi literal**. `mapSource()` di service: `"IMPORT"` (case-insensitive) → `IMPORT`; sisanya → `LOCAL`.

---

## 2. FE Schema Mirror

**File**: `app/src/app/(application)/inventory/rm/import/server/inventory.rm.import.schema.ts` 🚧 TBD

```ts
import { z } from "zod";
import type { RawMaterialSource } from "@/shared/types";

// Re-export konstanta header agar FE Upload step bisa render kolom canonical
// dan tetap sinkron dengan BE saat round-trip export ↔ import.
export const RM_IMPORT_HEADERS = {
    barcode: "BARCODE",
    name: "MATERIAL NAME",
    category: "CATEGORY",
    unit: "UOM",
    moq: "MOQ",
    minStock: "MIN STOCK",
    leadTime: "LEAD TIME",
    supplier: "SUPPLIER",
    source: "LOCAL/IMPORT",
    country: "COUNTRY",
    price: "PRICE",
} as const;

export const RequestExecuteRMImportSchema = z.object({
    import_id: z.string().uuid("Import ID tidak valid"),
});

export type RequestExecuteRMImportDTO = z.infer<typeof RequestExecuteRMImportSchema>;

export type RMImportPreviewDTO = {
    barcode: string;
    name: string;
    category: string;
    unit: string;
    min_buy: number;
    min_stock: number;
    lead_time: number;
    supplier: string | null;
    source: RawMaterialSource;
    country: string;
    price: number;
    errors: string[];
};

export type ResponseRMImportDTO = {
    import_id: string;
    total: number;
    valid: number;
    invalid: number;
};

export type ResponseEnqueueRMImportDTO = {
    import_id: string;
    jobId: string;
    state: "queued";
};

export type ImportJobState =
    | "queued"
    | "active"
    | "completed"
    | "failed"
    | "delayed"
    | "waiting-children"
    | "prioritized"
    | "unknown";

export type ResponseRMImportStatusDTO = {
    import_id: string;
    state: ImportJobState;
    progress: number;
    result?: { import_id: string; total: number };
    failedReason?: string;
    attemptsMade?: number;
};

export type RMImportPreviewSnapshotDTO = ResponseRMImportDTO & {
    rows: RMImportPreviewDTO[];
    createdAt: number;
};
```

**Diff vs BE**: empty (FE tidak perlu reproduce `RMImportRowSchema` — parsing CSV/XLSX 100% di BE).

---

## 3. Service Class — FULL CODE

**File**: `app/src/app/(application)/inventory/rm/import/server/inventory.rm.import.service.ts` 🚧 TBD

```ts
import api from "@/lib/api";
import { setupCSRFToken } from "@/shared/api/csrf";
import type { ApiSuccessResponse } from "@/shared/types/api";
import type {
    RequestExecuteRMImportDTO,
    ResponseRMImportDTO,
    ResponseEnqueueRMImportDTO,
    ResponseRMImportStatusDTO,
    RMImportPreviewSnapshotDTO,
} from "./inventory.rm.import.schema";

const API = `${process.env.NEXT_PUBLIC_API}/api/app/inventory/rm/import`;

export class InventoryRMImportService {
    /**
     * Step 1 — Upload + validate. Multipart upload, CSRF required.
     * BE returns 201 Created.
     */
    static async preview(file: File): Promise<ResponseRMImportDTO> {
        try {
            await setupCSRFToken();
            const form = new FormData();
            form.append("file", file);
            const { data } = await api.post<ApiSuccessResponse<ResponseRMImportDTO>>(
                `${API}/preview`,
                form,
                { headers: { "Content-Type": "multipart/form-data" } },
            );
            return data.data;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Step 2a — Ambil snapshot preview dari Redis cache (read-only).
     * Tidak menulis ke DB. 404 jika TTL sudah expire (default 5 menit, di-extend 30 menit oleh worker).
     */
    static async getPreview(import_id: string): Promise<RMImportPreviewSnapshotDTO> {
        try {
            const { data } = await api.get<ApiSuccessResponse<RMImportPreviewSnapshotDTO>>(
                `${API}/preview/${import_id}`,
            );
            return data.data;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Step 2b — Enqueue eksekusi async ke BullMQ. Lock per import_id 60s di Redis.
     * BE returns 202 Accepted. 409 jika lock masih terpegang.
     */
    static async execute(body: RequestExecuteRMImportDTO): Promise<ResponseEnqueueRMImportDTO> {
        try {
            await setupCSRFToken();
            const { data } = await api.post<ApiSuccessResponse<ResponseEnqueueRMImportDTO>>(
                `${API}/execute`,
                body,
            );
            return data.data;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Step 3 — Polling status job (BullMQ state + progress 0-100).
     * Terminal states: completed (with result), failed (with failedReason + attemptsMade).
     */
    static async status(import_id: string): Promise<ResponseRMImportStatusDTO> {
        try {
            const { data } = await api.get<ApiSuccessResponse<ResponseRMImportStatusDTO>>(
                `${API}/status/${import_id}`,
            );
            return data.data;
        } catch (error) {
            throw error;
        }
    }
}
```

---

## 4. Hooks — 5 Hook Split FULL CODE

**File**: `app/src/app/(application)/inventory/rm/import/server/use.inventory.rm.import.ts` 🚧 TBD

```ts
"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { useState, useCallback, useEffect, useMemo } from "react";
import { FetchError } from "@/shared/api/errors";
import { errorAtom, notificationAtom } from "@/shared/atoms";
import type { ResponseError } from "@/shared/types/api";
import { InventoryRMImportService } from "./inventory.rm.import.service";
import type {
    RequestExecuteRMImportDTO,
    ResponseRMImportDTO,
    ResponseEnqueueRMImportDTO,
    ResponseRMImportStatusDTO,
    RMImportPreviewSnapshotDTO,
} from "./inventory.rm.import.schema";

const KEY = ["inventory.rm.import"] as const;
const TERMINAL = new Set(["completed", "failed"]);

// ──────────────────────────────────────────────────────────────────────────────
// 4.1 READ — status polling (mirror FG import)
// ──────────────────────────────────────────────────────────────────────────────
export function useInventoryRMImport(import_id: string | null, enabled = true) {
    return useQuery<ResponseRMImportStatusDTO, ResponseError>({
        queryKey: [...KEY, import_id],
        queryFn: () => InventoryRMImportService.status(import_id as string),
        enabled: enabled && Boolean(import_id),
        // Polling 1.5s sampai terminal state
        refetchInterval: (query) => {
            const state = query.state.data?.state;
            if (!state) return 1500;
            return TERMINAL.has(state) ? false : 1500;
        },
        staleTime: 0,
    });
}

// ──────────────────────────────────────────────────────────────────────────────
// 4.2 WRITE — preview + execute (wizard step 1 & step 2)
// ──────────────────────────────────────────────────────────────────────────────
export function useFormInventoryRMImport() {
    const setErr = useSetAtom(errorAtom);
    const setNotif = useSetAtom(notificationAtom);
    const queryClient = useQueryClient();

    const invalidateImport = () =>
        queryClient.invalidateQueries({ queryKey: KEY, type: "all" });

    const preview = useMutation<ResponseRMImportDTO, ResponseError, File>({
        mutationKey: [...KEY, "preview"],
        mutationFn: (file) => InventoryRMImportService.preview(file),
        onSuccess: (data) => {
            setNotif({
                title: "Validasi File",
                message: `Total ${data.total} baris — valid ${data.valid}, invalid ${data.invalid}`,
            });
        },
        onError: (err) => FetchError(err, setErr),
    });

    const execute = useMutation<ResponseEnqueueRMImportDTO, ResponseError, RequestExecuteRMImportDTO>({
        mutationKey: [...KEY, "execute"],
        mutationFn: (body) => InventoryRMImportService.execute(body),
        onSuccess: (data) => {
            setNotif({ title: "Import Dijalankan", message: `Job ${data.jobId} masuk antrian` });
            // Invalidate raw-material list jika user kembali ke halaman list setelah import
            queryClient.invalidateQueries({ queryKey: ["inventory.rm"], type: "all" });
            invalidateImport();
        },
        onError: (err) => FetchError(err, setErr),
    });

    return { preview, execute };
}

// ──────────────────────────────────────────────────────────────────────────────
// 4.3 ACTION — fetch preview snapshot + retry helper
// ──────────────────────────────────────────────────────────────────────────────
export function useActionInventoryRMImport() {
    const setErr = useSetAtom(errorAtom);
    const queryClient = useQueryClient();

    const fetchPreview = useMutation<RMImportPreviewSnapshotDTO, ResponseError, string>({
        mutationKey: [...KEY, "fetchPreview"],
        mutationFn: (import_id) => InventoryRMImportService.getPreview(import_id),
        onError: (err) => FetchError(err, setErr),
    });

    const refetchStatus = useCallback(
        (import_id: string) =>
            queryClient.invalidateQueries({ queryKey: [...KEY, import_id], type: "all" }),
        [queryClient],
    );

    return { fetchPreview, refetchStatus };
}

// ──────────────────────────────────────────────────────────────────────────────
// 4.4 SessionState — wizard step + import_id (replaces TableState in CRUD scopes)
// ──────────────────────────────────────────────────────────────────────────────
export type RMImportStep = "upload" | "preview" | "progress";

export function useInventoryRMImportSessionState() {
    const [step, setStep] = useState<RMImportStep>("upload");
    const [importId, setImportId] = useState<string | null>(null);
    const [previewSummary, setPreviewSummary] = useState<ResponseRMImportDTO | null>(null);
    const [snapshot, setSnapshot] = useState<RMImportPreviewSnapshotDTO | null>(null);

    const reset = useCallback(() => {
        setStep("upload");
        setImportId(null);
        setPreviewSummary(null);
        setSnapshot(null);
    }, []);

    const goPreview = useCallback((summary: ResponseRMImportDTO) => {
        setImportId(summary.import_id);
        setPreviewSummary(summary);
        setStep("preview");
    }, []);

    const goProgress = useCallback(() => {
        setStep("progress");
    }, []);

    return {
        step,
        importId,
        previewSummary,
        snapshot,
        setSnapshot,
        reset,
        goPreview,
        goProgress,
    };
}

// ──────────────────────────────────────────────────────────────────────────────
// 4.5 Query-wrapper — bundling sessionState + status query untuk page consumer
// ──────────────────────────────────────────────────────────────────────────────
export function useInventoryRMImportQuery() {
    const session = useInventoryRMImportSessionState();
    const status = useInventoryRMImport(session.importId, session.step === "progress");
    const { fetchPreview } = useActionInventoryRMImport();

    // Auto-fetch snapshot saat memasuki step preview
    useEffect(() => {
        if (session.step === "preview" && session.importId && !session.snapshot) {
            fetchPreview.mutate(session.importId, {
                onSuccess: (data) => session.setSnapshot(data),
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session.step, session.importId]);

    const isTerminal = useMemo(
        () => Boolean(status.data?.state && TERMINAL.has(status.data.state)),
        [status.data?.state],
    );

    return { ...session, status, isTerminal };
}
```

---

## 5. Components — Wizard 3-step Snippets

Wizard mirror FG import shape: Upload → Preview → Progress. Setiap step adalah komponen terpisah, dipasang di shell yang sama.

### 5.1 Shell — `components/pages/inventory/rm/import/index.tsx` 🚧 TBD

```tsx
"use client";
import { useInventoryRMImportQuery } from "@/app/(application)/inventory/rm/import/server/use.inventory.rm.import";
import { UploadStep } from "./steps/upload-step";
import { PreviewStep } from "./steps/preview-step";
import { ProgressStep } from "./steps/progress-step";
import { WizardStepper } from "@/components/ui/wizard-stepper";

export default function RMImportWizard() {
    const session = useInventoryRMImportQuery();

    return (
        <section className="space-y-6">
            <WizardStepper
                steps={[
                    { key: "upload", label: "Upload File" },
                    { key: "preview", label: "Validasi" },
                    { key: "progress", label: "Proses" },
                ]}
                active={session.step}
            />
            {session.step === "upload" && <UploadStep onSuccess={session.goPreview} />}
            {session.step === "preview" && session.importId && (
                <PreviewStep
                    importId={session.importId}
                    summary={session.previewSummary}
                    snapshot={session.snapshot}
                    onExecute={session.goProgress}
                    onCancel={session.reset}
                />
            )}
            {session.step === "progress" && session.importId && (
                <ProgressStep
                    status={session.status.data}
                    isTerminal={session.isTerminal}
                    onDone={session.reset}
                />
            )}
        </section>
    );
}
```

### 5.2 Upload step — `components/pages/inventory/rm/import/steps/upload-step.tsx` 🚧 TBD

```tsx
"use client";
import { useState } from "react";
import { useFormInventoryRMImport } from "@/app/(application)/inventory/rm/import/server/use.inventory.rm.import";
import { RM_IMPORT_HEADERS } from "@/app/(application)/inventory/rm/import/server/inventory.rm.import.schema";
import type { ResponseRMImportDTO } from "@/app/(application)/inventory/rm/import/server/inventory.rm.import.schema";
import { Button } from "@/components/ui/button";

const ACCEPT = ".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";

export function UploadStep({ onSuccess }: { onSuccess: (data: ResponseRMImportDTO) => void }) {
    const { preview } = useFormInventoryRMImport();
    const [file, setFile] = useState<File | null>(null);

    const handleSubmit = async () => {
        if (!file) return;
        const data = await preview.mutateAsync(file);
        onSuccess(data);
    };

    return (
        <div className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6">
            <div>
                <h2 className="text-lg font-medium text-zinc-900">Upload File Raw Material</h2>
                <p className="mt-1 text-sm text-zinc-500">Format CSV / XLSX, maks 5000 baris.</p>
            </div>

            <details className="rounded-xl bg-zinc-50 p-3 text-sm">
                <summary className="cursor-pointer font-medium">Kolom yang diharapkan</summary>
                <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-xs text-zinc-700">
                    {Object.values(RM_IMPORT_HEADERS).map((h) => (
                        <li key={h}>{h}</li>
                    ))}
                </ul>
            </details>

            <input
                type="file"
                accept={ACCEPT}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm"
            />

            <div className="flex justify-end">
                <Button onClick={handleSubmit} disabled={!file || preview.isPending}>
                    {preview.isPending ? "Memvalidasi…" : "Validasi"}
                </Button>
            </div>
        </div>
    );
}
```

### 5.3 Preview step — `components/pages/inventory/rm/import/steps/preview-step.tsx` 🚧 TBD

```tsx
"use client";
import { useFormInventoryRMImport } from "@/app/(application)/inventory/rm/import/server/use.inventory.rm.import";
import type {
    ResponseRMImportDTO,
    RMImportPreviewSnapshotDTO,
} from "@/app/(application)/inventory/rm/import/server/inventory.rm.import.schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Props = {
    importId: string;
    summary: ResponseRMImportDTO | null;
    snapshot: RMImportPreviewSnapshotDTO | null;
    onExecute: () => void;
    onCancel: () => void;
};

export function PreviewStep({ importId, summary, snapshot, onExecute, onCancel }: Props) {
    const { execute } = useFormInventoryRMImport();
    const canExecute = (summary?.valid ?? 0) > 0;

    const handleExecute = async () => {
        await execute.mutateAsync({ import_id: importId });
        onExecute();
    };

    return (
        <div className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6">
            <header className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-medium text-zinc-900">Validasi Preview</h2>
                    <p className="text-sm text-zinc-500">Import ID: <span className="font-mono">{importId}</span></p>
                </div>
                <div className="flex gap-2">
                    <Badge tone="zinc">Total {summary?.total ?? 0}</Badge>
                    <Badge tone="emerald">Valid {summary?.valid ?? 0}</Badge>
                    <Badge tone="rose">Invalid {summary?.invalid ?? 0}</Badge>
                </div>
            </header>

            <div className="max-h-96 overflow-auto rounded-xl border border-zinc-200">
                <table className="w-full text-sm">
                    <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500">
                        <tr>
                            {["Barcode", "Nama", "Kategori", "UOM", "MOQ", "Min Stock", "Supplier", "Source", "Price", "Error"].map((h) => (
                                <th key={h} className="px-3 py-2">{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {(snapshot?.rows ?? []).map((row, idx) => {
                            const invalid = row.errors.length > 0;
                            return (
                                <tr key={idx} className={invalid ? "bg-rose-50" : "odd:bg-white even:bg-zinc-50/50"}>
                                    <td className="px-3 py-1.5 font-mono">{row.barcode || "—"}</td>
                                    <td className="px-3 py-1.5">{row.name || "—"}</td>
                                    <td className="px-3 py-1.5">{row.category || "—"}</td>
                                    <td className="px-3 py-1.5">{row.unit || "—"}</td>
                                    <td className="px-3 py-1.5 text-right">{row.min_buy}</td>
                                    <td className="px-3 py-1.5 text-right">{row.min_stock}</td>
                                    <td className="px-3 py-1.5">{row.supplier ?? "—"}</td>
                                    <td className="px-3 py-1.5">{row.source}</td>
                                    <td className="px-3 py-1.5 text-right font-mono">{row.price.toLocaleString("id-ID")}</td>
                                    <td className="px-3 py-1.5 text-rose-600">{invalid ? row.errors.join("; ") : ""}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <footer className="flex justify-end gap-2">
                <Button variant="ghost" onClick={onCancel} disabled={execute.isPending}>
                    Batal
                </Button>
                <Button onClick={handleExecute} disabled={!canExecute || execute.isPending}>
                    {execute.isPending ? "Mengirim…" : `Eksekusi (${summary?.valid ?? 0} baris)`}
                </Button>
            </footer>
        </div>
    );
}
```

### 5.4 Progress step — `components/pages/inventory/rm/import/steps/progress-step.tsx` 🚧 TBD

```tsx
"use client";
import type { ResponseRMImportStatusDTO } from "@/app/(application)/inventory/rm/import/server/inventory.rm.import.schema";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

type Props = {
    status: ResponseRMImportStatusDTO | undefined;
    isTerminal: boolean;
    onDone: () => void;
};

export function ProgressStep({ status, isTerminal, onDone }: Props) {
    const state = status?.state ?? "queued";
    const pct = status?.progress ?? 0;

    return (
        <div className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6">
            <header className="space-y-1">
                <h2 className="text-lg font-medium text-zinc-900">Proses Import</h2>
                <p className="text-sm text-zinc-500">State: <span className="font-mono">{state}</span></p>
            </header>

            <Progress value={pct} />
            <p className="text-right text-sm text-zinc-500">{pct}%</p>

            {state === "completed" && status?.result && (
                <div className="rounded-xl bg-emerald-50 p-4 text-emerald-900">
                    Berhasil mengimport <strong>{status.result.total}</strong> raw material.
                </div>
            )}
            {state === "failed" && (
                <div className="rounded-xl bg-rose-50 p-4 text-rose-900">
                    <p className="font-medium">Import gagal</p>
                    <p className="text-sm">{status?.failedReason}</p>
                    <p className="mt-1 text-xs text-rose-700">Attempts: {status?.attemptsMade}</p>
                </div>
            )}

            {isTerminal && (
                <div className="flex justify-end">
                    <Button onClick={onDone}>Selesai</Button>
                </div>
            )}
        </div>
    );
}
```

### 5.5 Page entry — `app/(application)/inventory/rm/import/page.tsx` 🚧 TBD

```tsx
import { Suspense } from "react";
import RMImportWizard from "@/components/pages/inventory/rm/import";

export default function RMImportPage() {
    return (
        <Suspense fallback={<div>Loading…</div>}>
            <RMImportWizard />
        </Suspense>
    );
}
```

---

## 6. End-to-End Flow Mermaid (async import dengan worker)

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant W as Wizard Shell
    participant Up as UploadStep
    participant Pv as PreviewStep
    participant Pg as ProgressStep
    participant FH as useFormInventoryRMImport
    participant AH as useActionInventoryRMImport
    participant SH as useInventoryRMImport
    participant S as InventoryRMImportService
    participant BE as Backend API
    participant R as Redis
    participant Q as BullMQ Queue
    participant K as Worker (api-erp-worker)
    participant DB as Postgres

    U->>Up: Pilih file CSV/XLSX
    Up->>FH: preview.mutateAsync(file)
    FH->>S: preview(file)
    S->>BE: POST /preview (multipart) + CSRF
    BE->>R: ImportCacheService.save("rm:import:", uuid, payload, 300s)
    BE-->>S: 201 { import_id, total, valid, invalid }
    S-->>FH: ResponseRMImportDTO
    FH-->>Up: onSuccess + notif
    Up->>W: session.goPreview(summary)

    W->>Pv: render preview step
    Pv->>AH: fetchPreview.mutate(import_id)
    AH->>S: getPreview(import_id)
    S->>BE: GET /preview/:import_id
    BE->>R: ImportCacheService.get
    BE-->>S: 200 { rows[], createdAt, ... }
    S-->>AH: snapshot
    AH-->>Pv: render tabel + tandai baris invalid

    U->>Pv: Klik "Eksekusi"
    Pv->>FH: execute.mutateAsync({ import_id })
    FH->>S: execute({ import_id })
    S->>BE: POST /execute + CSRF
    BE->>R: SET rm:import:lock:<id> NX EX 60
    alt lock terpegang
        BE-->>S: 409 "Import sedang diproses…"
    else
        BE->>Q: rmImportQueue.add("execute", { import_id }, { jobId: import_id })
        BE-->>S: 202 { import_id, jobId, state: "queued" }
    end
    S-->>FH: ResponseEnqueueRMImportDTO
    FH-->>Pv: onSuccess + notif + invalidate ["inventory.rm"]
    Pv->>W: session.goProgress()

    W->>Pg: render progress step
    loop polling 1.5s sampai terminal
        Pg->>SH: useInventoryRMImport(import_id)
        SH->>S: status(import_id)
        S->>BE: GET /status/:import_id
        BE->>Q: rmImportQueue.getJob.getState()
        BE-->>S: 200 { state, progress, result?, failedReason? }
        SH-->>Pg: re-render bar progress
    end

    par worker side
        K->>R: EXPIRE rm:import:<id> 1800
        K->>K: dedupe by barcode + sort
        K->>DB: TX1 — getOrCreateSlug(unit, category) + upsertSuppliers
        loop chunk 500
            K->>DB: TX2 — bulkUpsertRawMaterials ON CONFLICT (barcode)
            K->>DB: bulkUpsertSupplierMaterials reset+upsert
            K->>Q: job.updateProgress(pct)
        end
        K->>R: ImportCacheService.remove + DEL lock
        K-->>Q: return { import_id, total }
    end

    Pg-->>U: tampil "Selesai" (state=completed)
```

---

## 7. Edge Cases & Per-Scope Quirks

- **Header CSV canonical**: `RM_IMPORT_HEADERS` adalah SSOT yang juga dipakai oleh `rm.service.ts` saat export CSV. Round-trip **export → edit → re-import sudah dijamin valid di BE** — tidak ada gap unifikasi seperti FG import. FE cukup re-export konstanta di schema FE; **JANGAN** menulis ulang literal di komponen Upload.
- **File limit**: `MAX_ROWS = 5000` (BE). FE Upload step **tidak melakukan pre-count** — biarkan BE balas 413 + tampilkan via `FetchError`.
- **Mime/extension whitelist**: CSV + XLSX. `<input accept>` cuma UI hint; otoritatif di BE (415 kalau invalid).
- **Lock per import_id**: 60 detik. Klik "Eksekusi" dua kali cepat → request kedua 409. UI **disable tombol** saat `execute.isPending`.
- **TTL preview**: 5 menit default. Worker memperpanjang ke 30 menit saat job pickup. Kalau user diam > 5 menit di step Preview, klik Eksekusi akan 400 (`Import session tidak ditemukan…`) — FE harus reset wizard.
- **Polling cadence**: 1.5 detik (`refetchInterval`) sampai state `completed` atau `failed`. Pakai callback function form (`(query) => ...`) untuk mematikan polling pada terminal state.
- **Supplier auto-upsert**: BE worker auto-upsert supplier by `slug` (normalize dari nama) + backfill `slug` untuk record legacy yang null. FE **tidak perlu** pre-check supplier; cukup paste nama di CSV. Supplier baru otomatis dibuat dengan `addresses = "-"`, `country` & `source` dari row.
- **Country code**: free-text `max(100)`. Tidak ada validasi ISO. FE bisa tampilkan dropdown ISO-3166 di komponen RM detail (out of scope wizard).
- **Price Decimal**: BE store sebagai `Decimal` di kolom `supplier_materials.unit_price`. JSON serialisasi pakai `Number(...)` di service preview, jadi FE selalu terima `number`. Format display pakai `toLocaleString("id-ID")` di Preview table.
- **`RawMaterialSource` LOCAL/IMPORT detection**: `mapSource()` di BE — `"IMPORT"` (case-insensitive, setelah trim) → `IMPORT`; lainnya termasuk kosong → `LOCAL`. FE preview menampilkan hasil mapping (sudah enum), bukan raw string dari CSV.
- **Dedup di worker**: row barcode duplikat di file → row terakhir menang (sort `localeCompare`). FE Preview bisa tampilkan warning total ≠ valid saat ada duplikat — tapi BE tidak balas hint dedup, FE cuma tahu setelah `result.total < summary.valid`.
- **Preferred supplier policy**: imported supplier **selalu jadi preferred** untuk RM target (worker reset `is_preferred=false` dulu di chunk). FE tidak perlu UI khusus; sebut di tooltip step Preview kalau perlu.
- **Cache invalidation pasca-execute**: `useFormInventoryRMImport.execute.onSuccess` meng-invalidate `["inventory.rm"]` (list RM) selain `["inventory.rm.import"]`. List RM auto-refresh saat user navigasi kembali.

---

## 8. Testing FE (Vitest + RTL)

**Lokasi**: `app/src/__tests__/inventory/rm/import/` 🚧 TBD. Mengikuti SOP `frontend-testing`.

### 8.1 Service test

```ts
import { describe, it, expect, vi } from "vitest";
import api from "@/lib/api";
import { InventoryRMImportService } from "@/app/(application)/inventory/rm/import/server/inventory.rm.import.service";

vi.mock("@/lib/api");
vi.mock("@/shared/api/csrf", () => ({ setupCSRFToken: vi.fn() }));

describe("InventoryRMImportService", () => {
    it("preview posts multipart with CSRF", async () => {
        (api.post as any).mockResolvedValue({ data: { data: { import_id: "u", total: 1, valid: 1, invalid: 0 } } });
        const file = new File(["a"], "rm.csv", { type: "text/csv" });
        await InventoryRMImportService.preview(file);
        expect(api.post).toHaveBeenCalledWith(
            expect.stringContaining("/preview"),
            expect.any(FormData),
            expect.objectContaining({ headers: { "Content-Type": "multipart/form-data" } }),
        );
    });

    it("execute posts import_id body", async () => {
        (api.post as any).mockResolvedValue({ data: { data: { import_id: "u", jobId: "u", state: "queued" } } });
        await InventoryRMImportService.execute({ import_id: "uuid" });
        expect(api.post).toHaveBeenCalledWith(expect.stringContaining("/execute"), { import_id: "uuid" });
    });

    it("status GET status path", async () => {
        (api.get as any).mockResolvedValue({ data: { data: { import_id: "u", state: "active", progress: 33 } } });
        const res = await InventoryRMImportService.status("uuid");
        expect(res.state).toBe("active");
        expect(api.get).toHaveBeenCalledWith(expect.stringContaining("/status/uuid"));
    });
});
```

### 8.2 Hook test (polling stops on terminal)

```tsx
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useInventoryRMImport } from "@/app/(application)/inventory/rm/import/server/use.inventory.rm.import";
import { InventoryRMImportService } from "@/app/(application)/inventory/rm/import/server/inventory.rm.import.service";

vi.mock("@/app/(application)/inventory/rm/import/server/inventory.rm.import.service");

const wrapper = ({ children }: { children: React.ReactNode }) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

describe("useInventoryRMImport", () => {
    it("returns completed state and stops polling", async () => {
        (InventoryRMImportService.status as any).mockResolvedValue({
            import_id: "u",
            state: "completed",
            progress: 100,
            result: { import_id: "u", total: 10 },
        });
        const { result } = renderHook(() => useInventoryRMImport("u"), { wrapper });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data?.state).toBe("completed");
    });
});
```

### 8.3 Component test (Upload step)

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UploadStep } from "@/components/pages/inventory/rm/import/steps/upload-step";

vi.mock("@/app/(application)/inventory/rm/import/server/use.inventory.rm.import", () => ({
    useFormInventoryRMImport: () => ({
        preview: { mutateAsync: vi.fn().mockResolvedValue({ import_id: "u", total: 1, valid: 1, invalid: 0 }), isPending: false },
    }),
}));

describe("UploadStep", () => {
    it("disables submit until file picked", () => {
        render(<UploadStep onSuccess={vi.fn()} />);
        const btn = screen.getByRole("button", { name: /validasi/i });
        expect(btn).toBeDisabled();
    });

    it("invokes onSuccess with preview result", async () => {
        const onSuccess = vi.fn();
        render(<UploadStep onSuccess={onSuccess} />);
        const file = new File(["x"], "rm.csv", { type: "text/csv" });
        const input = screen.getByLabelText ? screen.getByLabelText("file") : screen.getByDisplayValue("");
        fireEvent.change(input as HTMLElement, { target: { files: [file] } });
        fireEvent.click(screen.getByRole("button", { name: /validasi/i }));
        await new Promise((r) => setTimeout(r, 0));
        expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ import_id: "u" }));
    });
});
```

---

## 9. Cross-link

- BE scope doc: [./README.md](./README.md)
- Parent BE scope (RM CRUD + export): [`../README.md`](../README.md)
- Module-level FE konvensi: [`../../frontend-integration.md`](../../frontend-integration.md)
- Counterpart FG import: [`../../fg/import/README.md`](../../fg/import/README.md) (pattern identik)
- SOP FE canonical: [frontend-dev-flow](../../../../../.claude/skills/frontend-dev-flow/SKILL.md)
- SOP FE testing: [frontend-testing](../../../../../.claude/skills/frontend-testing/SKILL.md)
- Postman folder: `Inventory → RM → Import` di `docs/postman/erp-mandalika.postman_collection.json`.
- Worker process & deployment: [`../../../../DEPLOYMENT.md`](../../../../DEPLOYMENT.md).
