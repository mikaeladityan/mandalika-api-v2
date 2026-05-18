# 📚 Backend Documentation — ERP Mandalika (`api/`)

Dokumentasi lengkap untuk backend ERP Mandalika v0.1.1. Backend dibangun dengan **Hono + Prisma + PostgreSQL + Redis** dan menyediakan REST API untuk seluruh modul ERP (Master Data, Inventory, Manufacturing, Purchasing, Finance).

---

## 🧭 Daftar Isi

| Dokumen                                                  | Deskripsi                                                                                                |
| :------------------------------------------------------- | :------------------------------------------------------------------------------------------------------- |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md)                   | Stack teknologi, struktur direktori, layering (route → controller → service → Prisma), pola module.     |
| [`AUTH.md`](./AUTH.md)                                   | Session management, CSRF, rate limiting, role-based access, headless support via Bearer token.          |
| [`CONVENTIONS.md`](./CONVENTIONS.md)                     | Standar penulisan kode: Zod schema, controller pattern, service, error handling, naming, response shape. |
| [`API_REFERENCE.md`](./API_REFERENCE.md)                 | Daftar lengkap endpoint per modul dengan method, path, body, query, dan response shape.                  |
| [`ERROR_HANDLING.md`](./ERROR_HANDLING.md)               | Kelas error (`ApiError`, `ValidationError`, dll), HTTP status mapping, format response error.            |
| [`DATABASE.md`](./DATABASE.md)                           | Ringkasan 57 model Prisma, 42 enum, indeks utama, strategi migrasi (`db push`), naming convention.       |
| [`TESTING.md`](./TESTING.md)                             | Konvensi Vitest, struktur `src/tests/`, mock Prisma di `setup.ts`, pola unit & integration test.         |
| [`DEPLOYMENT.md`](./DEPLOYMENT.md)                       | Env variabel, build (`npm run build`), start (`npm start`), healthcheck, shutdown graceful.              |
| [`DOCUMENT_NUMBERING.md`](./DOCUMENT_NUMBERING.md)       | Format penomoran dokumen (RFQ, PO, RCV, RTN, AP, AR, CB, JV, MFG, GR, DO, TG, RET).                      |
| [`OBSERVABILITY.md`](./OBSERVABILITY.md)                 | Logging (Winston), request tracing, session metrics, health endpoint.                                    |
| [`CHANGELOG.md`](../CHANGELOG.md)                        | Riwayat perubahan backend.                                                                               |

## 🏗️ Dokumentasi Modul

| Modul                                                                                    | Path API                  | Status |
| :--------------------------------------------------------------------------------------- | :------------------------ | :----- |
| [Auth](./modules/auth.md)                                                                | `/api/auth`               | Stable |
| [Global Endpoints](./modules/global.md)                                                  | `/api/global/*`           | Stable |
| [Product](./modules/product.md)                                                          | `/api/app/products`       | Stable |
| [Raw Material](./modules/rawmat.md)                                                      | `/api/app/rawmat`         | Stable |
| [Warehouse](./modules/warehouse.md)                                                      | `/api/app/warehouses`     | Stable |
| [Outlet](./modules/outlet.md)                                                            | `/api/app/outlets`        | Stable |
| [Recipe / BOM](./modules/recipe-bom.md)                                                  | `/api/app/recipes`, `/bom`| Stable |
| [Issuance](./modules/issuance.md)                                                        | `/api/app/product-issuance` | Stable |
| [Forecast](./modules/forecast.md)                                                        | `/api/app/forecasts`      | Stable |
| [Recommendation V2 + Consolidation](./modules/recommendation.md)                         | `/api/app/recomendations-v2`, `/consolidation` | Stable |
| [Stock Transfer V1 + Movement](./modules/stock-legacy.md)                                | `/api/app/stock-transfers`, `/stock-movements` | Legacy |
| [Inventory V2 (GR / DO / TG / Return / Monitoring)](./modules/inventory-v2.md)           | `/api/app/inventory-v2/*` | Stable |
| [Manufacturing](./modules/manufacturing.md)                                              | `/api/app/manufacturing`  | Stable |
| [Purchasing (RFQ / PO / Receipt / Tracking / Vendor Return)](./modules/purchasing.md)    | `/api/app/purchase/*`     | Stable |
| [Finance (AP / AR / Cash / Journal / KPI)](./modules/finance.md)                         | `/api/app/finance/*`      | Stable |

---

## 🚀 Quick Start

```bash
cd api
npm install
cp .env.example .env          # isi DATABASE_URL, REDIS_*, SESSION_*, CSRF_*, GOOGLE_*
npx prisma generate
npx prisma db push            # sync schema ke DB (lihat DATABASE.md)
npm run dev                   # tsx watch src/server.ts
```

Server jalan di `http://${HOSTNAME}:${PORT}` (default `localhost:3000`).
Healthcheck: `GET /health` → status DB + Redis + session metrics.

---

## 🔑 Konvensi Singkat (lihat `CONVENTIONS.md` untuk detail)

- **Module pattern**: tiap fitur punya `*.routes.ts`, `*.controller.ts`, `*.service.ts`, `*.schema.ts` (Zod).
- **Response shape**: `{ status: "success" | "error", data?, message?, query? }` via `ApiResponse`.
- **Validation**: Zod via `validateBody(schema)` middleware → tersimpan di `c.get("body")`.
- **Error**: throw `ApiError(statusCode, message, details?)` — di-handle terpusat di `error.handler.ts`.
- **Auth**: cookie session (`getCookie`) atau `Authorization: Bearer <sid>` (headless).
- **CSRF**: wajib `x-csrf-token` header untuk semua mutation (POST/PUT/PATCH/DELETE). GET di-exempt.
- **DB transaction**: `prisma.$transaction(async (tx) => {...})` untuk operasi multi-tabel (Receipt, Production, dll).

---

## 📂 Struktur Folder

```
api/
├── prisma/
│   ├── schema.prisma          # 57 model, 42 enum
│   ├── migrations/
│   └── seed.ts
├── src/
│   ├── app.ts                 # Hono app + middleware stack
│   ├── server.ts              # entry point + graceful shutdown
│   ├── config/                # env, prisma, redis
│   ├── lib/                   # api.response, errors, logger, session.management, utils
│   ├── middleware/            # session, csrf, auth, rate.limit, validation, sanitizer, error.handler
│   ├── job/                   # cron (session cleanup, forecast)
│   ├── module/
│   │   ├── route.ts           # /auth · /app · /global
│   │   ├── auth/
│   │   ├── global/            # outlets, exchange-rate
│   │   └── application/       # 19 sub-modul (lihat tabel modul di atas)
│   ├── generated/prisma/      # output prisma generate
│   ├── tests/                 # Vitest suites (lihat TESTING.md)
│   └── scripts/
├── docs/                      # 📘 dokumentasi ini
├── logs/
└── package.json
```

---

_© 2026 Mandalika ERP. Bagian dari Standarisasi Operasional ERP Mandalika._
