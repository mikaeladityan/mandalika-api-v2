# PASETO Authentication Migration — Design Spec

**Date**: 2026-05-20
**Author**: Brainstormed with user (Mikael Aditya N)
**Status**: Approved design — ready for implementation plan
**Branch target**: `staging`
**Migration mode**: Big-bang cutover (no dual-run)

---

## 1. Problem Statement

ERP Mandalika backend saat ini menggunakan **opaque session token + double-submit CSRF** di Redis. Kebutuhan yang muncul:

1. **Mobile app** akan dibangun. CSRF cookie-based kurang natural untuk native mobile.
2. **Performa**: tiap request authenticated hit Redis (session lookup), meski sudah ada in-memory cache 5-menit.
3. **Distribusi**: arsitektur masih monolith Hono, tapi auth state stateful menyulitkan horizontal scaling tanpa shared Redis.

**Goal**: migrasi ke **PASETO v4.local access token (stateless) + opaque refresh token (stateful, rotated)**, mempertahankan kemampuan instant revoke melalui refresh layer.

**Non-goals**:
- Microservice split (tidak ada rencana 12–18 bulan ke depan).
- Multi-tenant key management.
- SSO / OAuth provider integration.

---

## 2. High-Level Architecture

### 2.1 Token Model

| Token | Tipe | TTL | Storage | Verifikasi | Revocable |
|---|---|---|---|---|---|
| **Access** | PASETO v4.local (encrypted, symmetric XChaCha20-Poly1305) | 15 menit | None (stateless) | Decrypt + verify `exp` — no I/O | ❌ (tunggu expire) |
| **Refresh** | Opaque random 32-byte hex | 7 hari default, 30 hari kalau `remember=true` | Redis `refresh:<rid>` | Redis lookup | ✅ instant via DEL |

### 2.2 Claims di Access Token

```ts
type AccessTokenClaims = {
    sub: string;        // userId
    email: string;
    role: ROLE;
    jti: string;        // unique token ID (untuk audit log)
    iat: number;        // issued at (unix seconds)
    exp: number;        // expiry (unix seconds)
    sid: string;        // refresh session ID (untuk linking access ↔ refresh family)
};
```

**Tidak ada permissions di claims** — permissions di-lazy-load via `permcache:<userId>` (5-min in-memory + Redis fallback). Rationale: role enough untuk `roleMiddleware`, permission detail jarang dibutuhkan (≤10% endpoint), perubahan permission jadi near-realtime.

### 2.3 Transport per Client

| Client | Access Token | Refresh Token |
|---|---|---|
| Web | JS memory (Zustand/state) — lost on tab refresh | HttpOnly cookie `Secure`, `SameSite=Lax`, `Path=/api/auth` |
| Mobile (future) | App memory | iOS Keychain / Android Keystore. Sent via `Authorization: Bearer <refresh>` to `/auth/refresh` |
| Headless / S2S | `Authorization: Bearer <access>` header | Same as mobile |

### 2.4 Redis Keyspace

```
refresh:<rid>              → JSON { userId, email, role, ip, userAgent, family, createdAt, lastUsedAt }
                             TTL: 7d (default) / 30d (remember=true)
refresh_family:<familyId>  → SET of refresh IDs (untuk theft detection)
                             TTL: same as longest refresh in family
refreshes:<userId>         → SET of active refresh IDs (untuk multi-device cap)
csrf:<rid>                 → CSRF token string (untuk /auth/refresh endpoint)
                             TTL: same as refresh
permcache:<userId>         → JSON array permissions
                             TTL: 5 menit (lazy refresh)
```

**Removed keys** (cleanup script post-deploy):
- `session:*`, `sessions:*`, `csrf:*` (CSRF lama keyed by sessionId)

### 2.5 High-Level Flow

