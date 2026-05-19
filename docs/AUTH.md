# 🔐 Authentication & Authorization

Cara kerja session, CSRF, dan rate limiting di backend ERP Mandalika.

---

## 1. Endpoint Auth

Mount di `/api/auth` (`module/auth/auth.routes.ts`).

| Method | Path             | Body                                                                      | Catatan                                  |
| :----- | :--------------- | :------------------------------------------------------------------------ | :--------------------------------------- |
| POST   | `/api/auth/register` | `{ first_name, last_name?, email, password, confirm_password }`           | Rate-limited (10/menit prod). Email lowercase. Konflik email → `409`. |
| POST   | `/api/auth/`         | `{ email, password, remember? }`                                          | Login. Set cookie session + rotate CSRF. Max 10 device aktif per user (`MAX_DEVICES` di `lib/constants.ts`). |
| GET    | `/api/auth/`         | —                                                                         | Get current session (`authMiddleware`).   |
| DELETE | `/api/auth/`         | —                                                                         | Logout. Hapus session + CSRF + index dari Redis. Return `200`. |

### Validasi Password (Zod `auth.schema.ts`)

- min 8 karakter, max 100.
- Wajib mengandung: huruf besar, angka, karakter spesial.
- Pesan error Bahasa Indonesia.

### Register vs Login

`RegisterSchema = AuthBaseSchema + first_name, last_name?, confirm_password`. `confirm_password` divalidasi via `.refine()` agar sama dengan `password`.
DTO export:

```ts
export type LoginRequestDTO = z.infer<typeof LoginSchema>;
export type RegisterRequestDTO = Omit<z.infer<typeof RegisterSchema>, "confirm_password">;
```

---

## 2. Session

### 2.1 Penyimpanan

- Backend: Redis key `session:<sessionId>` (JSON string). TTL = `SESSION_TTL` (detik), atau `7 hari` jika `remember = true`.
- Index per-user: Redis Set `sessions:<email>` berisi semua `sessionId` aktif user (untuk O(1) lookup, hindari `KEYS` scan).
- Klien (browser): cookie `SESSION_COOKIE_NAME` (default ditentukan env), `HttpOnly`, `Secure` (prod), `SameSite=Lax`, `Domain` dari `COOKIE_DOMAIN` (prod).
- Klien headless (script/server-to-server): kirim `Authorization: Bearer <sessionId>` (lihat `middleware/auth.ts`).

### 2.2 Lifecycle

1. `POST /api/auth/` (login) → `setSessionLogin(c, sessionToken, remember, sessionData)`.
2. Session disimpan ke Redis sebagai JSON string + cookie ke browser. `SADD sessions:<email> <sessionId>` untuk per-user index. Old CSRF token dihapus (rotation, anti-fixation).
3. Setiap request authenticated:
   - `authMiddleware` ambil sessionId dari cookie / `Authorization` header.
   - Cache memori (`sessionCache`, TTL 5 menit) untuk hindari Redis hit.
   - Sliding TTL: extend `expire` di background (non-blocking).
   - Set `c.set("user")`, `c.set("session")`, `c.set("role")`, `c.set("permissions")`, `c.set("sessionId")`.
4. Logout → baca session → `SREM sessions:<email> <sid>` → `DEL session:<sid>` + `csrf:<sid>` + clear cookie.

### 2.3 Multi-Device Limit

`MAX_DEVICES = 10` (di `src/lib/constants.ts`). Login ditolak `429` jika sudah 10 sesi aktif untuk email yang sama. Lookup pakai `SMEMBERS sessions:<email>` (O(1) sets, bukan KEYS scan).

Untuk sesi yang dibuat sebelum refactor index (belum ada entry di `sessions:<email>`), jalankan script `scripts/backfill-session-index.ts` post-deploy. Idempotent.

### 2.4 Session Cache (In-Memory)

`sessionCache: Map<string, { data, expiry }>` di `lib/session.management.ts`.
- TTL 5 menit (`CACHE_TTL = 300`).
- Cleanup periodik tiap 60 detik (`setInterval`).
- Hindari hot loop Redis untuk endpoint frequent.

### 2.5 Format Penyimpanan

Session disimpan sebagai **JSON string** (`redisClient.set` + `JSON.parse` saat baca). Parse error → delete key + 401. Tidak ada Hash format.

---

## 3. CSRF Protection

### 3.1 Token

