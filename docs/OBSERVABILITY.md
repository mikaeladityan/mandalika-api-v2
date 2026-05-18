# 🔭 Observability

Logging, metrik, dan healthcheck di backend ERP Mandalika.

---

## 1. Logging — Winston

Konfigurasi: `src/lib/logger.ts`.

| Aspek    | Dev (NODE_ENV=development)                                   | Prod                              |
| :------- | :----------------------------------------------------------- | :-------------------------------- |
| Format   | Colorized, multi-line, dengan delimiter `==== INIT === ... ==== END ====` | JSON terstruktur                 |
| Transport| Console                                                       | Console (di-pipe ke aggregator)   |
| Level    | `LOG_LEVEL` env (default `info`)                             | sama                              |

### Level

```
error | warn | info | http | verbose | debug | silly
```

### Pemakaian

```ts
import { logger, dbLogger } from "../../../lib/logger.js";

logger.info("Order created", { orderId, userId });
logger.warn("Stok mendekati minimum", { productId, qty });
logger.error("Gagal kirim webhook", { error: err.message, stack: err.stack });

dbLogger.debug("Query plan", { sql });
```

### Exception & Rejection

Winston otomatis tulis uncaught exception & unhandled rejection ke file:

```
logs/exceptions.log
logs/rejections.log
```

---

## 2. Request Tracing

### 2.1 Request ID

Middleware `request.ts` set `c.set("requestId", uuid())` di awal pipeline.
- Disertakan di **semua** response error (`error.handler.ts`).
- Disertakan di field log via Winston.
- Frontend boleh log dari response header / body untuk correlation.

### 2.2 Request Logger

`middleware/request.logger.ts` — log setiap request structured (method, path, status, durationMs, requestId, userId).
Selain itu Hono built-in `honoLogger((str) => logger.http(str))` log line baseline.

---

## 3. Session Metrics

`src/lib/monitor.ts` (`SessionMetrics`):

| Method                         | Output                                        |
| :----------------------------- | :-------------------------------------------- |
| `SessionMetrics.getSessionStats()` | total session aktif, breakdown role, dll  |
| `SessionMetrics.getSessionActivity()` | aktivitas terkini (login, logout)     |

Diakses lewat `GET /health`.

---

## 4. Healthcheck

`GET /health` (skip auth, CSRF, rate limit):

```json
{
  "status": "healthy",
  "database": true,
  "redis": true,
  "timestamp": "2026-05-16T10:00:00.000Z",
  "requestId": "<uuid>",
  "uptime": 12345.67,
  "memory": { "rss": 123456, "heapUsed": 12345, ... },
  "sessions": { "totalActive": 42, "byRole": { "ADMIN": 2, "STAFF": 40 } },
  "activity": { "loginsLast15m": 7, "logoutsLast15m": 2 },
  "ip": "203.0.113.42"
}
```

Service tidak sehat → 503 (`HTTPException`) jika `database` atau `redis` gagal.

---

## 5. Rate Limit Logging

`middleware/rate.limit.ts`:

- `enableLogging: env.isProd` — log setiap violation.
- `SuspiciousActivity` model di Prisma dipakai untuk tracking IP+UA dengan severity (lihat skema schema `prisma`).

---

## 6. Pola Log Domain

| Event                    | Level   | Context                              |
| :----------------------- | :------ | :----------------------------------- |
| Mutasi sukses (CRUD)     | `info`  | `{ entity, id, userId, requestId }`  |
| Validasi gagal           | `warn`  | `{ field, issue }`                   |
| Auth / CSRF mismatch     | `warn`  | `{ path, method, sessionId }`        |
| Transaksi rollback       | `error` | `{ error, payload }`                 |
| External call gagal      | `error` | `{ url, status, body }`              |
| Bootstrap                | `info`  | `{ port, hostname, env }`            |

---

## 7. Metrics Export (Opsional)

Belum ada Prometheus scrape endpoint built-in. Direkomendasikan:

1. Tambah middleware `metrics()` yang catat histogram `request_duration_ms{path,method,status}`.
2. Expose `/metrics` (skip auth) untuk Prometheus.
3. Skip `/metrics` di `rateLimiter` (sudah ada di `skipPaths`).

Implementasi bisa dengan `prom-client`. Issue tracker / `docs/TODO.md` punya entry untuk ini bila relevan.

---

## 8. Tracing Lebih Dalam

Untuk distributed tracing (OpenTelemetry):

- Bungkus `prisma` dengan extension yang span query.
- Inject `traceparent` header dari frontend.
- Tambah `@hono/otel` middleware.

Belum diaktifkan di kode saat ini.

---

## 9. Log Rotation

`logs/exceptions.log` & `logs/rejections.log` ditulis raw — pakai `logrotate` di host untuk rotasi mingguan + compress.

```
/srv/erp/api/logs/*.log {
    weekly
    rotate 8
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
}
```

---

_Lihat juga: [`DEPLOYMENT.md`](./DEPLOYMENT.md), [`AUTH.md`](./AUTH.md) (rate limit)._