```
LOGIN                                  AUTHENTICATED REQUEST
─────                                  ─────────────────────
POST /auth/login                       GET /api/app/products
  body: { email, password, remember }    Authorization: Bearer <access>
  ↓                                      ↓
auth.service.login()                   authMiddleware
  ↓ bcrypt.compare (constant-time)       ↓ PASETO decrypt
  ↓                                      ↓ verify exp
generateFamily()                         ↓ NO Redis hit
issueRefresh(userId, role, family)       ↓
issueAccess(userId, role, sid=rid)     c.set("userId", "role", ...)
  ↓                                      ↓
Set-Cookie: refresh=<rid>              roleMiddleware (if used)
                  Path=/api/auth         ↓
                  HttpOnly, Secure       ↓ baca c.get("role")
Set-Cookie: <csrf>=<token>             handler executes
                  Path=/api/auth         ↓
                  not HttpOnly           if needs perms:
return { accessToken, expiresIn: 900 }     await getPermissions(c)  ← Redis hit lazy


REFRESH (every ~15min from FE)         LOGOUT
───────                                 ──────
POST /auth/refresh                     POST /auth/logout
  Cookie: refresh=<old_rid>              Authorization: Bearer <access>
  Header: x-xsrf-header                  Cookie: refresh=<rid>
  ↓                                      ↓
csrfMiddleware                         authMiddleware (verify access)
  ↓ compare csrf:<rid>                   ↓
rotateRefresh(old_rid)                 revokeRefresh(rid)
  ↓ atomic LUA:                          ↓ DEL refresh:<rid>
  ↓   GET refresh:<old_rid>              ↓ SREM refresh_family:<F> <rid>
  ↓   DEL refresh:<old_rid>              ↓ SREM refreshes:<userId> <rid>
  ↓   SET refresh:<new_rid>              ↓ DEL csrf:<rid>
  ↓ if family already rotated past →   clear cookies
  ↓   THEFT DETECTED                   204
  ↓   DEL all in refresh_family:<F>
  ↓ else: continue
Set-Cookie: refresh=<new_rid>          LOGOUT-ALL
return { accessToken, expiresIn: 900 } ──────────
                                       POST /auth/logout-all
                                         ↓ SMEMBERS refreshes:<userId>
                                         ↓ DEL each refresh:<rid>
                                         ↓ DEL refreshes:<userId>
                                         ↓ DEL all refresh_family:<F>
                                       204
```

---

## 3. Endpoint Specifications

### 3.1 Endpoint Map

| Method | Path | Auth | Body | Success Response |
|---|---|---|---|---|
| POST | `/api/auth/register` | ❌ | `{ first_name, last_name?, email, password, confirm_password }` | `201` |
| POST | `/api/auth/login` | ❌ | `{ email, password, remember? }` | `200 { data: { accessToken, expiresIn: 900 } }` + Set-Cookie: refresh + csrf |
| POST | `/api/auth/refresh` | refresh cookie / Bearer | — | `200 { data: { accessToken, expiresIn: 900 } }` + Set-Cookie: rotated refresh + csrf |
| GET | `/api/auth/me` | access | — | `200 { data: { user, role, permissions } }` |
| POST | `/api/auth/logout` | access | — | `204` |
| POST | `/api/auth/logout-all` | access | — | `204` |

**Path changes from existing**:
- `POST /api/auth/` → `POST /api/auth/login`
- `GET /api/auth/` → `GET /api/auth/me`
- `DELETE /api/auth/` → `POST /api/auth/logout`
- `GET /csrf` → **deleted** (CSRF cookie now set inline at login/refresh)

### 3.2 Error Codes

| HTTP | Cause |
|---|---|
| 400 | Validation gagal (Zod) |
| 401 | Invalid/expired access token (FE trigger /refresh) |
| 401 | Invalid/expired/rotated refresh token (FE redirect ke login) |
| 401 | Invalid credentials (login) |
| 403 | CSRF mismatch (hanya di `/auth/refresh`) |
| 403 | Role insufficient |
| 409 | Email sudah terdaftar (register) |
| 429 | Rate limit / `>10 device active` |

### 3.3 Rate Limiting

| Endpoint | Dev | Prod |
|---|---|---|
| `/auth/register`, `/auth/login` | 50 / 5min, blok 1min | 10 / 1min, blok 5min |
| `/auth/refresh` | 100 / 5min | 30 / 1min |
| Global lainnya | 1000 / 5min | 100 / 15min |