- `GET /csrf` → generate token 32-byte hex.
- Simpan di Redis: `csrf:<sessionId>` (TTL 15 menit).
- Set cookie `CSRF_COOKIE_NAME` (NOT `HttpOnly`, agar JS bisa baca).
- Kirim kembali ke klien dalam body: `{ data: { process: "success", token: "<hex>" } }`.

### 3.2 Validasi (`middleware/csrf.ts`)

- Skip jika method `GET` / `HEAD` / `OPTIONS`.
- Skip rute exempt: `GET:/csrf`, `GET:/health`, `OPTIONS:*`.
- Untuk mutation lain:
  - Header `x-xsrf-header` (configurable via `CSRF_HEADER_NAME`) wajib.
  - `sessionId` harus terisi di context.
  - Bandingkan dengan token dari `redisClient.get(csrf:<sid>)`.
  - Mismatch / hilang → `403 CSRF token mismatch` / `CSRF token or session missing`.

### 3.3 Klien

```js
const { data } = await fetch("/csrf", { credentials: "include" }).then(r => r.json());
const csrf = data.token;

await fetch("/api/app/products", {
  method: "POST",
  credentials: "include",
  headers: {
    "Content-Type": "application/json",
    "x-xsrf-header": csrf,
  },
  body: JSON.stringify(payload),
});
```

---

## 4. Rate Limiting

Implementasi `middleware/rate.limit.ts` (Redis token bucket).

### 4.1 Global

Di `app.ts`:

```ts
rateLimiter({
  maxRequests: env.isDevelopment ? 1000 : 100,
  interval: env.isDevelopment ? 300 : 15,
  temporaryBlockDuration: env.isDevelopment ? 60 : 300,
  skipPaths: ["/health", "/metrics", "/csrf"],
  enableBlocking: env.isProd,
  enableLogging: env.isProd,
})
```

### 4.2 Per-Route (lebih ketat)

`POST /api/auth/register` & `POST /api/auth/`:

```ts
rateLimiter({
  maxRequests: env.isDevelopment ? 50 : 10,
  interval: env.isDevelopment ? 300 : 60,
  temporaryBlockDuration: env.isDevelopment ? 60 : 300,
})
```

### 4.3 Response saat Throttle

`RateLimitError` (lihat `lib/errors/api.error.ts`):

```json
{
  "success": false,
  "error": "RateLimitError",
  "message": "Too many requests",
  "retryAfter": 60,
  "requestId": "<uuid>"
}
```

Header: `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`.

---

## 5. Role-Based Access (RBAC)

Enum Prisma `ROLE` (lihat `schema.prisma`).

```ts
import { roleMiddleware } from "../middleware/auth.js";
import { ROLE } from "../generated/prisma/client.js";

FooRoutes.delete("/:id", roleMiddleware([ROLE.ADMIN]), FooController.delete);
```

- Tanpa argumen / array kosong → izinkan semua role yang sudah login.
- Tidak match → `403 Forbidden: insufficient role`.

---

## 6. Headless / S2S Access

Untuk integrasi pihak ketiga atau script:

1. Login via `POST /api/auth/` (dapat session cookie + ambil dari `Set-Cookie`).
2. Atau gunakan sessionId dari sumber lain.
3. Kirim request berikutnya dengan header:

```
Authorization: Bearer <sessionId>
```

Untuk mutasi tetap perlu CSRF (`GET /csrf` lebih dulu, lalu kirim `x-xsrf-header`).
Pengecualian: endpoint Global (`/api/global/*`) hanya `GET` → tidak perlu CSRF (lihat `docs/api.md` di root).

---

## 7. Akses Context di Handler

Setelah `authMiddleware`:

```ts
const session    = c.get("session");      // raw object dari Redis hash
const user       = c.get("user");         // sessionData.user (sudah JSON.parse jika string)
const role       = c.get("role");         // string ROLE
const permissions= c.get("permissions");  // sessionData.employee?.permissions ?? []
const sessionId  = c.get("sessionId");
```

Validated body (setelah `validateBody`):

```ts
const body = c.get("body");   // hasil schema.parse()
```

---

## 8. Error Codes

| Code | Sebab                                                       |
| :--- | :---------------------------------------------------------- |
| 401  | Tidak ada session / session expired / invalid / corrupt     |
| 403  | CSRF mismatch / role tidak match                            |
| 409  | Email sudah terdaftar (register)                            |
| 429  | Rate limit / >10 device aktif                               |

Lihat [`ERROR_HANDLING.md`](./ERROR_HANDLING.md) untuk format response error.
