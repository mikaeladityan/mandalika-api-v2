# FG Import Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrasikan fitur import produk dari `src/module/application/product/import/` ke `src/module/application/inventory/fg/import/` dengan SOP penuh (type-safe, ORM-only, ApiError standar, Zod-validated), tanpa menghapus modul lama.

**Architecture:** Modul baru `inventory/fg/import/` (4 file: routes/controller/service/schema) di-mount sebagai sub-route FG (`/api/app/inventory/fg/import/*`). Bulk insert pakai loop `tx.product.upsert` di dalam `$transaction`. Helper `getOrCreateSize` di-ekstrak dari `fg.service.ts` ke `lib/utils/upsert-size.ts` agar reusable. Cache prefix baru `fg:import:` untuk isolasi dari modul lama.

**Tech Stack:** TypeScript, Hono, Prisma v6, Zod, Vitest, `ImportCacheService` (Redis-backed), `ParseCSV`/`ParseXLSX` (existing libs).

**Spec reference:** `docs/superpowers/specs/2026-05-18-fg-import-migration-design.md`

---

## File Structure

**Create:**
- `src/lib/utils/upsert-size.ts` — shared helper `getOrCreateSize`
- `src/module/application/inventory/fg/import/import.schema.ts` — Zod schemas + DTO types
- `src/module/application/inventory/fg/import/import.service.ts` — `FGImportService` (preview/execute/getPreview/bulkUpsert)
- `src/module/application/inventory/fg/import/import.controller.ts` — `FGImportController`
- `src/module/application/inventory/fg/import/import.routes.ts` — `FGImportRoutes`
- `src/tests/inventory/fg/import/import.service.test.ts` — unit tests
- `src/tests/inventory/fg/import/import.routes.test.ts` — integration tests

**Modify:**
- `src/module/application/inventory/fg/fg.service.ts:46-57` — hapus private `getOrCreateSize`, import dari shared helper
- `src/module/application/inventory/fg/fg.routes.ts` — mount `FGImportRoutes` di `/import`

**Not touched (intentional):**
- `src/module/application/product/import/*` — kept as-is
- `src/lib/utils/import.cache.ts` — kept as-is

---

## Task 1: Ekstrak `getOrCreateSize` helper

**Files:**
- Create: `src/lib/utils/upsert-size.ts`
- Modify: `src/module/application/inventory/fg/fg.service.ts:1-9` (imports) and `46-57` (remove private helper)
- Verify: `src/tests/inventory/fg/fg.service.test.ts` (existing 36 tests harus tetap pass)

- [ ] **Step 1.1: Tulis file helper baru**

Create `src/lib/utils/upsert-size.ts`:

```ts
import { Prisma } from "../../generated/prisma/client.js";

// reason: atomic upsert helper untuk ProductSize — dipakai oleh modul FG (create/update)
// dan FG Import (bulk insert). Pola mirroring getOrCreateSlug di upsert-slug.ts.
export async function getOrCreateSize(
    tx: Prisma.TransactionClient,
    size: number,
): Promise<number> {
    const result = await tx.productSize.upsert({
        where: { size },
        update: {},
        create: { size },
        select: { id: true },
    });
    return result.id;
}
```

- [ ] **Step 1.2: Update `fg.service.ts` — ganti private helper jadi import**

Edit `src/module/application/inventory/fg/fg.service.ts`:

Tambahkan import di header (setelah baris 6):

```ts
import { getOrCreateSize } from "../../../../lib/utils/upsert-size.js";
```

Hapus blok private helper (baris 43-58, dari `// --- Helper Methods ---` sampai sebelum `// --- Core Methods ---`):

```ts
// --- Helper Methods ---

private static async getOrCreateSize(
    tx: Prisma.TransactionClient,
    size: number,
): Promise<number> {
    const result = await tx.productSize.upsert({
        where: { size },
        update: {},
        create: { size },
        select: { id: true },
    });
    return result.id;
}

// --- Core Methods ---
```