### 3.4 Response Shape Convention

Success: `{ success: true, data: <payload> }`
Error: `{ success: false, message: <string>, requestId?: <uuid> }`

---

## 4. Middleware Architecture

### 4.1 Order di `app.ts`

```ts
// REMOVED: app.use("*", sessionMiddleware);  // tidak ada lagi
app.use("*", csrfMiddleware);                  // hanya cek di /auth/refresh
// authMiddleware attach per route group, lihat 4.5
```

### 4.2 `authMiddleware` (rewrite)

- Ambil `Authorization: Bearer <access>` header.
- `decryptPaseto(token)` → verify signature + exp + iat.
- Set context: `userId`, `email`, `role`, `jti`.
- Set lazy getter: `c.set("permissions", () => getPermissionsLazy(userId))`.
- **Zero Redis hit** di hot path.

### 4.3 `csrfMiddleware` (discoped)

```ts
const CSRF_REQUIRED_ROUTES = ["POST:/api/auth/refresh"];
```

Hanya endpoint refresh (yang pakai cookie auth) yang butuh CSRF. Endpoint bisnis lain bebas (mereka pakai Bearer header, tidak ada cookie auto-attach).

### 4.4 `roleMiddleware` — no change

`roleMiddleware([ROLE.ADMIN])` tetap baca dari `c.get("role")`. Karena role di claims, pure-stateless.

### 4.5 Per-Route Attachment

```ts
// module/route.ts
routes.use("/app/*", authMiddleware);          // semua business endpoint
routes.route("/auth", authRoutes);             // auth module attach selective
// /auth/me, /auth/logout, /auth/logout-all → authMiddleware
// /auth/login, /auth/register, /auth/refresh → no authMiddleware
```

### 4.6 Helper Module: `src/lib/auth.helpers.ts`

```ts
getUserId(c): string                    // throws 401 if missing
getRole(c): ROLE
getPermissions(c): Promise<string[]>    // resolves lazy getter
```

Handler pakai helper alih-alih `c.get(...)` langsung.

---

## 5. File Structure Changes

### 5.1 New Files

```
src/lib/paseto.ts                   # encryptPaseto, decryptPaseto wrappers
src/lib/refresh.token.ts            # issueRefresh, rotateRefresh, revokeRefresh,
                                    # revokeFamily, revokeAllForUser, listUserRefreshes
src/lib/permissions.cache.ts        # getPermissionsLazy(userId) — in-memory + Redis
src/lib/auth.helpers.ts             # getUserId, getRole, getPermissions
scripts/migrate-to-paseto-cleanup.ts # one-shot: hapus session:*, sessions:*, csrf:* lama
```

### 5.2 Modified Files

```
src/middleware/auth.ts              # REWRITE: PASETO decrypt
src/middleware/csrf.ts              # MINOR: scope ke /auth/refresh
src/module/auth/auth.routes.ts      # add /refresh, /logout-all, rename paths
src/module/auth/auth.controller.ts  # issue/rotate/revoke via lib/refresh.token.ts
src/module/auth/auth.service.ts     # login() return { userId, email, role }
                                    # add constant-time bcrypt (section 7.5)
src/app.ts                          # remove sessionMiddleware, remove /csrf endpoint
src/config/env.ts                   # add PASETO_LOCAL_KEY, ACCESS_TTL, REFRESH_TTL,
                                    # REFRESH_TTL_REMEMBER; rename SESSION_COOKIE_NAME
                                    # → REFRESH_COOKIE_NAME
src/lib/monitor.ts                  # adapt SessionMetrics → RefreshTokenMetrics
src/tests/setup.ts                  # new auth fixture (withAuth helper)
docs/AUTH.md                        # rewrite for PASETO
docs/modules/auth.md                # endpoint table + flow
docs/postman/erp-mandalika.postman_collection.json  # auth folder rewrite
```

### 5.3 Deleted Files

