# 🚢 Deployment

Panduan deploy backend ERP Mandalika ke environment production.

---

## 1. Prasyarat Server

- Node.js 18+ (recommended 20 LTS).
- PostgreSQL 14+.
- Redis 6+ (untuk session, CSRF, rate limit cache).
- Reverse proxy (Nginx/Caddy) terminate TLS — backend listen di port `${PORT}` lokal.

---

## 2. Environment Variables

File `.env` di root `api/`. Wajib (lihat `src/config/env.ts` untuk validator `envalid`):

```env
# APP
NODE_ENV=production
APP_NAME=Mandalika
BASE_URL=https://api.mandalikaperfume.my.id
PORT=3000
HOSTNAME=0.0.0.0
COOKIE_DOMAIN=.mandalikaperfume.my.id

# Database
DATABASE_URL=postgresql://user:pass@host:5432/erp_mandalika

# Log
LOG_LEVEL=info                       # error | warn | info | http | verbose | debug | silly

# REDIS
REDIS_HOST=redis.internal
REDIS_PORT=6379
REDIS_PASSWORD=<strong-secret>
REDIS_DB=0

# SESSION
SESSION_COOKIE_NAME=mdlk_sid
SESSION_TTL=86400                    # detik (1 hari). Dipakai untuk sliding TTL.

# CSRF
CSRF_COOKIE_NAME=mdlk_csrf
CSRF_HEADER_NAME=x-xsrf-header

# CORS (comma-separated)
CORS_ORIGINS=https://erp.mandalikaperfume.my.id,https://app.mandalikaperfume.my.id
CORS_METHODS=GET,POST,PUT,DELETE,PATCH
CORS_ALLOWED_HEADERS=Content-Type,Authorization
CORS_EXPOSED_HEADERS=Content-Length
CORS_MAX_AGE=86400

# RATE
RATE_VIOLATION=3

# AUTH
EMAIL_VERIFICATION=false
SALT_ROUND=12

# Google API (sheet sync untuk forecast)
GOOGLE_SERVICE_ACCOUNT_EMAIL=svc@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
GOOGLE_SHEET_ID=<sheet-id>
SHEET_FORECAST=Forecast
```

`envalid` akan **fail-fast** saat boot jika var wajib hilang.

---

## 3. Build

```bash
cd api
npm ci                    # install deterministic
npx prisma generate       # regenerate prisma client (output: src/generated/prisma)
npm run build             # tsc → dist/
```

Output: `dist/src/server.js`. Run:

```bash
npm start                 # node dist/src/server.js
```

---

## 4. Migrasi DB

Proyek pakai `prisma db push` (lihat `DATABASE.md`). Sebelum start aplikasi versi baru:

```bash
npx prisma db push        # sync schema → DB
npx prisma generate
```

> **Catatan**: `db push` bersifat non-versioned. Untuk lingkungan dengan compliance ketat, pertimbangkan migrate to `prisma migrate deploy` (perlu setup migration history).

---

## 5. Healthcheck

`GET /health` (skip auth & rate limit & CSRF):

```json
{
  "status": "healthy",
  "database": true,
  "redis": true,
  "timestamp": "...",
  "requestId": "...",
  "uptime": 123.4,
  "memory": { ... },
  "sessions": { ... },
  "activity": { ... },
  "ip": "..."
}
```

503 jika DB / Redis tidak respon (HTTPException). Pakai endpoint ini untuk load balancer / k8s readiness probe.

---

## 6. Reverse Proxy

Contoh Nginx (snippet):

```nginx
upstream erp_api {
    server 127.0.0.1:3000;
    keepalive 32;
}

server {
    listen 443 ssl http2;
    server_name api.mandalikaperfume.my.id;

    location / {
        proxy_pass         http://erp_api;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   Connection        "";
        proxy_read_timeout 65s;
    }
}
```

> Backend sudah set `secureHeaders` (HSTS, CSP, X-Frame-Options, dll) di `app.ts`.

---

## 7. Process Manager

Pakai `pm2` atau `systemd`.

### pm2

```bash
pm2 start dist/src/server.js \
  --name erp-api \
  --update-env \
  --max-memory-restart 1G \
  --time

pm2 save
pm2 startup
```

### systemd unit

```ini
[Unit]
Description=ERP Mandalika API
After=network.target postgresql.service redis.service

[Service]
Type=simple
WorkingDirectory=/srv/erp/api
EnvironmentFile=/srv/erp/api/.env
ExecStart=/usr/bin/node dist/src/server.js
Restart=always
RestartSec=5
User=erp
Group=erp

[Install]
WantedBy=multi-user.target
```

---

## 8. Graceful Shutdown

`server.ts` listen `SIGINT` & `SIGTERM`:

```
1. server.close()              # tunggu request in-flight
2. closeRedisConnection()
3. closeDatabase()             # prisma.$disconnect()
4. setTimeout(exit, 100ms)
```

Gunakan `kill -SIGTERM <pid>` (pm2 `stop` & systemd `stop` sudah benar).

---

## 9. Backup

- **DB**: `pg_dump erp_mandalika | gzip > backup_$(date +%F).sql.gz` (cron harian).
- **Redis**: snapshot AOF/RDB sesuai konfigurasi. Session loss aman (user akan re-login).

---

## 10. Logs

- Default Winston ke stdout (`Console` transport), prod = JSON.
- Exception & rejection ditulis ke file: `logs/exceptions.log`, `logs/rejections.log`.
- Untuk aggregator (ELK / Loki), pipe stdout ke vector/fluentbit.

---

## 11. Common Issues

| Gejala                                        | Cek                                                                  |
| :-------------------------------------------- | :------------------------------------------------------------------- |
| Boot crash `envalid: missing X`               | env var hilang — lihat `.env` vs `config/env.ts`                     |
| 403 CSRF mismatch terus-menerus               | `CSRF_COOKIE_NAME` / `CSRF_HEADER_NAME` env mismatch antara FE & BE  |
| Session hilang antar request                  | `COOKIE_DOMAIN` salah, atau frontend tidak `credentials: "include"`  |
| 429 di endpoint normal                        | `rateLimiter` aktif di prod — naikkan `maxRequests` atau whitelist path |
| Healthcheck `database: false`                 | `DATABASE_URL` salah / DB down / firewall                            |
| `Corrupted session data`                      | Migrasi format string→hash; hapus key `session:*` di Redis           |
| `Job session` cron tidak jalan                | Import `./job/session.js` di `server.ts` aktif?                      |

---

## 12. Update Workflow

```bash
git fetch && git checkout main
git pull
cd api
npm ci
npx prisma generate
npx prisma db push
npm run build
pm2 reload erp-api               # zero-downtime untuk cluster mode
```

Verifikasi `GET /health` sebelum mengarahkan traffic.