Ganti dengan satu baris pembatas:

```ts
// --- Core Methods ---
```

Update call site di method `create` (baris 69, awalnya `this.getOrCreateSize(tx, size)`):

```ts
size ? getOrCreateSize(tx, size) : null,
```

Update call site di method `update` (baris 107):

```ts
size ? getOrCreateSize(tx, size) : product.size_id,
```

- [ ] **Step 1.3: Jalankan tsc untuk memastikan tidak ada error type**

Run: `rtk tsc --noEmit`

Expected: PASS, tidak ada error baru.

- [ ] **Step 1.4: Jalankan FG service test untuk memastikan refactor tidak break**

Run: `npx vitest run src/tests/inventory/fg/fg.service.test.ts`

Expected: PASS semua (jumlah test sama dengan sebelum).

- [ ] **Step 1.5: Commit**

```bash
rtk git add src/lib/utils/upsert-size.ts src/module/application/inventory/fg/fg.service.ts
rtk git commit -m "refactor(fg): extract getOrCreateSize ke lib/utils/upsert-size.ts"
```

---

## Task 2: Schema modul import

**Files:**
- Create: `src/module/application/inventory/fg/import/import.schema.ts`

- [ ] **Step 2.1: Tulis schema lengkap**

```ts
import z from "zod";
import { GENDER } from "../../../../../generated/prisma/client.js";

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

export type FGImportRow = z.infer<typeof FGImportRowSchema>;
export type RequestExecuteFGImportDTO = z.infer<typeof RequestExecuteFGImportSchema>;

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
```

- [ ] **Step 2.2: Verifikasi tsc**

Run: `rtk tsc --noEmit`

Expected: PASS, tidak ada error.

- [ ] **Step 2.3: Commit**

```bash
rtk git add src/module/application/inventory/fg/import/import.schema.ts
rtk git commit -m "feat(fg-import): add import schema dengan Zod validation"
```

---

## Task 3: Service `preview` method (TDD)

**Files:**
- Create: `src/tests/inventory/fg/import/import.service.test.ts`
- Create: `src/module/application/inventory/fg/import/import.service.ts`

- [ ] **Step 3.1: Tulis test untuk `preview`**

Create `src/tests/inventory/fg/import/import.service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FGImportService } from "../../../../module/application/inventory/fg/import/import.service.js";
import { redisClient } from "../../../../config/redis.js";

describe("FGImportService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("preview", () => {
        it("parses valid row dan mengembalikan import_id + counters", async () => {
            const rows = [
                {
                    "PRODUCT CODE": "FG_001",
                    "PRODUCT NAME": "Parfum 100ml",
                    TYPE: "Parfum",
                    GENDER: "Men",
                    SIZE: 100,
                    UOM: "ml",
                    EDAR: 50,
                    SAFETY: 10,
                },
            ];

            const result = await FGImportService.preview(rows);

            expect(result.total).toBe(1);
            expect(result.valid).toBe(1);
            expect(result.invalid).toBe(0);
            expect(result.import_id).toMatch(/^[0-9a-f-]{36}$/i);
            expect(redisClient.set).toHaveBeenCalled();
        });

        it("menandai row invalid dengan errors[] terisi", async () => {
            const rows = [
                {
                    "PRODUCT CODE": "",
                    "PRODUCT NAME": "Invalid",
                    TYPE: "Parfum",
                    SIZE: 0,
                    UOM: "ml",
                },
            ];

            const result = await FGImportService.preview(rows);

            expect(result.total).toBe(1);
            expect(result.valid).toBe(0);
            expect(result.invalid).toBe(1);
        });

        it("normalize GENDER ke WOMEN/MEN/UNISEX", async () => {
            const rows = [
                { "PRODUCT CODE": "A", "PRODUCT NAME": "A", TYPE: "T", GENDER: "Woman", SIZE: 10, UOM: "ml" },
                { "PRODUCT CODE": "B", "PRODUCT NAME": "B", TYPE: "T", GENDER: "men", SIZE: 10, UOM: "ml" },
                { "PRODUCT CODE": "C", "PRODUCT NAME": "C", TYPE: "T", GENDER: "", SIZE: 10, UOM: "ml" },
            ];

            const result = await FGImportService.preview(rows);

            expect(result.valid).toBe(3);
        });
    });
});
```