```
src/middleware/session.ts           # no more anonymous sessionId generation
src/lib/session.management.ts       # sessionCache no longer needed
src/lib/auth.ts                     # setSessionLogin no longer used
```

### 5.4 Dependency Addition

```json
"paseto": "^3.x"   // panva/paseto, mature, v4.local support
```

### 5.5 Env Variables

**Added:**
```ts
PASETO_LOCAL_KEY: str()              // 32-byte hex (64 char) — required
PASETO_LOCAL_KEY_OLD: str({ default: "" })  // for key rotation (optional)
ACCESS_TTL: num({ default: 900 })    // 15 menit
REFRESH_TTL: num({ default: 604800 })           // 7 hari
REFRESH_TTL_REMEMBER: num({ default: 2592000 }) // 30 hari
REFRESH_COOKIE_NAME: str()           // renamed from SESSION_COOKIE_NAME
```

**Removed:**
```ts
SESSION_TTL                          // no longer used
SESSION_COOKIE_NAME                  // renamed
```

**Generate PASETO_LOCAL_KEY:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 6. Migration Plan (Big-Bang)

### 6.1 Cutover Sequence

```
T-1 day:
  - Generate PASETO_LOCAL_KEY, store in prod secret manager.
  - Code review PR + smoke test di staging env.

T-0 (off-hours window):
  Step 1: Announce ke user channel — "re-login required dalam 5 menit".
  Step 2: Deploy new build ke API (refresh + access endpoints live).
  Step 3: Run scripts/migrate-to-paseto-cleanup.ts (hapus session:*, sessions:*, csrf:*).
  Step 4: Deploy FE versi baru (PASETO flow).
  Step 5: Smoke test prod: register → login → /me → refresh → logout → logout-all.
  Step 6: Monitor /health, error rate, refresh-success rate untuk 1 jam.

T+1 hr:
  - Verified stable.
  - Update docs/AUTH.md ke production.

T+1 week:
  - Cleanup dead code (jika belum di main PR).
```

### 6.2 Rollback Strategy

| Trigger | Action |
|---|---|
| Error rate `/auth/login` > 5% selama 15 menit | `git revert` + redeploy commit sebelumnya. User harus login ulang dengan sistem lama. |
| Error rate `/auth/refresh` > 5% selama 15 menit | Same as above. |
| PASETO decrypt failure rate > 1% (indicates token corruption / bug) | Investigate first; rollback if root cause = code. |

Catatan: karena session lama di-cleanup permanent, **rollback berarti semua user login ulang lagi** (acceptable cost untuk internal ERP).

### 6.3 Frontend Coordination

FE harus deploy bersamaan. Changes di FE:
- `POST /api/auth/login` → simpan `accessToken` di state (NOT localStorage).
- Axios interceptor: attach `Authorization: Bearer <access>` ke tiap request.
- Response 401 interceptor: trigger `POST /auth/refresh` (with `credentials: include`) → retry original.
- Single-flight `/refresh` (queue paralel requests selama refresh in-flight).
- Logout: `POST /api/auth/logout`, clear state.
- Remove `/csrf` call (CSRF cookie auto-set saat login/refresh).
- Kirim `x-xsrf-header` HANYA saat call `/auth/refresh`.

Estimasi LOC change FE: ~150–200 LOC di auth service + axios interceptor + auth store.

---

## 7. Security Considerations & Edge Cases

### 7.1 Refresh Token Theft Detection (Family-Based)

- Setiap login spawn satu **family ID** (UUID).
- Tiap rotation: insert new refresh ke `refresh_family:<F>`, delete old refresh dari `refresh:<rid>`.
- Theft signal: refresh `R_old` dipakai padahal sudah ada `R_new` di family yang lebih recent.
- Action: `DEL` semua refresh di family, `DEL refresh_family:<F>`, log `auth.refresh.theft_detected`.
- User di-paksa login ulang.

### 7.2 Race Condition di Rotation

