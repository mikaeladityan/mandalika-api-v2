# 🏛️ Architecture

Arsitektur backend ERP Mandalika v0.1.1.

---

## 1. Stack

| Lapisan        | Teknologi                                                       |
| :------------- | :-------------------------------------------------------------- |
| Runtime        | Node.js 18+                                                     |
| Web Framework  | [Hono](https://hono.dev) ^4.11 (via `@hono/node-server`)        |
| ORM            | [Prisma](https://www.prisma.io) ^6.19 (`prisma-client` output)  |
| Database       | PostgreSQL (driver `pg` + `@prisma/adapter-pg`)                 |
| Cache & Session| Redis (`ioredis` ^5.8)                                          |
| Validation     | [Zod](https://zod.dev) ^4.3                                     |
| Logging        | Winston ^3.19                                                   |
| Cron           | `node-cron` ^4.2                                                |
| Auth Hashing   | `bcrypt` ^6.0                                                   |
| File Parsing   | `csv-parse`, `exceljs`                                          |
| Test           | Vitest ^4.0                                                     |
| Language       | TypeScript ^5.9 (ESM, `"type": "module"`)                       |

---

## 2. Direktori `src/`

```
src/
├── app.ts                 # Hono app: middleware stack + global error handler
├── server.ts              # bootstrap, init DB+Redis, graceful shutdown
├── config/
│   ├── env.ts             # envalid: validasi & parsing env
│   ├── prisma.ts          # PrismaClient instance + connect/disconnect
│   └── redis.ts           # ioredis client (lazyConnect)
├── lib/
│   ├── api.response.ts    # ApiResponse.sendSuccess / sendError
│   ├── auth.ts            # setSessionLogin helper
│   ├── csv.ts, excel.ts   # parser + export
│   ├── errors/api.error.ts
│   ├── index.ts           # generateHexToken, normalizeSlug
│   ├── logger.ts          # Winston (dev: pretty, prod: JSON)
│   ├── monitor.ts         # SessionMetrics
│   ├── session.management.ts
│   └── utils/
│       ├── cache.ts
│       ├── clean.sheets.ts
│       ├── generate-number.ts  # RFQ/PO/RCV/RTN/AP/AR/CB/JV numbers
│       ├── import.cache.ts
│       └── pagination.ts
├── middleware/
│   ├── auth.ts            # authMiddleware + roleMiddleware
│   ├── csrf.ts            # CSRF token check (Redis-backed)
│   ├── error.handler.ts   # central error → JSON response
│   ├── rate.limit.ts      # token-bucket via Redis
│   ├── request.ts         # requestId
│   ├── request.logger.ts  # structured request log
│   ├── sanitizer.ts       # input sanitizer
│   ├── session.ts         # session resolution
│   └── validation.ts      # validate(body|query)
├── job/
│   ├── session.ts         # cron cleanup expired sessions
│   └── forcast.job.ts
├── module/
│   ├── route.ts           # mount /auth · /app · /global
│   ├── auth/
│   ├── global/
│   └── application/       # 19 sub-modul (Lihat sub-pohon di README.md)
├── generated/prisma/      # output `prisma generate`
└── tests/                 # Vitest
```

---

## 3. Middleware Pipeline

Eksekusi top-down di `app.ts`:

```
1.  app.onError(errorHandler)         # global catch
2.  requestId                          # uuid → c.set("requestId")
3.  secureHeaders                      # HSTS, CSP, X-Frame, dll
4.  cors                               # CORS_ORIGINS / methods / headers
5.  compress                           # gzip
6.  requestLogger + hono/logger        # winston http
7.  timeout(60000)
8.  sanitizer                          # strip XSS
9.  rateLimiter                        # Redis token bucket (skip /health /metrics /csrf)
10. sessionMiddleware                  # resolve session cookie → c.set(session cookie name)
11. csrfMiddleware                     # validate x-csrf-token vs Redis (exempt GET/HEAD/OPTIONS + /csrf + /health)
12. /health, /csrf, /api/*             # routing
13. app.notFound                       # 404 JSON
```

`/api` → `routes` (lihat `module/route.ts`):

```
/api
 ├── /auth      → AuthRoutes
 ├── /app       → ApplicationRoutes (use authMiddleware)
 └── /global    → GlobalRoutes
```

Aplikasi (`/api/app/*`) **selalu** lewat `authMiddleware` lebih dulu.

---

## 4. Layering per Module

Setiap modul fungsional mengikuti pola **route → controller → service → Prisma**.

```
foo/
├── foo.routes.ts        # mount path + validateBody + handler
├── foo.controller.ts    # static class: ambil req, call service, ApiResponse.sendSuccess
├── foo.service.ts       # static class / namespace: bisnis logic + Prisma
└── foo.schema.ts        # Zod schemas + DTO type
```

### 4.1 Route

- Bind path → handler controller.
- Apply per-route middleware (rate limit khusus, `validateBody(...)`).
- TIDAK boleh memuat logic bisnis.

```ts
RFQRoutes.post("/", validateBody(CreateRFQSchema), RFQController.create);
RFQRoutes.patch("/:id/status", validateBody(UpdateRFQStatusSchema), RFQController.updateStatus);
```

### 4.2 Controller

- Ambil context (`c.get("body")`, `c.req.param`, `c.req.query`, `c.get("user")`).
- Panggil service. Boleh validasi tambahan ringan (parsing id).
- Return via `ApiResponse.sendSuccess(c, data, statusCode?, queryMeta?)`.

### 4.3 Service

- Static class atau plain object dengan method statis.
- Berisi **business rule**, query Prisma, transaksi.
- Throw `ApiError` saat gagal — _jangan_ kembalikan `{ ok: false }`.
- Gunakan `prisma.$transaction(async (tx) => {...})` untuk operasi multi-tabel (Receipt, Production, AP).

### 4.4 Schema (Zod)

- Semua input divalidasi sebelum masuk controller via `validateBody`.
- Convention nama: `RequestXxxSchema` / `QueryXxxSchema` / `UpdateXxxStatusSchema`.
- Export type DTO: `export type CreateXxxDTO = z.infer<typeof CreateXxxSchema>`.

---

## 5. Sub-Modul Application

Mount di `application.routes.ts` (semua di belakang `authMiddleware`):

| Path                       | Module Dir            | Catatan                                   |
| :------------------------- | :-------------------- | :---------------------------------------- |
| `/products`                | `product/`            | + sub: stocks, stock-locations, import, units, types, sizes |
| `/rawmat`                  | `rawmat/`             | + sub: suppliers, units, categories, import, stocks |
| `/warehouses`              | `warehouse/`          |                                            |
| `/outlets`                 | `outlet/`             | + sub: import, inventory                  |
| `/product-issuance`        | `issuance/`           | + import, rekap                           |
| `/shared`                  | `shared/`             | dropdown-style data                        |
| `/recipes`                 | `recipe/`             | + import                                  |
| `/forecasts`               | `forecast/`           | + percentages                             |
| `/recomendations-v2`       | `recomendation-v2/`   |                                            |
| `/consolidation`           | `consolidation/`      |                                            |
| `/bom`                     | `bom/`                |                                            |
| `/stock-transfers`         | `stock-transfer/`     | Legacy V1                                 |
| `/stock-movements`         | `stock-movement/`     | Audit trail                               |
| `/inventory-v2/{gr,do,tg,return,monitoring}` | `inventory-v2/` | Replace V1 untuk GR/DO/TG/Return |
| `/manufacturing`           | `manufacturing/`      | + inventory rm-movement, rm-receipt, rm-transfer, rm-usage, rm-sku-transfer, manual-waste-rm |
| `/purchase/{rfq,po,receipt,tracking,vendor-return}` | `purchase/` | Procure-to-Pay                           |
| `/finance/{ap,ar,cash,journal,kpi}` | `finance/`    | Hutang/Piutang, Kas, Jurnal, KPI          |

---

## 6. Data Flow Lintas Modul

Aliran tipikal Procure-to-Pay-to-Inventory-to-Finance:

```
Recommendation V2 ──► Consolidation (draft purchase) ──► RFQ ──► PO ──► PurchaseTracking
                                                                              │
                                                                              ▼
                                                                       Purchase Receipt
                                                                              │
                                              ┌───────────────────────────────┼───────────────┐
                                              ▼                               ▼               ▼
                                  RawMaterialInventory (stok+)        AP (hutang)    StockMovement (audit)
                                                                              │
                                                                              ▼
                                                                  Finance AP Payment (Cash/Journal)
```

Manufacturing → Inventory-V2:

```
ManufacturingOrder ─► allocate RM (RmTransfer, RmUsage) ─► output produk ─► GR (Goods Receipt)
                                                                                  │
                                                                                  ▼
                                                                         ProductInventory (stok+)
```

DO/TG/Return → StockMovement → ProductInventory/OutletInventory.

---

## 7. State Management

| Topik         | Implementasi                                                                                   |
| :------------ | :--------------------------------------------------------------------------------------------- |
| Session       | Redis `session:<sessionId>` (hash). TTL extended on each authenticated request (sliding TTL).  |
| CSRF token    | Redis `csrf:<sessionId>` (string). TTL 15 menit. Generate via `GET /csrf`.                     |
| Rate limit    | Redis (lihat `middleware/rate.limit.ts`). Bisa skip path (`/health`, `/metrics`, `/csrf`).      |
| Session cache | In-memory `Map` (`sessionCache`) untuk hindari Redis hit per request (TTL 5 menit).            |

---

## 8. Bootstrap & Shutdown

`server.ts`:

1. Load env (via `config/env.ts`).
2. `serve(app.fetch, { hostname, port })`.
3. `initializeDatabase()` → `prisma.$connect()`.
4. `redisClient.connect()` + ping.
5. Listen `SIGINT` / `SIGTERM` → `shutdown()`:
   - `server.close()` → tunggu in-flight selesai.
   - `closeRedisConnection()`.
   - `closeDatabase()` (Prisma disconnect).
   - `setTimeout(exit, 100)` untuk cleanup.

---

_Lihat juga: [`AUTH.md`](./AUTH.md), [`CONVENTIONS.md`](./CONVENTIONS.md), [`DATABASE.md`](./DATABASE.md)._