- [ ] **Step 3.2: Jalankan test — pastikan FAIL karena service belum ada**

Run: `npx vitest run src/tests/inventory/fg/import/import.service.test.ts`

Expected: FAIL — module "FGImportService" not found.

- [ ] **Step 3.3: Tulis service minimal — method `preview` + helper `mapGender`**

Create `src/module/application/inventory/fg/import/import.service.ts`:

```ts
import { randomUUID } from "crypto";
import prisma from "../../../../../config/prisma.js";
import { GENDER, Prisma } from "../../../../../generated/prisma/client.js";
import { STATUS } from "../../../../../generated/prisma/enums.js";
import { normalizeSlug } from "../../../../../lib/index.js";
import { ApiError } from "../../../../../lib/errors/api.error.js";
import { ImportCacheService } from "../../../../../lib/utils/import.cache.js";
import { getOrCreateSlug } from "../../../../../lib/utils/upsert-slug.js";
import { getOrCreateSize } from "../../../../../lib/utils/upsert-size.js";
import {
    FGImportPreviewDTO,
    FGImportRowSchema,
    ResponseFGImportDTO,
} from "./import.schema.js";

const CACHE_PREFIX = "fg:import:";

type ImportCachePayload = {
    status: "preview" | "executing";
    createdAt: number;
    total: number;
    valid: number;
    invalid: number;
    rows: FGImportPreviewDTO[];
};

export class FGImportService {
    private static mapGender(value: string = ""): GENDER {
        const normalized = value.toLowerCase();
        if (["woman", "women"].includes(normalized)) return GENDER.WOMEN;
        if (["man", "men"].includes(normalized)) return GENDER.MEN;
        return GENDER.UNISEX;
    }

    static async preview(rows: Array<Record<string, unknown>>): Promise<ResponseFGImportDTO> {
        const parsedResults = rows.map((row) => FGImportRowSchema.safeParse(row));
        const parsedRows: FGImportPreviewDTO[] = rows.map((row, index) => {
            const parsed = parsedResults[index];
            if (!parsed) {
                return {
                    code: String(row["PRODUCT CODE"] ?? ""),
                    name: String(row["PRODUCT NAME"] ?? ""),
                    gender: GENDER.UNISEX,
                    size: 0,
                    type: null,
                    unit: null,
                    distribution_percentage: 0,
                    safety_percentage: 0,
                    errors: ["Internal parsing error"],
                };
            }

            if (!parsed.success) {
                return {
                    code: String(row["PRODUCT CODE"] ?? ""),
                    name: String(row["PRODUCT NAME"] ?? ""),
                    gender: GENDER.UNISEX,
                    size: 0,
                    type: null,
                    unit: null,
                    distribution_percentage: 0,
                    safety_percentage: 0,
                    errors: parsed.error.issues.map((e) => e.message),
                };
            }

            const {
                "PRODUCT CODE": code,
                "PRODUCT NAME": name,
                GENDER: gender,
                SIZE,
                TYPE,
                UOM,
                EDAR,
                SAFETY,
            } = parsed.data;

            return {
                code: code.trim(),
                name: name.trim(),
                gender: this.mapGender(gender),
                size: SIZE,
                type: normalizeSlug(TYPE),
                unit: normalizeSlug(UOM),
                distribution_percentage: EDAR,
                safety_percentage: SAFETY,
                errors: [],
            };
        });

        const total = parsedRows.length;
        const invalid = parsedRows.filter((r) => r.errors.length > 0).length;
        const valid = total - invalid;
        const import_id = randomUUID();

        const payload: ImportCachePayload = {
            status: "preview",
            createdAt: Date.now(),
            total,
            valid,
            invalid,
            rows: parsedRows,
        };

        await ImportCacheService.save(CACHE_PREFIX, import_id, payload);

        return { import_id, total, valid, invalid };
    }
}
```

