# 🧪 Testing

Vitest 4.x dengan setup mock Prisma di `src/tests/setup.ts`. Tidak ada DB nyata di-hit selama test (kecuali integration test khusus).

---

## 1. Menjalankan Test

```bash
npm test                          # vitest run (single-run)
npx vitest                        # watch mode
npx vitest --coverage             # dengan coverage
npx vitest src/tests/finance      # filter folder
npx vitest -t "RFQ create"        # filter nama test
```

`vitest.config.ts`:

```ts
test: {
  globals: true,                    // describe/it/expect tanpa import
  environment: "node",
  setupFiles: ["./src/tests/setup.ts"],
  include: ["src/tests/**/*.test.ts"],
  env: { NODE_ENV: "test" },
}
```

`.env.test` dipakai otomatis (lihat `config/env.ts`: `process.env.NODE_ENV === "test" ? ".env.test" : ".env"`).

---

## 2. Struktur Folder `src/tests/`

```
src/tests/
├── setup.ts                    # global mock Prisma + Redis
├── auth/
├── bom/
├── finance/                    # ap, ar, cash, journal, kpi
├── forecast/
├── inventory/                  # V1 (stock, outlet inventory)
├── inventory-v2/               # gr, do, tg, return, monitoring, helper
├── issuance/
├── manufacturing/
├── outlet/
├── product/
├── purchase/                   # rfq, po, receipt, tracking, vendor-return
├── rawmat/
├── recipe/
├── stock-movement/
├── stock-transfer/
├── warehouse/
├── recomendation-v2.service.test.ts
└── rfq.service.test.ts
```

Konvensi nama:
- Unit service: `<feature>.service.test.ts`
- Integration route: `<feature>.routes.test.ts`

---

## 3. Pola Unit Test (Service)

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "../../config/prisma.js";
import { FooService } from "../../module/application/foo/foo.service.js";

describe("FooService.create", () => {
    beforeEach(() => vi.clearAllMocks());

    it("throws 409 jika code sudah ada", async () => {
        (prisma.foo.findUnique as any).mockResolvedValue({ id: 1, code: "X" });
        await expect(FooService.create({ code: "X", name: "A" }, { id: "u1" }))
            .rejects.toThrow("Kode sudah digunakan");
    });

    it("creates dengan transaksi sukses", async () => {
        (prisma.foo.findUnique as any).mockResolvedValue(null);
        (prisma.$transaction as any).mockImplementation(async (cb: any) =>
            cb({ foo: { create: vi.fn().mockResolvedValue({ id: 99 }) } })
        );

        const result = await FooService.create({ code: "X", name: "A" }, { id: "u1" });
        expect(result).toEqual({ id: 99 });
    });
});
```

---

## 4. Pola Integration Test (Routes)

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import app from "../../app.js";

const csrfHeader = { "x-csrf-token": "test-token" };

describe("POST /api/app/foo", () => {
    beforeEach(() => vi.clearAllMocks());

    it("returns 201 dengan payload valid", async () => {
        const res = await app.request("/api/app/foo", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...csrfHeader, Cookie: "session=test-sid" },
            body: JSON.stringify({ code: "X", name: "A" }),
        });
        expect(res.status).toBe(201);
        const json = await res.json();
        expect(json.status).toBe("success");
    });

    it("returns 400 saat validasi gagal", async () => {
        const res = await app.request("/api/app/foo", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...csrfHeader, Cookie: "session=test-sid" },
            body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
    });
});
```

`setup.ts` sudah mock auth middleware + CSRF + Redis sehingga `Cookie` + `x-csrf-token` dummy lolos.

---

## 5. Setup Global Mock (`src/tests/setup.ts`)

File ~44KB; berisi:

- `vi.mock("../config/prisma.js", ...)` — return object dengan `vi.fn()` per model (Account, Product, RawMaterial, ProductionOrder, PurchaseRFQ, AccountPayable, dll).
- `vi.mock("../config/redis.js", ...)` — fake Redis (`get`, `set`, `setex`, `del`, `hgetall`, `type`, `expire`, `ping`).
- Mock `authMiddleware` + `csrfMiddleware` agar handler langsung jalan.
- Fixture default (`prisma.account.findUnique`, `warehouse.findUnique` id=1/2/3, dll).

**Pola menambah mock model baru**:

```ts
// di setup.ts (sudah ada untuk model existing — ikuti pattern yg sudah ada)
prisma.newModel = {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
};
```

---

## 6. Coverage yang Dianjurkan

Untuk tiap service WAJIB cover minimal:

1. **Happy path** — input valid, return data benar.
2. **Validasi business rule** — kode duplikat, status invalid, stok tidak cukup.
3. **Not found** — 404.
4. **Transaction rollback** (jika multi-tabel).
5. **Edge case domain-specific** — mis. Receipt partial vs full, RFQ status transition.

Untuk routes:
- `200/201` happy.
- `400` validation.
- `404` resource not exist.
- `409` conflict (status atau code).
- `422` business rule violation.

---

## 7. Mock Helper Patterns

```ts
// Prisma transaction
(prisma.$transaction as any).mockImplementation(async (cb: any) => cb(prisma));

// Untuk operasi multiple model dalam tx, expose seluruh prisma sebagai tx
(prisma.$transaction as any).mockImplementation(async (cb: any) => cb(prisma));

// $queryRaw / $executeRaw
(prisma.$queryRaw as any).mockResolvedValue([{ count: 5 }]);
```

---

## 8. Testing Document Numbering

`generateRFQNumber`, `generatePONumber`, dll memanggil `count({ where: { <field>: { startsWith: prefix } } })`. Mock:

```ts
(prisma.purchaseRFQ.count as any).mockResolvedValue(2);
// → hasil: "RFQ-YYYYMMDD-003"
```

---

## 9. Linting & Type-check

Belum ada eslint/prettier config khusus di package.json (selain `.prettierrc`). Saat ini:

```bash
npx tsc --noEmit              # type-check tanpa emit
```

Anggap zero TS error sebagai gate sebelum PR.

---

## 10. CI

Workflow GitHub Actions ada di `api/.github/workflows/`. Lihat file YAML di sana untuk job aktif (test + build).