- Skenario: 2 tabs concurrent trigger `/refresh`.
- Mitigation **server-side**: Redis LUA script atomic `GET → DEL → SET`. Tolerate small window (< 5 detik) before flagging theft.
- Mitigation **client-side**: FE single-flight `/refresh` (axios interceptor queue).
- **Both** diimplementasikan (defense in depth).

### 7.3 PASETO Key Rotation

**Dual-key support**: `PASETO_LOCAL_KEY` (current) + `PASETO_LOCAL_KEY_OLD` (optional, previous).
- Encrypt: always with current.
- Decrypt: try current, fallback to old (if exist).
- Rollover process:
  1. Set `PASETO_LOCAL_KEY_OLD = <current>`, set `PASETO_LOCAL_KEY = <new>`.
  2. Deploy. Existing tokens valid via OLD; new tokens use NEW.
  3. Wait 30 menit (> access TTL).
  4. Remove `PASETO_LOCAL_KEY_OLD` from env.
- Refresh tokens unaffected (opaque, not PASETO).
- **Emergency** (key leak): step 2 + run `revoke-all-refreshes` script. Window exposure ≤ 15 menit.

### 7.4 Mobile-Specific (Future)

- **Storage**: iOS Keychain, Android Keystore — NOT plain AsyncStorage.
- **Biometric gating**: optional but recommended for accessing refresh.
- **Transport**: refresh via `Authorization: Bearer <refresh>` (no cookie).
- **App resume**: auto-call `/refresh`; redirect to login if refresh expired.
- **CSRF skip for mobile**: middleware skip CSRF kalau request datang tanpa cookie (Bearer-only).

### 7.5 Timing Attack di Login (fix bundled)

Current `auth.service.login()` punya timing leak (early throw if email tidak ditemukan). Fix:

```ts
const account = await prisma.account.findUnique({ where: { email } });
const dummyHash = "$2b$10$dummyhash...";   // pre-computed
const hashToCompare = account?.password ?? dummyHash;
const ok = await bcrypt.compare(password, hashToCompare);
if (!account || !ok) throw new ApiError(401, "Invalid credentials");
```

Konstan-time, tidak ada email enumeration via timing.

### 7.6 Logout Race (Stateless Trade-off)

- Access token in-flight saat logout dipanggil → request itu **sukses** (stateless, valid until exp).
- Window ≤ 15 menit. Refresh sudah di-DEL, jadi tidak bisa diperpanjang.
- **Accepted trade-off** dari opsi B (stateless access). Documented di `AUTH.md`.

### 7.7 Refresh Cookie Path

`Path=/api/auth` (broader than `/api/auth/refresh`). Rationale:
- `POST /api/auth/logout` butuh akses ke refresh cookie untuk revoke.
- HttpOnly + Secure tetap, jadi attacker tetap tidak bisa baca.
- Trade-off minimal (refresh ikut terkirim ke /auth/me, /auth/login, dst), tapi simplifies UX significantly.

### 7.8 COOKIE_DOMAIN (Prod)

**To be confirmed at implementation time**:
- Same-origin (`mandalika.com/api`) → `COOKIE_DOMAIN` boleh kosong.
- Cross-subdomain (`app.mandalika.com` ↔ `api.mandalika.com`) → `COOKIE_DOMAIN=.mandalika.com` (leading dot).

### 7.9 Multi-Device Cap (MAX_DEVICES = 10)

- Enforced di refresh layer: `SCARD refreshes:<userId>` saat login.
- Kalau ≥ 10 → reject `429`. (Sama seperti sekarang, tapi keyed by `userId` not `email`.)
- Konsistensi: docs lama bilang 5, code bilang 10 → standardkan ke **10** sesuai code.

### 7.10 Observability

Add metrics di `lib/monitor.ts`:
- `auth.login.success` / `auth.login.fail` (counter)
- `auth.refresh.success` / `auth.refresh.fail` / `auth.refresh.theft_detected` (counter)
- `auth.access.decrypt_fail` (counter — anomaly signal)
- `auth.refresh_tokens.active` (gauge)

Expose via `/health` endpoint or Prometheus (if available).

---

## 8. Test Strategy

### 8.1 Existing 27 Pre-Existing Failures