> Note: imports `Prisma`, `STATUS`, `getOrCreateSlug`, `getOrCreateSize`, `ApiError` belum dipakai di method `preview` saja, tapi akan dipakai di Task 4 — biarkan untuk menghindari multiple edits ke header.
>
> Pengecualian: kalau linter strict, tambahkan placeholder usage atau hapus dan tambah kembali di Task 4. Defaultnya biarkan.

- [ ] **Step 3.4: Jalankan test — pastikan PASS**

Run: `npx vitest run src/tests/inventory/fg/import/import.service.test.ts`

Expected: PASS 3 test di blok `preview`.

- [ ] **Step 3.5: Commit**

```bash
rtk git add src/module/application/inventory/fg/import/import.service.ts src/tests/inventory/fg/import/import.service.test.ts
rtk git commit -m "feat(fg-import): add FGImportService.preview dengan Zod parsing"
```

---

## Task 4: Service `execute` + `bulkUpsert` method (TDD)

**Files:**
- Modify: `src/tests/inventory/fg/import/import.service.test.ts` (tambah blok `describe("execute")`)
- Modify: `src/module/application/inventory/fg/import/import.service.ts` (tambah method)

- [ ] **Step 4.1: Tambah test untuk `execute`**

Append ke `src/tests/inventory/fg/import/import.service.test.ts` (sebelum closing `})` paling luar):

```ts
    describe("execute", () => {
        it("throws ApiError saat cache tidak ditemukan", async () => {
            vi.mocked(redisClient.get).mockResolvedValueOnce(null);

            await expect(FGImportService.execute("missing-id")).rejects.toThrow(
                "Import session expired, not found, or already executed",
            );
        });

        it("throws ApiError saat status sudah executing", async () => {
            vi.mocked(redisClient.get).mockResolvedValueOnce(
                JSON.stringify({
                    status: "executing",
                    createdAt: Date.now(),
                    total: 1,
                    valid: 1,
                    invalid: 0,
                    rows: [],
                }),
            );

            await expect(FGImportService.execute("locked-id")).rejects.toThrow(
                "Import session expired, not found, or already executed",
            );
        });

        it("throws ApiError saat tidak ada baris valid", async () => {
            vi.mocked(redisClient.get).mockResolvedValueOnce(
                JSON.stringify({
                    status: "preview",
                    createdAt: Date.now(),
                    total: 1,
                    valid: 0,
                    invalid: 1,
                    rows: [
                        {
                            code: "",
                            name: "",
                            gender: "UNISEX",
                            size: 0,
                            type: null,
                            unit: null,
                            distribution_percentage: 0,
                            safety_percentage: 0,
                            errors: ["bad"],
                        },
                    ],
                }),
            );

            await expect(FGImportService.execute("invalid-rows-id")).rejects.toThrow(
                "Tidak ada baris valid untuk diimport",
            );
        });

        it("sukses execute dan menghapus cache", async () => {
            vi.mocked(redisClient.get).mockResolvedValueOnce(
                JSON.stringify({
                    status: "preview",
                    createdAt: Date.now(),
                    total: 1,
                    valid: 1,
                    invalid: 0,
                    rows: [
                        {
                            code: "FG_001",
                            name: "Parfum",
                            gender: "MEN",
                            size: 100,
                            type: "parfum",
                            unit: "ml",
                            distribution_percentage: 50,
                            safety_percentage: 10,
                            errors: [],
                        },
                    ],
                }),
            );

            const result = await FGImportService.execute("valid-id");

            expect(result.import_id).toBe("valid-id");
            expect(result.total).toBe(1);
            expect(redisClient.del).toHaveBeenCalled();
        });
    });
```

- [ ] **Step 4.2: Jalankan test — pastikan FAIL**

Run: `npx vitest run src/tests/inventory/fg/import/import.service.test.ts`

Expected: FAIL pada blok `execute` — method belum ada.

- [ ] **Step 4.3: Tambah method `execute` dan `bulkUpsert` ke service**

Edit `src/module/application/inventory/fg/import/import.service.ts` — tambahkan dua method di dalam class `FGImportService` (setelah `preview`):

```ts
    static async execute(import_id: string) {
        const cache = (await ImportCacheService.get(
            CACHE_PREFIX,
            import_id,
        )) as ImportCachePayload | null;

        if (!cache || cache.status !== "preview") {
            throw new ApiError(
                400,
                "Import session expired, not found, or already executed",
            );
        }

        const validRows = cache.rows.filter((r) => r.errors.length === 0);
        if (!validRows.length) {
            throw new ApiError(400, "Tidak ada baris valid untuk diimport");
        }

        await ImportCacheService.save(CACHE_PREFIX, import_id, { ...cache, status: "executing" });

        try {
            await this.bulkUpsert(validRows);
            await ImportCacheService.remove(CACHE_PREFIX, import_id);
            return { import_id, total: validRows.length };
        } catch (err) {
            await ImportCacheService.save(CACHE_PREFIX, import_id, cache);
            throw err;
        }
    }

    private static async bulkUpsert(data: FGImportPreviewDTO[]): Promise<void> {
        if (!data.length) return;

        const deduped = new Map<string, FGImportPreviewDTO>();
        for (const row of data) {
            const code = row.code?.trim();
            if (code) deduped.set(code, row);
        }
        const finalData = Array.from(deduped.values());

        await prisma.$transaction(async (tx) => {
            for (const row of finalData) {
                const [type_id, unit_id, size_id] = await Promise.all([
                    row.type ? getOrCreateSlug(tx.productType, row.type) : null,
                    row.unit ? getOrCreateSlug(tx.unit, row.unit) : null,
                    row.size > 0 ? getOrCreateSize(tx, row.size) : null,
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
        });
    }
```

> Note: `Prisma` import (jika tidak dipakai) bisa dihapus. Cek tsc.

- [ ] **Step 4.4: Tambahkan mock `tx.product.upsert` di setup.ts jika belum ada**

Read `src/tests/setup.ts:834-850` — pastikan blok `product` di dalam `$transaction` callback punya `upsert`. Kalau belum, tambahkan:

```ts
                product: {
                    create: vi.fn().mockResolvedValue({
                        id: 1,
                        code: "TSHIRT",
                        z_value: 1.65,
                        product_type: {},
                        unit: {},
                        size: {},
                    }),
                    update: vi.fn().mockResolvedValue({
                        id: 1,
                        code: "TSHIRT",
                        z_value: 1.65,
                        product_type: {},
                        unit: {},
                        size: {},
                    }),
                    upsert: vi.fn().mockResolvedValue({
                        id: 1,
                        code: "FG_001",
                        z_value: 1.65,
                        product_type: {},
                        unit: {},
                        size: {},
                    }),
                },
```

- [ ] **Step 4.5: Jalankan tsc untuk verifikasi type safety**

Run: `rtk tsc --noEmit`

Expected: PASS, tidak ada `any`/`unknown` warning.

- [ ] **Step 4.6: Jalankan test — pastikan PASS**

Run: `npx vitest run src/tests/inventory/fg/import/import.service.test.ts`

Expected: PASS semua test (3 preview + 4 execute = 7).

- [ ] **Step 4.7: Commit**

```bash
rtk git add src/module/application/inventory/fg/import/import.service.ts src/tests/inventory/fg/import/import.service.test.ts src/tests/setup.ts
rtk git commit -m "feat(fg-import): add execute + bulkUpsert dengan ORM upsert"
```

---

## Task 5: Service `getPreview` method (TDD)