Migrasi PASETO **memperbaiki** ini sekalian:
- Tidak perlu mock Redis session lookup.
- Auth fixture jadi PASETO generation in-memory.

### 8.2 New Auth Fixture (`src/tests/setup.ts`)

```ts
export function makeTestAccessToken(overrides?: Partial<AccessTokenClaims>): string;
export function withAuth(req: Request, role: ROLE = "ADMIN"): Request;
```

Test pattern:
```ts
const res = await app.fetch(withAuth(new Request("/api/app/outlet")));
expect(res.status).toBe(200);
```

### 8.3 New Test Coverage (PASETO-Specific)

1. PASETO encrypt/decrypt round-trip.
2. Expired token → 401.
3. Tampered token → 401.
4. Wrong key → 401.
5. Refresh rotation: R1 → R2; R1 reused → 401 + family revoked.
6. Multi-device cap: 11th login → 429.
7. Logout-all: all refresh revoked.
8. CSRF on `/auth/refresh`: missing/mismatch/correct.
9. Race condition in rotation (concurrent /refresh).
10. Constant-time login (timing parity for invalid email vs invalid password).

### 8.4 Test Migration PR (Separate)

Migrasi ~30–50 test files (replace session boilerplate dengan `withAuth()`) dilakukan di **PR terpisah** (atomic, easier review).

---

## 9. Implementation Phases (Reference, Detailed Plan TBD)

**Phase 1: Foundation**
- `lib/paseto.ts`, `lib/refresh.token.ts`, `lib/permissions.cache.ts`, `lib/auth.helpers.ts`.
- Env additions.
- Unit tests for each lib.

**Phase 2: Middleware Rewrite**
- New `authMiddleware`.
- Discoped `csrfMiddleware`.
- Delete `sessionMiddleware`.
- Unit + integration tests.

**Phase 3: Auth Module**
- `auth.routes.ts`, `auth.controller.ts`, `auth.service.ts` (login, refresh, logout, logout-all, me).
- Integration tests.

**Phase 4: App.ts + Cleanup Script**
- `app.ts` wiring.
- `scripts/migrate-to-paseto-cleanup.ts`.
- E2E smoke test.

**Phase 5: Test Migration PR (separate)**
- Update ~30–50 test files dengan `withAuth()`.
- Fix the pre-existing 27 failures.

**Phase 6: Documentation**
- `docs/AUTH.md`, `docs/modules/auth.md`, Postman collection.

**Phase 7: Cutover**
- Big-bang deploy as section 6.1.

Detailed plan akan dibuat di **separate plan doc** (`docs/superpowers/plans/`) menggunakan `writing-plans` skill.

---

## 10. Out of Scope (Not in This Migration)

- User communication template (announce re-login required).
- SSO / OAuth provider integration.
- Multi-tenant support.
- Microservice split.
- Mobile app implementation (design is forward-compatible).
- Audit log refactor (existing log activity untouched).
- Rate limiter algorithm change.

---

## 11. Open Questions (To Confirm at Implementation Time)

1. **COOKIE_DOMAIN prod**: same-origin atau cross-subdomain? (Section 7.8)
2. **`c.get("user")` blast radius**: berapa banyak handler yang baca full user object dari session lama? Perlu grep audit sebelum delete. (Section 3.5 of brainstorming → diasumsikan rare based on pattern, but verify.)
3. **`SessionMetrics` di `monitor.ts`**: apa saja yang di-track, mapping ke `RefreshTokenMetrics`. (Section 5.2)

---

## 12. References

- [PASETO spec v4](https://github.com/paseto-standard/paseto-spec)
- [panva/paseto library](https://github.com/panva/paseto)
- [OWASP Refresh Token Rotation](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#renew-the-session-id-after-any-privilege-level-change)
- Current implementation: `src/lib/auth.ts`, `src/middleware/auth.ts`, `src/middleware/session.ts`, `src/middleware/csrf.ts`, `src/module/auth/`
- Current docs: `docs/AUTH.md`, `docs/modules/auth.md`