**Files:**
- Modify: `src/tests/inventory/fg/import/import.service.test.ts`
- Modify: `src/module/application/inventory/fg/import/import.service.ts`

- [ ] **Step 5.1: Tambah test untuk `getPreview`**

Append ke `src/tests/inventory/fg/import/import.service.test.ts` (sebelum closing `})` paling luar):

```ts
    describe("getPreview", () => {
        it("throws ApiError 404 jika cache tidak ada", async () => {
            vi.mocked(redisClient.get).mockResolvedValueOnce(null);

            await expect(FGImportService.getPreview("missing-id")).rejects.toThrow(
                "Import preview not found or expired",
            );
        });

        it("throws ApiError 400 jika sudah executed", async () => {
            vi.mocked(redisClient.get).mockResolvedValueOnce(
                JSON.stringify({
                    status: "executing",
                    createdAt: Date.now(),
                    total: 0,
                    valid: 0,
                    invalid: 0,
                    rows: [],
                }),
            );

            await expect(FGImportService.getPreview("executing-id")).rejects.toThrow(
                "Import already executed",
            );
        });

        it("mengembalikan summary + rows ketika cache valid", async () => {
            const cachePayload = {
                status: "preview" as const,
                createdAt: 1700000000000,
                total: 2,
                valid: 1,
                invalid: 1,
                rows: [
                    {
                        code: "OK",
                        name: "OK",
                        gender: "MEN",
                        size: 100,
                        type: "parfum",
                        unit: "ml",
                        distribution_percentage: 0,
                        safety_percentage: 0,
                        errors: [],
                    },
                ],
            };
            vi.mocked(redisClient.get).mockResolvedValueOnce(JSON.stringify(cachePayload));

            const result = await FGImportService.getPreview("ok-id");

            expect(result.import_id).toBe("ok-id");
            expect(result.total).toBe(2);
            expect(result.rows).toHaveLength(1);
        });
    });
```

- [ ] **Step 5.2: Jalankan test — pastikan FAIL**

Run: `npx vitest run src/tests/inventory/fg/import/import.service.test.ts`

Expected: FAIL pada blok `getPreview`.

- [ ] **Step 5.3: Tambah method `getPreview` di service**

Edit `src/module/application/inventory/fg/import/import.service.ts` — tambahkan method di dalam class (setelah `bulkUpsert`):

```ts
    static async getPreview(import_id: string) {
        const cache = (await ImportCacheService.get(
            CACHE_PREFIX,
            import_id,
        )) as ImportCachePayload | null;

        if (!cache) throw new ApiError(404, "Import preview not found or expired");
        if (cache.status !== "preview") throw new ApiError(400, "Import already executed");

        return {
            import_id,
            total: cache.total,
            valid: cache.valid,
            invalid: cache.invalid,
            rows: cache.rows,
            createdAt: cache.createdAt,
        };
    }
```

- [ ] **Step 5.4: Jalankan test — pastikan PASS**

Run: `npx vitest run src/tests/inventory/fg/import/import.service.test.ts`

Expected: PASS semua test (3 preview + 4 execute + 3 getPreview = 10).

- [ ] **Step 5.5: Commit**

```bash
rtk git add src/module/application/inventory/fg/import/import.service.ts src/tests/inventory/fg/import/import.service.test.ts
rtk git commit -m "feat(fg-import): add getPreview method dengan ApiError 404/400"
```

---

## Task 6: Controller

**Files:**
- Create: `src/module/application/inventory/fg/import/import.controller.ts`

- [ ] **Step 6.1: Tulis controller**

```ts
import { Context } from "hono";
import { ApiResponse } from "../../../../../lib/api.response.js";
import { ApiError } from "../../../../../lib/errors/api.error.js";
import { GetUploadedFile } from "../../../../../lib/get.file.js";
import { ParseCSV } from "../../../../../lib/csv.js";
import { ParseXLSX } from "../../../../../lib/excel.js";
import { FGImportService } from "./import.service.js";
import { RequestExecuteFGImportDTO } from "./import.schema.js";

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
        // Hono Context.get default ke `any` tanpa generic Variables — di-narrow di sini supaya type-safe.
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

- [ ] **Step 6.2: Verifikasi tsc**

Run: `rtk tsc --noEmit`

Expected: PASS.

- [ ] **Step 6.3: Commit**

```bash
rtk git add src/module/application/inventory/fg/import/import.controller.ts
rtk git commit -m "feat(fg-import): add FGImportController"
```

---

## Task 7: Routes + mount ke FG

**Files:**
- Create: `src/module/application/inventory/fg/import/import.routes.ts`
- Modify: `src/module/application/inventory/fg/fg.routes.ts`

- [ ] **Step 7.1: Tulis import routes**

Create `src/module/application/inventory/fg/import/import.routes.ts`:

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

- [ ] **Step 7.2: Mount di `fg.routes.ts`**

Edit `src/module/application/inventory/fg/fg.routes.ts` — tambahkan import di header:

```ts
import { FGImportRoutes } from "./import/import.routes.js";
```

Tambahkan sub-route mount sebelum semua route lainnya (setelah `export const FGRoutes = new Hono();`):

```ts
FGRoutes.route("/import", FGImportRoutes);
```

File final:

```ts
import { Hono } from "hono";
import { validateBody } from "../../../../middleware/validation.js";
import { FGController } from "./fg.controller.js";
import { BulkStatusFGSchema, RequestFGSchema } from "./fg.schema.js";
import { FGImportRoutes } from "./import/import.routes.js";

export const FGRoutes = new Hono();

FGRoutes.route("/import", FGImportRoutes);

FGRoutes.get("/export", FGController.export);
FGRoutes.put("/bulk-status", validateBody(BulkStatusFGSchema), FGController.bulkStatus);
FGRoutes.patch("/status/:id", FGController.status);
FGRoutes.delete("/clean", FGController.clean);

FGRoutes.put("/:id", validateBody(RequestFGSchema.partial()), FGController.update);
FGRoutes.get("/:id", FGController.detail);

FGRoutes.get("/", FGController.list);
FGRoutes.post("/", validateBody(RequestFGSchema), FGController.create);
```

- [ ] **Step 7.3: Verifikasi tsc**

Run: `rtk tsc --noEmit`

Expected: PASS.

- [ ] **Step 7.4: Commit**

```bash
rtk git add src/module/application/inventory/fg/import/import.routes.ts src/module/application/inventory/fg/fg.routes.ts
rtk git commit -m "feat(fg-import): mount FGImportRoutes di /api/app/inventory/fg/import"
```

---

## Task 8: Integration tests (routes)

**Files:**
- Create: `src/tests/inventory/fg/import/import.routes.test.ts`

- [ ] **Step 8.1: Tulis integration test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import app from "../../../../app.js";
import { redisClient } from "../../../../config/redis.js";

vi.mock("hono/cookie", async (importOriginal) => {
    const original = await importOriginal<typeof import("hono/cookie")>();
    return {
        ...original,
        getCookie: vi.fn().mockReturnValue("mock-session-id"),
    };
});

vi.mock("../../../../middleware/csrf.js", () => ({
    csrfMiddleware: async (_c: unknown, next: () => Promise<void>) => await next(),
}));

const BASE = "/api/app/inventory/fg/import";

const VALID_SESSION = JSON.stringify({
    email: "test@example.com",
    role: "SUPER_ADMIN",
    employee: { permissions: [] },
});

type RedisKeyArg = string | Buffer;
const keyToString = (key: RedisKeyArg): string =>
    typeof key === "string" ? key : key.toString();

const defaultRedisGet = async (key: RedisKeyArg): Promise<string | null> => {
    if (keyToString(key).startsWith("session:")) return VALID_SESSION;
    return null;
};

describe("FGImportRoutes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(redisClient.get).mockImplementation(defaultRedisGet);
    });

    describe("POST /execute", () => {
        it("returns 400 saat import_id tidak ada (validateBody)", async () => {
            const res = await app.request(`${BASE}/execute`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            });
            expect(res.status).toBe(400);
        });

        it("returns 400 saat import_id bukan UUID valid", async () => {
            const res = await app.request(`${BASE}/execute`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ import_id: "not-a-uuid" }),
            });
            expect(res.status).toBe(400);
        });

        it("returns 400 saat cache tidak ditemukan", async () => {
            vi.mocked(redisClient.get).mockImplementation(async (key: RedisKeyArg) => {
                if (keyToString(key).startsWith("session:")) return VALID_SESSION;
                return null;
            });

            const res = await app.request(`${BASE}/execute`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ import_id: "00000000-0000-0000-0000-000000000000" }),
            });
            expect(res.status).toBe(400);
        });
    });

    describe("GET /preview/:import_id", () => {
        it("returns 404 saat preview tidak ditemukan", async () => {
            vi.mocked(redisClient.get).mockImplementation(async (key: RedisKeyArg) => {
                if (keyToString(key).startsWith("session:")) return VALID_SESSION;
                return null;
            });

            const res = await app.request(`${BASE}/preview/00000000-0000-0000-0000-000000000000`, {
                method: "GET",
            });
            expect(res.status).toBe(404);
        });

        it("returns 200 dengan summary + rows ketika cache valid", async () => {
            const cachePayload = {
                status: "preview",
                createdAt: Date.now(),
                total: 1,
                valid: 1,
                invalid: 0,
                rows: [
                    {
                        code: "FG_001",
                        name: "Parfum",
                        gender: "MEN",
                        size: 100,
                        type: "parfum",
                        unit: "ml",
                        distribution_percentage: 0,
                        safety_percentage: 0,
                        errors: [],
                    },
                ],
            };

            vi.mocked(redisClient.get).mockImplementation(async (key: RedisKeyArg) => {
                if (keyToString(key).startsWith("session:")) return VALID_SESSION;
                if (keyToString(key).startsWith("fg:import:")) return JSON.stringify(cachePayload);
                return null;
            });

            const res = await app.request(
                `${BASE}/preview/00000000-0000-0000-0000-000000000000`,
                { method: "GET" },
            );
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.status).toBe("success");
        });
    });
});
```

- [ ] **Step 8.2: Jalankan test — pastikan PASS**

Run: `npx vitest run src/tests/inventory/fg/import/import.routes.test.ts`

Expected: PASS 5 test.

- [ ] **Step 8.3: Jalankan ALL test — pastikan tidak ada regresi**

Run: `npx vitest run`

Expected: PASS semua, jumlah test bertambah dari sebelumnya (existing FG + RM + 10 service import + 5 routes import).

- [ ] **Step 8.4: Final tsc check**

Run: `rtk tsc --noEmit`

Expected: PASS, tidak ada error.

- [ ] **Step 8.5: Commit**

```bash
rtk git add src/tests/inventory/fg/import/import.routes.test.ts
rtk git commit -m "test(fg-import): add integration test untuk routes"
```

---

## Verification Checklist (Post-Implementation)

- [ ] Folder `src/module/application/inventory/fg/import/` ada 4 file (routes/controller/service/schema)
- [ ] Folder `src/tests/inventory/fg/import/` ada 2 file (service.test + routes.test)
- [ ] `src/lib/utils/upsert-size.ts` ada, `fg.service.ts` import dari sana (private helper sudah dihapus)
- [ ] `fg.routes.ts` mount `FGImportRoutes` di `/import`
- [ ] Folder `src/module/application/product/import/` **tidak diubah**
- [ ] `rtk tsc --noEmit` clean
- [ ] `npx vitest run` semua pass; total test bertambah 15 (10 service + 5 routes)
- [ ] Manual smoke: `POST /api/app/inventory/fg/import/preview` (multipart) → 201, dapat `import_id`; `POST /api/app/inventory/fg/import/execute` → 201
