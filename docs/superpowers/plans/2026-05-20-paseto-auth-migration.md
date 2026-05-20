# PASETO Authentication Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace opaque session + double-submit CSRF auth with PASETO v4.local access token (stateless, 15m) + opaque refresh token (stateful, rotated, 7d/30d in Redis), big-bang cutover on `staging` branch.

**Architecture:** Two-token model. Access token = PASETO v4.local encrypted with single symmetric key, claims: `sub/email/role/jti/iat/exp/sid`. Refresh token = opaque 32-byte hex stored in Redis, rotated on every `/auth/refresh` call, family-tracked for theft detection. Permissions lazy-loaded via in-memory cache + Redis fallback. CSRF kept only on `/auth/refresh` endpoint (only endpoint that uses cookie auth).

**Tech Stack:** Hono, TypeScript, Prisma, Redis (ioredis), Vitest, bcrypt, `paseto` (panva/paseto v3+).

**Spec reference:** `docs/superpowers/specs/2026-05-20-paseto-auth-migration-design.md`

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `src/lib/paseto.ts` | PASETO v4.local encrypt/decrypt wrappers, key rotation support |
| `src/lib/refresh.token.ts` | Refresh token CRUD: issue, rotate (with theft detection), revoke, revokeAllForUser, listUserRefreshes |
| `src/lib/permissions.cache.ts` | Lazy permissions loader: in-memory Map (5min) + Redis (`permcache:<userId>`) |
| `src/lib/auth.helpers.ts` | Typed Context getters: `getUserId(c)`, `getRole(c)`, `getPermissions(c)` |
| `scripts/migrate-to-paseto-cleanup.ts` | One-shot script to delete legacy keys (`session:*`, `sessions:*`, `csrf:*`) |
| `src/tests/lib/paseto.test.ts` | Unit tests for paseto.ts |
| `src/tests/lib/refresh.token.test.ts` | Unit tests for refresh.token.ts |
| `src/tests/lib/permissions.cache.test.ts` | Unit tests for permissions.cache.ts |
| `src/tests/lib/auth.helpers.test.ts` | Unit tests for auth.helpers.ts |

### Modified files

| Path | Change |
|---|---|
| `src/middleware/auth.ts` | Full rewrite: PASETO decrypt instead of Redis session lookup |
| `src/middleware/csrf.ts` | Discope to `/api/auth/refresh` only |
| `src/module/auth/auth.routes.ts` | Add `/refresh`, `/me`, `/logout`, `/logout-all`; rename old paths |
| `src/module/auth/auth.controller.ts` | Rewrite login/logout, add refresh/logout-all/me; remove session logic |
| `src/module/auth/auth.service.ts` | Constant-time bcrypt compare (fix timing attack); simplified login return type |
| `src/module/route.ts` | Attach `authMiddleware` to `/app/*` route group |
| `src/app.ts` | Remove `sessionMiddleware`, remove `/csrf` endpoint |
| `src/config/env.ts` | Add `PASETO_LOCAL_KEY`, `PASETO_LOCAL_KEY_OLD`, `ACCESS_TTL`, `REFRESH_TTL`, `REFRESH_TTL_REMEMBER`; rename `SESSION_COOKIE_NAME` → `REFRESH_COOKIE_NAME`; remove `SESSION_TTL` |
| `src/tests/setup.ts` | Update env mock; add `withAuth()` helper |
| `src/tests/auth/auth.routes.test.ts` | Rewrite for new paths, PASETO flow, refresh, logout-all |
| `src/tests/auth/auth.service.test.ts` | Update for new login return shape, constant-time check |
| `package.json` | Add `paseto` dependency |
| `docs/AUTH.md` | Rewrite for PASETO architecture |
| `docs/modules/auth.md` | Update endpoint table and flow |
| `docs/postman/erp-mandalika.postman_collection.json` | Update auth folder requests |

### Deleted files

| Path | Why |
|---|---|
| `src/middleware/session.ts` | No more anonymous sessionId generation |
| `src/lib/session.management.ts` | Replaced by `lib/refresh.token.ts` + `lib/permissions.cache.ts` |
| `src/lib/auth.ts` | `setSessionLogin` no longer used |

### Environment variables

```
# Added
PASETO_LOCAL_KEY=<64-hex-chars>        # required
PASETO_LOCAL_KEY_OLD=                   # optional (key rotation)
ACCESS_TTL=900                          # 15 min
REFRESH_TTL=604800                      # 7 days
REFRESH_TTL_REMEMBER=2592000            # 30 days
REFRESH_COOKIE_NAME=refresh             # renamed from SESSION_COOKIE_NAME

# Removed
# SESSION_TTL=...
# SESSION_COOKIE_NAME=...  (rename, not delete)
```

Generate `PASETO_LOCAL_KEY`:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Phase 1 — Foundation Libraries

### Task 1: Install PASETO dependency and update env config

**Files:**
- Modify: `package.json`
- Modify: `src/config/env.ts`
- Modify: `src/tests/setup.ts` (env mock block lines 4-44)

- [ ] **Step 1: Install paseto library**

Run:
```bash
npm install paseto@^3
```

Expected: `paseto` appears in `package.json` `dependencies`.

- [ ] **Step 2: Update `src/config/env.ts` — add new vars, rename SESSION_COOKIE_NAME**

Replace the SESSION and CSRF blocks (lines 38-44) and add PASETO block:

```ts
// SESSION (legacy — remove after migration)
// Removed: SESSION_COOKIE_NAME, SESSION_TTL

// REFRESH TOKEN
REFRESH_COOKIE_NAME: str({ default: "refresh" }),
REFRESH_TTL: num({ default: 604800 }),              // 7 days
REFRESH_TTL_REMEMBER: num({ default: 2592000 }),    // 30 days

// ACCESS TOKEN (PASETO)
PASETO_LOCAL_KEY: str({ desc: "32-byte hex (64 char). Generate: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"" }),
PASETO_LOCAL_KEY_OLD: str({ default: "" }),         // for key rotation
ACCESS_TTL: num({ default: 900 }),                  // 15 min

// CSRF (still used for /auth/refresh)
CSRF_COOKIE_NAME: str({}),
CSRF_HEADER_NAME: str({}),
```

- [ ] **Step 3: Update test env mock in `src/tests/setup.ts`**

Replace lines 17-18 (`SESSION_COOKIE_NAME: "session"` and `SESSION_TTL: 3600`) with:

```ts
REFRESH_COOKIE_NAME: "refresh",
REFRESH_TTL: 604800,
REFRESH_TTL_REMEMBER: 2592000,
PASETO_LOCAL_KEY: "0000000000000000000000000000000000000000000000000000000000000000",
PASETO_LOCAL_KEY_OLD: "",
ACCESS_TTL: 900,
```

- [ ] **Step 4: Generate dev `PASETO_LOCAL_KEY` and add to `.env`**

Run:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy output. Append to `.env` and `.env.test`:
```
PASETO_LOCAL_KEY=<paste>
REFRESH_COOKIE_NAME=refresh
```

(Note: prod key goes to secret manager, separate from this PR.)

- [ ] **Step 5: Verify env loads — run typecheck**

Run:
```bash
rtk tsc --noEmit
```

Expected: PASS. If env errors reference still-existing `env.SESSION_COOKIE_NAME` or `env.SESSION_TTL` references in code, **do not fix yet** — those will be removed in later tasks. For this task, env file itself should typecheck.

If there ARE such references, they'll be fixed in Tasks 7-13. Note them but proceed.

- [ ] **Step 6: Commit**

```bash
rtk git add package.json package-lock.json src/config/env.ts src/tests/setup.ts .env .env.test
rtk git commit -m "feat(auth): add paseto dependency and env vars for PASETO migration"
```

---

### Task 2: Create `src/lib/paseto.ts`

**Files:**
- Create: `src/lib/paseto.ts`
- Create: `src/tests/lib/paseto.test.ts`

- [ ] **Step 1: Write failing test `src/tests/lib/paseto.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import "../setup.js"; // load env mock
import { encryptAccessToken, decryptAccessToken, AccessTokenClaims } from "../../lib/paseto.js";

describe("paseto", () => {
    const baseClaims: Omit<AccessTokenClaims, "iat" | "exp" | "jti"> = {
        sub: "user-uuid-1",
        email: "test@example.com",
        role: "ADMIN",
        sid: "refresh-uuid-1",
    };

    it("round-trips claims via encrypt → decrypt", async () => {
        const token = await encryptAccessToken(baseClaims);
        const claims = await decryptAccessToken(token);

        expect(claims.sub).toBe(baseClaims.sub);
        expect(claims.email).toBe(baseClaims.email);
        expect(claims.role).toBe(baseClaims.role);
        expect(claims.sid).toBe(baseClaims.sid);
        expect(typeof claims.jti).toBe("string");
        expect(claims.iat).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
        expect(claims.exp).toBeGreaterThan(claims.iat);
    });

    it("rejects token signed with wrong key", async () => {
        const token = await encryptAccessToken(baseClaims);

        // Re-mock env with a different key
        vi.doMock("../../config/env.js", () => ({
            env: {
                PASETO_LOCAL_KEY: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
                PASETO_LOCAL_KEY_OLD: "",
                ACCESS_TTL: 900,
            },
        }));
        vi.resetModules();
        const { decryptAccessToken: decryptWithWrongKey } = await import("../../lib/paseto.js");

        await expect(decryptWithWrongKey(token)).rejects.toThrow();

        vi.doUnmock("../../config/env.js");
        vi.resetModules();
    });

    it("rejects expired token", async () => {
        vi.doMock("../../config/env.js", () => ({
            env: {
                PASETO_LOCAL_KEY: "0000000000000000000000000000000000000000000000000000000000000000",
                PASETO_LOCAL_KEY_OLD: "",
                ACCESS_TTL: -1, // already expired
            },
        }));
        vi.resetModules();
        const paseto = await import("../../lib/paseto.js");

        const token = await paseto.encryptAccessToken(baseClaims);
        await expect(paseto.decryptAccessToken(token)).rejects.toThrow();

        vi.doUnmock("../../config/env.js");
        vi.resetModules();
    });

    it("rejects malformed token", async () => {
        await expect(decryptAccessToken("not.a.paseto.token")).rejects.toThrow();
        await expect(decryptAccessToken("")).rejects.toThrow();
    });

    it("falls back to OLD key when decrypting tokens signed with old key", async () => {
        // Issue token with OLD key
        vi.doMock("../../config/env.js", () => ({
            env: {
                PASETO_LOCAL_KEY: "1111111111111111111111111111111111111111111111111111111111111111",
                PASETO_LOCAL_KEY_OLD: "",
                ACCESS_TTL: 900,
            },
        }));
        vi.resetModules();
        const { encryptAccessToken: encWithOld } = await import("../../lib/paseto.js");
        const token = await encWithOld(baseClaims);

        // Decrypt with NEW key + OLD as fallback
        vi.doMock("../../config/env.js", () => ({
            env: {
                PASETO_LOCAL_KEY: "2222222222222222222222222222222222222222222222222222222222222222",
                PASETO_LOCAL_KEY_OLD: "1111111111111111111111111111111111111111111111111111111111111111",
                ACCESS_TTL: 900,
            },
        }));
        vi.resetModules();
        const { decryptAccessToken: decWithBoth } = await import("../../lib/paseto.js");

        const claims = await decWithBoth(token);
        expect(claims.sub).toBe(baseClaims.sub);

        vi.doUnmock("../../config/env.js");
        vi.resetModules();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx vitest run src/tests/lib/paseto.test.ts
```

Expected: FAIL with module-not-found error for `../../lib/paseto.js`.

- [ ] **Step 3: Implement `src/lib/paseto.ts`**

```ts
import { V4 } from "paseto";
import { v4 as uuid } from "uuid";
import { env } from "../config/env.js";
import { ROLE } from "../generated/prisma/client.js";

export type AccessTokenClaims = {
    sub: string;        // userId
    email: string;
    role: ROLE;
    jti: string;        // unique token id
    iat: number;        // issued at (unix seconds)
    exp: number;        // expiry (unix seconds)
    sid: string;        // refresh session id (links access ↔ refresh family)
};

type ClaimsInput = Omit<AccessTokenClaims, "iat" | "exp" | "jti">;

function hexToKey(hex: string): Buffer {
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
        throw new Error("PASETO key must be 64 hex characters (32 bytes)");
    }
    return Buffer.from(hex, "hex");
}

function getCurrentKey(): Buffer {
    return hexToKey(env.PASETO_LOCAL_KEY);
}

function getOldKey(): Buffer | null {
    if (!env.PASETO_LOCAL_KEY_OLD) return null;
    return hexToKey(env.PASETO_LOCAL_KEY_OLD);
}

export async function encryptAccessToken(input: ClaimsInput): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const claims: AccessTokenClaims = {
        ...input,
        jti: uuid(),
        iat: now,
        exp: now + env.ACCESS_TTL,
    };
    return V4.encrypt(claims, getCurrentKey());
}

export async function decryptAccessToken(token: string): Promise<AccessTokenClaims> {
    try {
        return (await V4.decrypt(token, getCurrentKey())) as AccessTokenClaims;
    } catch (errCurrent) {
        const oldKey = getOldKey();
        if (!oldKey) throw errCurrent;
        return (await V4.decrypt(token, oldKey)) as AccessTokenClaims;
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npx vitest run src/tests/lib/paseto.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add src/lib/paseto.ts src/tests/lib/paseto.test.ts
rtk git commit -m "feat(auth): add PASETO v4.local wrapper with key rotation support"
```

---

### Task 3: Create `src/lib/refresh.token.ts`

**Files:**
- Create: `src/lib/refresh.token.ts`
- Create: `src/tests/lib/refresh.token.test.ts`

- [ ] **Step 1: Write failing test `src/tests/lib/refresh.token.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../setup.js";
import {
    issueRefreshToken,
    rotateRefreshToken,
    revokeRefreshToken,
    revokeAllForUser,
    getRefreshTokenMeta,
    RefreshTokenMeta,
} from "../../lib/refresh.token.js";
import { redisClient } from "../../config/redis.js";

describe("refresh.token", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("issueRefreshToken", () => {
        it("creates refresh:<rid> + adds to refreshes:<userId> + refresh_family:<F>", async () => {
            const result = await issueRefreshToken({
                userId: "user-1",
                email: "test@example.com",
                role: "ADMIN",
                ip: "127.0.0.1",
                userAgent: "test-agent",
                remember: false,
            });

            expect(result.rid).toMatch(/^[0-9a-f]{64}$/);
            expect(result.familyId).toBeTruthy();

            // @ts-ignore
            expect(redisClient.set).toHaveBeenCalledWith(
                `refresh:${result.rid}`,
                expect.any(String),
                "EX",
                604800
            );
            // @ts-ignore
            expect(redisClient.sadd).toHaveBeenCalledWith(`refreshes:user-1`, result.rid);
            // @ts-ignore
            expect(redisClient.sadd).toHaveBeenCalledWith(`refresh_family:${result.familyId}`, result.rid);
        });

        it("uses REFRESH_TTL_REMEMBER when remember=true", async () => {
            await issueRefreshToken({
                userId: "user-1",
                email: "test@example.com",
                role: "ADMIN",
                ip: "127.0.0.1",
                userAgent: "agent",
                remember: true,
            });
            // @ts-ignore
            expect(redisClient.set).toHaveBeenCalledWith(
                expect.any(String),
                expect.any(String),
                "EX",
                2592000
            );
        });
    });

    describe("rotateRefreshToken", () => {
        it("returns new rid, deletes old refresh, adds to family", async () => {
            const meta: RefreshTokenMeta = {
                userId: "user-1",
                email: "test@example.com",
                role: "ADMIN",
                familyId: "family-1",
                ip: "127.0.0.1",
                userAgent: "agent",
                remember: false,
                createdAt: Date.now(),
                lastUsedAt: Date.now(),
            };
            // @ts-ignore
            redisClient.get.mockResolvedValue(JSON.stringify(meta));
            // @ts-ignore
            redisClient.sismember.mockResolvedValue(1);

            const result = await rotateRefreshToken("old-rid");

            expect(result.newRid).toMatch(/^[0-9a-f]{64}$/);
            // @ts-ignore
            expect(redisClient.del).toHaveBeenCalledWith("refresh:old-rid");
            // @ts-ignore
            expect(redisClient.set).toHaveBeenCalledWith(
                `refresh:${result.newRid}`,
                expect.any(String),
                "EX",
                expect.any(Number)
            );
            // @ts-ignore
            expect(redisClient.sadd).toHaveBeenCalledWith("refresh_family:family-1", result.newRid);
            // @ts-ignore
            expect(redisClient.srem).toHaveBeenCalledWith("refresh_family:family-1", "old-rid");
        });

        it("throws and revokes family when refresh not found but family member tracked (theft detection)", async () => {
            // @ts-ignore
            redisClient.get.mockResolvedValue(null);
            // Family lookup via stored mapping
            // @ts-ignore
            redisClient.smembers.mockResolvedValue(["other-rid"]);
            // Implementation should detect theft via separate `refresh_rid_family:<rid>` lookup

            await expect(rotateRefreshToken("stolen-old-rid")).rejects.toThrow(
                /invalid|theft|expired/i
            );
        });

        it("throws when refresh meta is corrupt JSON", async () => {
            // @ts-ignore
            redisClient.get.mockResolvedValue("{not-json");
            await expect(rotateRefreshToken("rid-x")).rejects.toThrow();
        });
    });

    describe("revokeRefreshToken", () => {
        it("deletes refresh:<rid>, srem from family and user set", async () => {
            const meta: RefreshTokenMeta = {
                userId: "user-1",
                email: "test@example.com",
                role: "ADMIN",
                familyId: "family-1",
                ip: "127.0.0.1",
                userAgent: "agent",
                remember: false,
                createdAt: Date.now(),
                lastUsedAt: Date.now(),
            };
            // @ts-ignore
            redisClient.get.mockResolvedValue(JSON.stringify(meta));

            await revokeRefreshToken("rid-x");

            // @ts-ignore
            expect(redisClient.del).toHaveBeenCalledWith("refresh:rid-x");
            // @ts-ignore
            expect(redisClient.srem).toHaveBeenCalledWith("refreshes:user-1", "rid-x");
            // @ts-ignore
            expect(redisClient.srem).toHaveBeenCalledWith("refresh_family:family-1", "rid-x");
        });

        it("is no-op when refresh already missing", async () => {
            // @ts-ignore
            redisClient.get.mockResolvedValue(null);
            await expect(revokeRefreshToken("missing")).resolves.toBeUndefined();
        });
    });

    describe("revokeAllForUser", () => {
        it("revokes every refresh in refreshes:<userId>", async () => {
            // @ts-ignore
            redisClient.smembers.mockResolvedValue(["r1", "r2", "r3"]);

            const meta: RefreshTokenMeta = {
                userId: "user-1",
                email: "x",
                role: "ADMIN",
                familyId: "family-1",
                ip: "",
                userAgent: "",
                remember: false,
                createdAt: 0,
                lastUsedAt: 0,
            };
            // @ts-ignore
            redisClient.get.mockResolvedValue(JSON.stringify(meta));

            await revokeAllForUser("user-1");

            // @ts-ignore
            expect(redisClient.del).toHaveBeenCalledWith("refresh:r1");
            // @ts-ignore
            expect(redisClient.del).toHaveBeenCalledWith("refresh:r2");
            // @ts-ignore
            expect(redisClient.del).toHaveBeenCalledWith("refresh:r3");
            // @ts-ignore
            expect(redisClient.del).toHaveBeenCalledWith("refreshes:user-1");
        });
    });

    describe("getRefreshTokenMeta", () => {
        it("returns parsed JSON when refresh exists", async () => {
            const meta: RefreshTokenMeta = {
                userId: "user-1",
                email: "test@example.com",
                role: "ADMIN",
                familyId: "family-1",
                ip: "127.0.0.1",
                userAgent: "agent",
                remember: false,
                createdAt: Date.now(),
                lastUsedAt: Date.now(),
            };
            // @ts-ignore
            redisClient.get.mockResolvedValue(JSON.stringify(meta));

            const result = await getRefreshTokenMeta("rid-x");
            expect(result?.userId).toBe("user-1");
            expect(result?.role).toBe("ADMIN");
        });

        it("returns null when refresh missing", async () => {
            // @ts-ignore
            redisClient.get.mockResolvedValue(null);
            expect(await getRefreshTokenMeta("missing")).toBeNull();
        });

        it("returns null when JSON corrupt", async () => {
            // @ts-ignore
            redisClient.get.mockResolvedValue("{not-json");
            expect(await getRefreshTokenMeta("corrupt")).toBeNull();
        });
    });
});
```

- [ ] **Step 2: Add `sismember`, `sadd`, `srem`, `smembers` to Redis mock in `src/tests/setup.ts`**

In the mockRedis block (around line 1117), add to the returned object:
```ts
sadd: vi.fn().mockResolvedValue(1),
srem: vi.fn().mockResolvedValue(1),
smembers: vi.fn().mockResolvedValue([]),
sismember: vi.fn().mockResolvedValue(0),
scard: vi.fn().mockResolvedValue(0),
```

- [ ] **Step 3: Run test to verify it fails**

Run:
```bash
npx vitest run src/tests/lib/refresh.token.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 4: Implement `src/lib/refresh.token.ts`**

```ts
import * as crypto from "crypto";
import { v4 as uuid } from "uuid";
import { env } from "../config/env.js";
import { redisClient } from "../config/redis.js";
import { ROLE } from "../generated/prisma/client.js";
import { ApiError } from "./errors/api.error.js";
import { logger } from "./logger.js";

export type RefreshTokenMeta = {
    userId: string;
    email: string;
    role: ROLE;
    familyId: string;
    ip: string;
    userAgent: string;
    remember: boolean;
    createdAt: number;
    lastUsedAt: number;
};

type IssueInput = {
    userId: string;
    email: string;
    role: ROLE;
    ip: string;
    userAgent: string;
    remember: boolean;
    familyId?: string;  // if continuing existing family (rotation)
};

function generateRid(): string {
    return crypto.randomBytes(32).toString("hex");
}

function ttlFor(remember: boolean): number {
    return remember ? env.REFRESH_TTL_REMEMBER : env.REFRESH_TTL;
}

export async function issueRefreshToken(input: IssueInput): Promise<{ rid: string; familyId: string; ttl: number }> {
    const rid = generateRid();
    const familyId = input.familyId ?? uuid();
    const now = Date.now();
    const ttl = ttlFor(input.remember);

    const meta: RefreshTokenMeta = {
        userId: input.userId,
        email: input.email,
        role: input.role,
        familyId,
        ip: input.ip,
        userAgent: input.userAgent,
        remember: input.remember,
        createdAt: now,
        lastUsedAt: now,
    };

    await redisClient.set(`refresh:${rid}`, JSON.stringify(meta), "EX", ttl);
    await redisClient.sadd(`refreshes:${input.userId}`, rid);
    await redisClient.expire(`refreshes:${input.userId}`, ttl);
    await redisClient.sadd(`refresh_family:${familyId}`, rid);
    await redisClient.expire(`refresh_family:${familyId}`, ttl);

    // Reverse-lookup index for theft detection
    await redisClient.set(`refresh_family_member:${rid}`, familyId, "EX", ttl);

    return { rid, familyId, ttl };
}

export async function getRefreshTokenMeta(rid: string): Promise<RefreshTokenMeta | null> {
    const raw = await redisClient.get(`refresh:${rid}`);
    if (!raw) return null;
    try {
        return JSON.parse(raw) as RefreshTokenMeta;
    } catch {
        logger.error("refresh token meta corrupt JSON", { rid });
        return null;
    }
}

export async function rotateRefreshToken(oldRid: string): Promise<{ newRid: string; meta: RefreshTokenMeta; ttl: number }> {
    const meta = await getRefreshTokenMeta(oldRid);

    if (!meta) {
        // Theft detection: refresh missing, but was it part of a known family?
        const familyId = await redisClient.get(`refresh_family_member:${oldRid}`);
        if (familyId) {
            // Old rid was rotated/used before and is being reused → THEFT
            logger.warn("refresh token theft detected", { oldRid, familyId });
            await revokeFamily(familyId);
            throw new ApiError(401, "Refresh token reuse detected, all sessions in this family revoked");
        }
        throw new ApiError(401, "Invalid or expired refresh token");
    }

    // Rotate: delete old, issue new in same family
    await redisClient.del(`refresh:${oldRid}`);
    await redisClient.srem(`refresh_family:${meta.familyId}`, oldRid);
    await redisClient.srem(`refreshes:${meta.userId}`, oldRid);
    // KEEP refresh_family_member:<oldRid> for window of theft detection — it expires naturally with TTL

    const issued = await issueRefreshToken({
        userId: meta.userId,
        email: meta.email,
        role: meta.role,
        ip: meta.ip,
        userAgent: meta.userAgent,
        remember: meta.remember,
        familyId: meta.familyId,
    });

    return { newRid: issued.rid, meta, ttl: issued.ttl };
}

export async function revokeRefreshToken(rid: string): Promise<void> {
    const meta = await getRefreshTokenMeta(rid);
    await redisClient.del(`refresh:${rid}`);
    await redisClient.del(`refresh_family_member:${rid}`);
    if (meta) {
        await redisClient.srem(`refreshes:${meta.userId}`, rid);
        await redisClient.srem(`refresh_family:${meta.familyId}`, rid);
    }
}

export async function revokeFamily(familyId: string): Promise<void> {
    const rids = await redisClient.smembers(`refresh_family:${familyId}`);
    for (const rid of rids) {
        const meta = await getRefreshTokenMeta(rid);
        await redisClient.del(`refresh:${rid}`);
        await redisClient.del(`refresh_family_member:${rid}`);
        if (meta) {
            await redisClient.srem(`refreshes:${meta.userId}`, rid);
        }
    }
    await redisClient.del(`refresh_family:${familyId}`);
}

export async function revokeAllForUser(userId: string): Promise<void> {
    const rids = await redisClient.smembers(`refreshes:${userId}`);
    for (const rid of rids) {
        const meta = await getRefreshTokenMeta(rid);
        await redisClient.del(`refresh:${rid}`);
        await redisClient.del(`refresh_family_member:${rid}`);
        if (meta) {
            await redisClient.del(`refresh_family:${meta.familyId}`);
        }
    }
    await redisClient.del(`refreshes:${userId}`);
}

export async function countUserRefreshes(userId: string): Promise<number> {
    return await redisClient.scard(`refreshes:${userId}`);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:
```bash
npx vitest run src/tests/lib/refresh.token.test.ts
```

Expected: all tests PASS. If theft-detection test fails because mock returns `null` for `redisClient.get(refresh_family_member:...)`, adjust the test's mock to return a family-id string before the rotate call:
```ts
// @ts-ignore
redisClient.get
    .mockResolvedValueOnce(null)        // refresh:stolen-old-rid → not found
    .mockResolvedValueOnce("family-1"); // refresh_family_member:stolen-old-rid → present
```

Then re-run. Should PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add src/lib/refresh.token.ts src/tests/lib/refresh.token.test.ts src/tests/setup.ts
rtk git commit -m "feat(auth): add refresh token lib with rotation and theft detection"
```

---

### Task 4: Create `src/lib/permissions.cache.ts`

**Files:**
- Create: `src/lib/permissions.cache.ts`
- Create: `src/tests/lib/permissions.cache.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../setup.js";
import { getPermissionsForUser, clearPermissionCache } from "../../lib/permissions.cache.js";
import { redisClient } from "../../config/redis.js";
import prisma from "../../config/prisma.js";

describe("permissions.cache", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearPermissionCache();
    });

    it("returns cached permissions on second call (within TTL)", async () => {
        // @ts-ignore
        redisClient.get.mockResolvedValueOnce(JSON.stringify(["perm.a", "perm.b"]));

        const r1 = await getPermissionsForUser("user-1");
        const r2 = await getPermissionsForUser("user-1");

        expect(r1).toEqual(["perm.a", "perm.b"]);
        expect(r2).toEqual(["perm.a", "perm.b"]);
        // @ts-ignore — Redis hit only once (second call from in-memory cache)
        expect(redisClient.get).toHaveBeenCalledTimes(1);
    });

    it("falls back to DB when neither in-memory nor Redis cache has data", async () => {
        // @ts-ignore
        redisClient.get.mockResolvedValueOnce(null);
        // @ts-ignore
        prisma.account.findUnique = vi.fn().mockResolvedValueOnce({
            user: { employee: { permissions: [{ name: "perm.x" }, { name: "perm.y" }] } },
        });

        const result = await getPermissionsForUser("user-1");
        expect(result).toEqual(["perm.x", "perm.y"]);

        // @ts-ignore — populated Redis cache
        expect(redisClient.set).toHaveBeenCalledWith(
            "permcache:user-1",
            JSON.stringify(["perm.x", "perm.y"]),
            "EX",
            300
        );
    });

    it("returns [] when user has no employee/permissions", async () => {
        // @ts-ignore
        redisClient.get.mockResolvedValueOnce(null);
        // @ts-ignore
        prisma.account.findUnique = vi.fn().mockResolvedValueOnce({ user: null });

        const result = await getPermissionsForUser("user-1");
        expect(result).toEqual([]);
    });

    it("clearPermissionCache evicts in-memory entry", async () => {
        // @ts-ignore
        redisClient.get.mockResolvedValueOnce(JSON.stringify(["perm.a"]));
        await getPermissionsForUser("user-1");

        clearPermissionCache("user-1");
        // @ts-ignore
        redisClient.get.mockResolvedValueOnce(JSON.stringify(["perm.b"]));
        const result = await getPermissionsForUser("user-1");
        expect(result).toEqual(["perm.b"]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx vitest run src/tests/lib/permissions.cache.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/permissions.cache.ts`**

```ts
import prisma from "../config/prisma.js";
import { redisClient } from "../config/redis.js";
import { logger } from "./logger.js";

const MEMORY_TTL_MS = 5 * 60 * 1000;       // 5 minutes
const REDIS_TTL_SECONDS = 5 * 60;          // 5 minutes

type MemoryEntry = { perms: string[]; expiry: number };
const memCache = new Map<string, MemoryEntry>();

export async function getPermissionsForUser(userId: string): Promise<string[]> {
    const now = Date.now();
    const cached = memCache.get(userId);
    if (cached && cached.expiry > now) {
        return cached.perms;
    }

    // Try Redis
    try {
        const raw = await redisClient.get(`permcache:${userId}`);
        if (raw) {
            const perms = JSON.parse(raw) as string[];
            memCache.set(userId, { perms, expiry: now + MEMORY_TTL_MS });
            return perms;
        }
    } catch (err) {
        logger.error("permcache redis read failed", { userId, error: (err as Error).message });
    }

    // Fallback to DB
    const perms = await loadPermissionsFromDB(userId);

    // Populate caches
    try {
        await redisClient.set(`permcache:${userId}`, JSON.stringify(perms), "EX", REDIS_TTL_SECONDS);
    } catch (err) {
        logger.error("permcache redis write failed", { userId, error: (err as Error).message });
    }
    memCache.set(userId, { perms, expiry: now + MEMORY_TTL_MS });

    return perms;
}

async function loadPermissionsFromDB(userId: string): Promise<string[]> {
    const account = await prisma.account.findUnique({
        where: { id: userId },
        select: {
            user: {
                select: {
                    employee: {
                        select: {
                            permissions: { select: { name: true } },
                        },
                    },
                },
            },
        },
    });
    const perms = account?.user?.employee?.permissions?.map((p) => p.name) ?? [];
    return perms;
}

export function clearPermissionCache(userId?: string): void {
    if (userId) {
        memCache.delete(userId);
        redisClient.del(`permcache:${userId}`).catch(() => {});
    } else {
        memCache.clear();
    }
}

// Periodic cleanup of expired in-memory entries
setInterval(() => {
    const now = Date.now();
    memCache.forEach((value, key) => {
        if (value.expiry <= now) memCache.delete(key);
    });
}, 60_000);
```

- [ ] **Step 4: Run test**

Run:
```bash
npx vitest run src/tests/lib/permissions.cache.test.ts
```

Expected: 4 tests PASS. If the DB fallback test fails because the prisma mock in `setup.ts` doesn't include `account.findUnique` returning the nested employee shape, the test's `prisma.account.findUnique = vi.fn()...` override handles it. Should PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add src/lib/permissions.cache.ts src/tests/lib/permissions.cache.test.ts
rtk git commit -m "feat(auth): add lazy permissions cache (memory + redis + DB fallback)"
```

---

### Task 5: Create `src/lib/auth.helpers.ts`

**Files:**
- Create: `src/lib/auth.helpers.ts`
- Create: `src/tests/lib/auth.helpers.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import "../setup.js";
import { Hono } from "hono";
import { getUserId, getRole, getPermissions } from "../../lib/auth.helpers.js";

describe("auth.helpers", () => {
    it("getUserId returns userId from context", async () => {
        const app = new Hono();
        app.get("/x", (c) => {
            c.set("userId", "user-1");
            return c.json({ id: getUserId(c) });
        });
        const res = await app.request("/x");
        expect(await res.json()).toEqual({ id: "user-1" });
    });

    it("getUserId throws 401 when missing", async () => {
        const app = new Hono();
        app.onError((err, c) => c.json({ error: (err as Error).message }, 401));
        app.get("/x", (c) => c.json({ id: getUserId(c) }));
        const res = await app.request("/x");
        expect(res.status).toBe(401);
    });

    it("getRole returns role from context", async () => {
        const app = new Hono();
        app.get("/x", (c) => {
            c.set("role", "ADMIN");
            return c.json({ role: getRole(c) });
        });
        const res = await app.request("/x");
        expect(await res.json()).toEqual({ role: "ADMIN" });
    });

    it("getPermissions resolves the lazy getter from context", async () => {
        const app = new Hono();
        app.get("/x", async (c) => {
            c.set("permissions", async () => ["perm.a", "perm.b"]);
            const perms = await getPermissions(c);
            return c.json({ perms });
        });
        const res = await app.request("/x");
        expect(await res.json()).toEqual({ perms: ["perm.a", "perm.b"] });
    });

    it("getPermissions returns [] when context has no permissions getter", async () => {
        const app = new Hono();
        app.get("/x", async (c) => {
            const perms = await getPermissions(c);
            return c.json({ perms });
        });
        const res = await app.request("/x");
        expect(await res.json()).toEqual({ perms: [] });
    });
});
```

- [ ] **Step 2: Run test (should fail)**

Run:
```bash
npx vitest run src/tests/lib/auth.helpers.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/auth.helpers.ts`**

```ts
import type { Context } from "hono";
import { ROLE } from "../generated/prisma/client.js";
import { ApiError } from "./errors/api.error.js";

export function getUserId(c: Context): string {
    const id = c.get("userId") as string | undefined;
    if (!id) throw new ApiError(401, "Unauthorized");
    return id;
}

export function getEmail(c: Context): string {
    const e = c.get("email") as string | undefined;
    if (!e) throw new ApiError(401, "Unauthorized");
    return e;
}

export function getRole(c: Context): ROLE {
    return c.get("role") as ROLE;
}

export async function getPermissions(c: Context): Promise<string[]> {
    const getter = c.get("permissions") as (() => Promise<string[]>) | undefined;
    if (!getter) return [];
    return await getter();
}

export function getJti(c: Context): string | undefined {
    return c.get("jti") as string | undefined;
}
```

- [ ] **Step 4: Run test**

Run:
```bash
npx vitest run src/tests/lib/auth.helpers.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add src/lib/auth.helpers.ts src/tests/lib/auth.helpers.test.ts
rtk git commit -m "feat(auth): add typed auth context helpers"
```

---

## Phase 2 — Middleware

### Task 6: Rewrite `src/middleware/auth.ts`

**Files:**
- Modify: `src/middleware/auth.ts`
- Modify: `src/tests/auth/auth.routes.test.ts` (only existing test referencing authMiddleware behavior is impacted — full rewrite later in Task 14)

- [ ] **Step 1: Write integration-style test**

Create new file `src/tests/middleware/auth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../setup.js";
import { Hono } from "hono";
import { authMiddleware, roleMiddleware } from "../../middleware/auth.js";
import { encryptAccessToken } from "../../lib/paseto.js";
import { ApiError } from "../../lib/errors/api.error.js";

function makeApp() {
    const app = new Hono();
    app.onError((err, c) => {
        if (err instanceof ApiError) return c.json({ message: err.message }, err.statusCode);
        return c.json({ message: (err as Error).message }, 500);
    });
    app.use("/protected/*", authMiddleware);
    app.get("/protected/me", (c) =>
        c.json({
            userId: c.get("userId"),
            email: c.get("email"),
            role: c.get("role"),
            jti: c.get("jti"),
        })
    );
    app.get("/protected/admin", roleMiddleware(["ADMIN"]), (c) => c.json({ ok: true }));
    return app;
}

describe("authMiddleware", () => {
    beforeEach(() => vi.clearAllMocks());

    it("returns 401 when no Authorization header", async () => {
        const res = await makeApp().request("/protected/me");
        expect(res.status).toBe(401);
    });

    it("sets context from valid PASETO access token", async () => {
        const token = await encryptAccessToken({
            sub: "user-1",
            email: "u@example.com",
            role: "ADMIN",
            sid: "refresh-1",
        });
        const res = await makeApp().request("/protected/me", {
            headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json();
        expect(res.status).toBe(200);
        expect(body.userId).toBe("user-1");
        expect(body.email).toBe("u@example.com");
        expect(body.role).toBe("ADMIN");
        expect(typeof body.jti).toBe("string");
    });

    it("returns 401 for malformed token", async () => {
        const res = await makeApp().request("/protected/me", {
            headers: { Authorization: "Bearer not-a-token" },
        });
        expect(res.status).toBe(401);
    });

    it("roleMiddleware allows when role matches", async () => {
        const token = await encryptAccessToken({
            sub: "user-1",
            email: "u@example.com",
            role: "ADMIN",
            sid: "refresh-1",
        });
        const res = await makeApp().request("/protected/admin", {
            headers: { Authorization: `Bearer ${token}` },
        });
        expect(res.status).toBe(200);
    });

    it("roleMiddleware returns 403 when role mismatch", async () => {
        const token = await encryptAccessToken({
            sub: "user-1",
            email: "u@example.com",
            role: "STAFF",
            sid: "refresh-1",
        });
        const res = await makeApp().request("/protected/admin", {
            headers: { Authorization: `Bearer ${token}` },
        });
        expect(res.status).toBe(403);
    });
});
```

- [ ] **Step 2: Run test (should fail — current authMiddleware uses session lookup, doesn't decode PASETO)**

Run:
```bash
npx vitest run src/tests/middleware/auth.test.ts
```

Expected: FAIL — current code reads from Redis session, doesn't recognize PASETO.

- [ ] **Step 3: Rewrite `src/middleware/auth.ts`**

Replace the entire file with:

```ts
import type { Context, Next } from "hono";
import { ApiError } from "../lib/errors/api.error.js";
import { decryptAccessToken } from "../lib/paseto.js";
import { getPermissionsForUser } from "../lib/permissions.cache.js";
import { logger } from "../lib/logger.js";
import { ROLE } from "../generated/prisma/client.js";

export const authMiddleware = async (c: Context, next: Next) => {
    try {
        const bearer = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");
        if (!bearer) throw new ApiError(401, "Unauthorized");

        const claims = await decryptAccessToken(bearer);

        c.set("userId", claims.sub);
        c.set("email", claims.email);
        c.set("role", claims.role);
        c.set("jti", claims.jti);
        c.set("sid", claims.sid);

        // Lazy permissions: only fetched when handler calls getPermissions(c)
        c.set("permissions", () => getPermissionsForUser(claims.sub));

        await next();
    } catch (err) {
        if (err instanceof ApiError) {
            return c.json({ success: false, message: err.message }, err.statusCode);
        }
        logger.warn("authMiddleware: token verification failed", { error: (err as Error).message });
        return c.json({ success: false, message: "Unauthorized" }, 401);
    }
};

export const roleMiddleware = (allowedRoles?: ROLE[]) => {
    return async (c: Context, next: Next) => {
        const userRole = c.get("role") as ROLE | undefined;
        if (!userRole) throw new ApiError(401, "Unauthorized");

        if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(userRole)) {
            throw new ApiError(403, "Forbidden: insufficient role");
        }

        await next();
    };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npx vitest run src/tests/middleware/auth.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add src/middleware/auth.ts src/tests/middleware/auth.test.ts
rtk git commit -m "feat(auth): rewrite authMiddleware for stateless PASETO verification"
```

---

### Task 7: Discope `src/middleware/csrf.ts`

**Files:**
- Modify: `src/middleware/csrf.ts`
- Create: `src/tests/middleware/csrf.test.ts`

- [ ] **Step 1: Write test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../setup.js";
import { Hono } from "hono";
import { csrfMiddleware } from "../../middleware/csrf.js";
import { ApiError } from "../../lib/errors/api.error.js";
import { redisClient } from "../../config/redis.js";

function makeApp() {
    const app = new Hono();
    app.onError((err, c) => {
        if (err instanceof ApiError) return c.json({ message: err.message }, err.statusCode);
        return c.json({ message: (err as Error).message }, 500);
    });
    app.use("*", csrfMiddleware);
    app.post("/api/auth/refresh", (c) => c.json({ ok: true }));
    app.post("/api/app/products", (c) => c.json({ ok: true }));
    app.get("/api/auth/me", (c) => c.json({ ok: true }));
    return app;
}

describe("csrfMiddleware (discoped)", () => {
    beforeEach(() => vi.clearAllMocks());

    it("requires CSRF for POST /api/auth/refresh", async () => {
        const res = await makeApp().request("/api/auth/refresh", { method: "POST" });
        expect(res.status).toBe(403);
    });

    it("passes /api/auth/refresh when header and stored token match", async () => {
        // @ts-ignore
        redisClient.get.mockResolvedValue("csrf-token-xyz");

        const res = await makeApp().request("/api/auth/refresh", {
            method: "POST",
            headers: {
                "x-csrf-token": "csrf-token-xyz",
                Cookie: "refresh=rid-1",
            },
        });
        expect(res.status).toBe(200);
    });

    it("does NOT require CSRF for non-refresh mutations", async () => {
        const res = await makeApp().request("/api/app/products", { method: "POST" });
        expect(res.status).toBe(200);
    });

    it("does NOT require CSRF for GET requests", async () => {
        const res = await makeApp().request("/api/auth/me");
        expect(res.status).toBe(200);
    });
});
```

- [ ] **Step 2: Run test (should fail — current csrf middleware enforces broadly)**

Run:
```bash
npx vitest run src/tests/middleware/csrf.test.ts
```

Expected: FAIL — test 3 fails because current middleware enforces CSRF on all non-GET unless exempt.

- [ ] **Step 3: Rewrite `src/middleware/csrf.ts`**

```ts
import type { Context, Next } from "hono";
import { env } from "../config/env.js";
import { getCookie } from "hono/cookie";
import { redisClient } from "../config/redis.js";
import { ApiError } from "../lib/errors/api.error.js";
import { logger } from "../lib/logger.js";

const CSRF_REQUIRED_ROUTES = [{ method: "POST", path: "/api/auth/refresh" }];

function isRequired(method: string, path: string): boolean {
    return CSRF_REQUIRED_ROUTES.some((r) => r.method === method && r.path === path);
}

export const csrfMiddleware = async (c: Context, next: Next) => {
    if (!isRequired(c.req.method, c.req.path)) {
        return next();
    }

    const csrfHeader = c.req.header(env.CSRF_HEADER_NAME);
    const rid = getCookie(c, env.REFRESH_COOKIE_NAME);

    if (!csrfHeader || !rid) {
        logger.warn("CSRF/refresh missing", { path: c.req.path, hasHeader: !!csrfHeader, hasCookie: !!rid });
        throw new ApiError(403, "CSRF token or refresh missing");
    }

    const stored = await redisClient.get(`csrf:${rid}`);
    if (stored !== csrfHeader) {
        logger.warn("CSRF mismatch", { path: c.req.path });
        throw new ApiError(403, "Invalid CSRF token");
    }

    await next();
};
```

- [ ] **Step 4: Run test**

Run:
```bash
npx vitest run src/tests/middleware/csrf.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add src/middleware/csrf.ts src/tests/middleware/csrf.test.ts
rtk git commit -m "feat(auth): discope csrfMiddleware to /api/auth/refresh only"
```

---

## Phase 3 — Auth Module Rewrite

### Task 8: Update `src/module/auth/auth.service.ts` (constant-time + simplified return)

**Files:**
- Modify: `src/module/auth/auth.service.ts`
- Modify: `src/tests/auth/auth.service.test.ts`

- [ ] **Step 1: Add failing test for constant-time login + new return shape**

Append to `src/tests/auth/auth.service.test.ts`:

```ts
describe("AuthService.login (PASETO migration)", () => {
    beforeEach(() => vi.clearAllMocks());

    it("returns { userId, email, role, status, user } shape", async () => {
        // @ts-ignore
        prisma.account.findUnique.mockResolvedValue({
            id: "acc-uuid-1",
            email: "test@example.com",
            role: "ADMIN",
            status: "ACTIVE",
            password: "$2b$10$hashedpassword",
            user: {
                id: "user-uuid-1",
                first_name: "Test",
                last_name: "User",
                phone: null,
                photo: null,
                whatsapp: null,
            },
        });

        const result = await AuthService.login(validLoginBody);

        expect(result.userId).toBe("user-uuid-1");
        expect(result.email).toBe("test@example.com");
        expect(result.role).toBe("ADMIN");
        expect(result.user.first_name).toBe("Test");
    });

    it("calls bcrypt.compare even when account not found (constant-time)", async () => {
        const bcrypt = (await import("bcrypt")).default;
        // @ts-ignore
        prisma.account.findUnique.mockResolvedValue(null);
        // @ts-ignore
        bcrypt.compare.mockClear();

        await expect(AuthService.login(validLoginBody)).rejects.toMatchObject({ statusCode: 401 });

        // @ts-ignore
        expect(bcrypt.compare).toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run test (should fail)**

Run:
```bash
npx vitest run src/tests/auth/auth.service.test.ts -t "PASETO migration"
```

Expected: FAIL — current `login()` returns `{ email, role, status, user }` without `userId`, and skips bcrypt when account not found.

- [ ] **Step 3: Modify `src/module/auth/auth.service.ts`**

Replace the file content with:

```ts
import { Account, STATUS, User } from "../../generated/prisma/client.js";
import { LoginRequestDTO, RegisterRequestDTO } from "./auth.schema.js";
import prisma from "../../config/prisma.js";
import { ApiError } from "../../lib/errors/api.error.js";
import { env } from "../../config/env.js";
import bcrypt from "bcrypt";
import { generateHexToken } from "../../lib/index.js";

// Pre-computed dummy bcrypt hash for constant-time comparison when email not found.
// Value below is bcrypt of an unguessable string; format must be valid bcrypt.
const DUMMY_BCRYPT_HASH = "$2b$10$CwTycUXWue0Thq9StjUM0uJ8B5/A4q4Z3Q1tH5GxOg9wYf3JZuO3i";

export type LoginResult = {
    userId: string;
    email: string;
    role: string;
    status: STATUS;
    user: {
        first_name: string;
        last_name: string | null;
        phone: string | null;
        photo: string | null;
        whatsapp: string | null;
    };
};

export class AuthService {
    private static async hashPassword(password: string): Promise<string> {
        const salt = await bcrypt.genSalt(env.SALT_ROUND);
        return bcrypt.hash(password, salt);
    }

    static async register(body: RegisterRequestDTO) {
        const { email, password, first_name, last_name } = body;
        const findEmail = await this.findEmail(email);
        if (findEmail) throw new ApiError(409, "Email telah digunakan");

        const hashedPassword = await this.hashPassword(password);

        const emailVerifyData = env.EMAIL_VERIFICATION
            ? { emailVerify: { create: { code: generateHexToken(), expired_at: new Date(Date.now() + 5 * 60 * 1000) } } }
            : { status: "ACTIVE" as const };

        await prisma.account.create({
            data: {
                email,
                password: hashedPassword,
                ...emailVerifyData,
                user: { create: { first_name, last_name } },
            },
        });
    }

    static async login(body: LoginRequestDTO): Promise<LoginResult> {
        const { email, password } = body;
        const account = await prisma.account.findUnique({
            where: {
                email,
                status: { notIn: ["BLOCK", "DELETE", "PENDING"] },
            },
            select: {
                email: true,
                role: true,
                status: true,
                password: true,
                user: {
                    select: {
                        id: true,
                        first_name: true,
                        last_name: true,
                        phone: true,
                        photo: true,
                        whatsapp: true,
                    },
                },
            },
        });

        // Constant-time: always call bcrypt.compare even on miss, with dummy hash.
        const hashToCompare = account?.password ?? DUMMY_BCRYPT_HASH;
        const ok = await bcrypt.compare(password, hashToCompare);

        if (!account || !account.user || !ok) {
            throw new ApiError(401, "Email atau Password Salah");
        }

        return {
            userId: account.user.id,
            email: account.email,
            role: account.role,
            status: account.status,
            user: {
                first_name: account.user.first_name,
                last_name: account.user.last_name,
                phone: account.user.phone,
                photo: account.user.photo,
                whatsapp: account.user.whatsapp,
            },
        };
    }

    private static async findEmail(email: string): Promise<{ email: string; status: STATUS } | null> {
        return prisma.account.findUnique({
            where: { email },
            select: { email: true, status: true },
        });
    }
}
```

- [ ] **Step 4: Run all auth.service tests**

Run:
```bash
npx vitest run src/tests/auth/auth.service.test.ts
```

Expected: all PASS, including the new constant-time and shape tests. Existing tests that check `result.email`/`result.role` still pass.

- [ ] **Step 5: Commit**

```bash
rtk git add src/module/auth/auth.service.ts src/tests/auth/auth.service.test.ts
rtk git commit -m "feat(auth): add constant-time login and userId in login result"
```

---

### Task 9: Rewrite `src/module/auth/auth.controller.ts`

**Files:**
- Modify: `src/module/auth/auth.controller.ts`

(Tests for the new controller are integrated in the routes test in Task 14; here we just write code that the route changes in Task 10 will exercise.)

- [ ] **Step 1: Replace `src/module/auth/auth.controller.ts`**

```ts
import { Context } from "hono";
import { AuthService } from "./auth.service.js";
import { CreateLoggingActivityDTO } from "../application/log/log.schema.js";
import { CreateLogger } from "../application/log/log.service.js";
import { ApiResponse } from "../../lib/api.response.js";
import { ApiError } from "../../lib/errors/api.error.js";
import { encryptAccessToken } from "../../lib/paseto.js";
import {
    issueRefreshToken,
    rotateRefreshToken,
    revokeRefreshToken,
    revokeAllForUser,
    getRefreshTokenMeta,
    countUserRefreshes,
} from "../../lib/refresh.token.js";
import { clearPermissionCache } from "../../lib/permissions.cache.js";
import { getUserId, getEmail } from "../../lib/auth.helpers.js";
import { getConnInfo } from "@hono/node-server/conninfo";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";
import { env } from "../../config/env.js";
import { redisClient } from "../../config/redis.js";
import { MAX_DEVICES } from "../../lib/constants.js";
import { ROLE } from "../../generated/prisma/client.js";
import * as crypto from "crypto";

function generateCsrfToken(): string {
    return crypto.randomBytes(32).toString("hex");
}

function setRefreshCookie(c: Context, rid: string, ttlSeconds: number) {
    setCookie(c, env.REFRESH_COOKIE_NAME, rid, {
        httpOnly: true,
        secure: env.isProduction,
        sameSite: "Lax",
        maxAge: ttlSeconds,
        path: "/api/auth",
        domain: env.isProduction && env.COOKIE_DOMAIN ? env.COOKIE_DOMAIN : undefined,
    });
}

function setCsrfCookie(c: Context, token: string, ttlSeconds: number) {
    setCookie(c, env.CSRF_COOKIE_NAME, token, {
        httpOnly: false,
        secure: env.isProduction,
        sameSite: "Lax",
        maxAge: ttlSeconds,
        path: "/api/auth",
        domain: env.isProduction && env.COOKIE_DOMAIN ? env.COOKIE_DOMAIN : undefined,
    });
}

export class AuthController {
    static async register(c: Context) {
        const body = c.get("body");
        await AuthService.register(body);
        return ApiResponse.sendSuccess(c, {}, 201);
    }

    static async login(c: Context) {
        const body = c.get("body");
        const { remember, ...reqBody } = body;
        const result = await AuthService.login(reqBody);

        // Enforce multi-device cap by userId
        const activeCount = await countUserRefreshes(result.userId);
        if (activeCount >= MAX_DEVICES) {
            throw new ApiError(429, `Maksimal ${MAX_DEVICES} device aktif`);
        }

        const info = getConnInfo(c);
        const ip = info.remote.address ?? "";
        const userAgent = c.req.header("User-Agent") ?? "";

        await CreateLogger({
            activity: "CREATE",
            description: `Login: ${result.email}-${ip}-${userAgent}`,
            email: result.email,
        } as CreateLoggingActivityDTO);

        const issued = await issueRefreshToken({
            userId: result.userId,
            email: result.email,
            role: result.role as ROLE,
            ip,
            userAgent,
            remember: !!remember,
        });

        const accessToken = await encryptAccessToken({
            sub: result.userId,
            email: result.email,
            role: result.role as ROLE,
            sid: issued.rid,
        });

        // Issue CSRF token bound to this refresh
        const csrfToken = generateCsrfToken();
        await redisClient.set(`csrf:${issued.rid}`, csrfToken, "EX", issued.ttl);

        setRefreshCookie(c, issued.rid, issued.ttl);
        setCsrfCookie(c, csrfToken, issued.ttl);

        return ApiResponse.sendSuccess(c, {
            accessToken,
            expiresIn: env.ACCESS_TTL,
        }, 200);
    }

    static async refresh(c: Context) {
        const rid = getCookie(c, env.REFRESH_COOKIE_NAME)
            || c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");

        if (!rid) throw new ApiError(401, "Refresh token missing");

        const rotated = await rotateRefreshToken(rid);

        // Delete old CSRF, issue new
        await redisClient.del(`csrf:${rid}`);
        const csrfToken = generateCsrfToken();
        await redisClient.set(`csrf:${rotated.newRid}`, csrfToken, "EX", rotated.ttl);

        const accessToken = await encryptAccessToken({
            sub: rotated.meta.userId,
            email: rotated.meta.email,
            role: rotated.meta.role,
            sid: rotated.newRid,
        });

        setRefreshCookie(c, rotated.newRid, rotated.ttl);
        setCsrfCookie(c, csrfToken, rotated.ttl);

        return ApiResponse.sendSuccess(c, {
            accessToken,
            expiresIn: env.ACCESS_TTL,
        }, 200);
    }

    static async me(c: Context) {
        const userId = getUserId(c);
        const email = getEmail(c);
        const role = c.get("role");
        const getPerms = c.get("permissions") as () => Promise<string[]>;
        const permissions = getPerms ? await getPerms() : [];

        return ApiResponse.sendSuccess(c, {
            userId,
            email,
            role,
            permissions,
        }, 200);
    }

    static async logout(c: Context) {
        const rid = getCookie(c, env.REFRESH_COOKIE_NAME);
        if (rid) {
            await revokeRefreshToken(rid);
            await redisClient.del(`csrf:${rid}`);
        }

        deleteCookie(c, env.REFRESH_COOKIE_NAME, { path: "/api/auth" });
        deleteCookie(c, env.CSRF_COOKIE_NAME, { path: "/api/auth" });

        return c.body(null, 204);
    }

    static async logoutAll(c: Context) {
        const userId = getUserId(c);
        await revokeAllForUser(userId);
        clearPermissionCache(userId);

        deleteCookie(c, env.REFRESH_COOKIE_NAME, { path: "/api/auth" });
        deleteCookie(c, env.CSRF_COOKIE_NAME, { path: "/api/auth" });

        return c.body(null, 204);
    }
}
```

- [ ] **Step 2: Run typecheck**

Run:
```bash
rtk tsc --noEmit
```

Expected: PASS. (Routes still reference removed methods — those are fixed in Task 10.)

If errors reference `setSessionLogin`, `SessionManager`, `c.get("session")` in OTHER files outside auth/, note them — they're handled in subsequent tasks.

- [ ] **Step 3: Commit**

```bash
rtk git add src/module/auth/auth.controller.ts
rtk git commit -m "feat(auth): rewrite controller for PASETO + refresh token flow"
```

---

### Task 10: Update `src/module/auth/auth.routes.ts`

**Files:**
- Modify: `src/module/auth/auth.routes.ts`

- [ ] **Step 1: Replace `src/module/auth/auth.routes.ts`**

```ts
import { Hono } from "hono";
import { validateBody } from "../../middleware/validation.js";
import { LoginSchema, RegisterSchema } from "./auth.schema.js";
import { AuthController } from "./auth.controller.js";
import { rateLimiter } from "../../middleware/rate.limit.js";
import { env } from "../../config/env.js";
import { authMiddleware } from "../../middleware/auth.js";

export const AuthRoutes = new Hono();

const strictRate = rateLimiter({
    maxRequests: env.isDevelopment ? 50 : 10,
    interval: env.isDevelopment ? 300 : 60,
    temporaryBlockDuration: env.isDevelopment ? 60 : 300,
});

const refreshRate = rateLimiter({
    maxRequests: env.isDevelopment ? 100 : 30,
    interval: env.isDevelopment ? 300 : 60,
    temporaryBlockDuration: env.isDevelopment ? 60 : 300,
});

AuthRoutes.post("/register", strictRate, validateBody(RegisterSchema), AuthController.register);
AuthRoutes.post("/login", strictRate, validateBody(LoginSchema), AuthController.login);
AuthRoutes.post("/refresh", refreshRate, AuthController.refresh);

AuthRoutes.get("/me", authMiddleware, AuthController.me);
AuthRoutes.post("/logout", authMiddleware, AuthController.logout);
AuthRoutes.post("/logout-all", authMiddleware, AuthController.logoutAll);
```

- [ ] **Step 2: Typecheck**

Run:
```bash
rtk tsc --noEmit
```

Expected: auth module typechecks. Other unrelated errors (e.g. `setSessionLogin` still exists in `src/lib/auth.ts`) may persist — fixed in Task 12.

- [ ] **Step 3: Commit**

```bash
rtk git add src/module/auth/auth.routes.ts
rtk git commit -m "feat(auth): wire new auth routes (login/refresh/me/logout/logout-all)"
```

---

## Phase 4 — App Wiring and Cleanup

### Task 11: Update `src/app.ts` and `src/module/route.ts`

**Files:**
- Modify: `src/app.ts`
- Modify: `src/module/route.ts`

- [ ] **Step 1: Update `src/app.ts` — remove sessionMiddleware and `/csrf` endpoint**

Modify these regions:

1. Remove import at line 21:
```ts
// REMOVE this line:
import { sessionMiddleware } from "./middleware/session.js";
```

2. Remove session middleware use at line 100. Delete this line entirely:
```ts
app.use("*", sessionMiddleware);
```

3. Delete the entire `app.get("/csrf", ...)` block (lines 145-179).

4. Remove the now-unused `setCookie` import on line 25 if unused elsewhere in app.ts (it's only used in the deleted /csrf block).

5. Remove the now-unused `ApiResponse` import on line 26 if unused elsewhere in app.ts.

6. Remove the now-unused `ApiError` import on line 24 if unused elsewhere in app.ts.

7. Remove the now-unused `crypto` import on line 9 if unused elsewhere in app.ts.

After edits, the file should have no references to `sessionMiddleware` or `/csrf`. Run:
```bash
rtk grep -n "sessionMiddleware\|/csrf\|setCookie\|crypto" src/app.ts
```
Expected: no results.

- [ ] **Step 2: Update `src/module/route.ts` — attach authMiddleware to `/app/*`**

Replace entire file with:

```ts
import { Hono } from "hono";
import { AuthRoutes } from "./auth/auth.routes.js";
import { ApplicationRoutes } from "./application/application.routes.js";
import { GlobalRoutes } from "./global/global.routes.js";
import { authMiddleware } from "../middleware/auth.js";

export const routes = new Hono();
routes.route("/auth", AuthRoutes);
routes.use("/app/*", authMiddleware);
routes.route("/app", ApplicationRoutes);
routes.route("/global", GlobalRoutes);
```

Note: This attaches `authMiddleware` globally to `/app/*`. Verify that no controllers under `/app/` rely on the old session context shape (`c.get("session")`, `c.get("user")` as nested object). They should be changed to `c.get("userId")` / `c.get("role")` / `getPermissions(c)`.

- [ ] **Step 3: Find consumers of legacy session context**

Run:
```bash
rtk grep -rn 'c.get("session")\|c.get("user")\|c.get("permissions")' src/module/
```

For each match outside `src/module/auth/`, identify whether it reads:
- `c.get("session")` → needs to be replaced with `getUserId(c)` / `getEmail(c)` / `getRole(c)`.
- `c.get("user")` (full user object) → fetch from DB if needed via `prisma.user.findUnique({ where: { id: getUserId(c) } })`, or use just the fields available in token (email/role).
- `c.get("permissions")` → use `await getPermissions(c)`.

This step is **discovery only** — do not modify files yet. Document each finding inline as `// TODO(paseto): migrate to getUserId(c)`. List the file paths.

If the list is large (>5 files), STOP and discuss with reviewer before proceeding to Step 4.

- [ ] **Step 4: Migrate consumers found in Step 3**

For each file identified, replace patterns:

```ts
// OLD
const session = c.get("session");
const email = session?.email;
const role = session?.role;

// NEW
import { getEmail, getRole, getUserId } from "../../lib/auth.helpers.js";
const email = getEmail(c);
const role = getRole(c);
const userId = getUserId(c);
```

For permissions:

```ts
// OLD
const permissions = c.get("permissions") || [];

// NEW
import { getPermissions } from "../../lib/auth.helpers.js";
const permissions = await getPermissions(c);
```

- [ ] **Step 5: Typecheck and run smoke test**

Run:
```bash
rtk tsc --noEmit
```
Expected: PASS (all errors resolved except potentially in deleted files Task 12 will remove).

Run:
```bash
npx vitest run src/tests/middleware/auth.test.ts src/tests/middleware/csrf.test.ts src/tests/lib/
```
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add src/app.ts src/module/route.ts src/module/
rtk git commit -m "refactor(auth): remove sessionMiddleware, attach authMiddleware to /app/*"
```

---

### Task 12: Delete dead files

**Files:**
- Delete: `src/middleware/session.ts`
- Delete: `src/lib/session.management.ts`
- Delete: `src/lib/auth.ts`

- [ ] **Step 1: Verify no remaining imports**

Run:
```bash
rtk grep -rn 'from .*middleware/session\|from .*lib/session.management\|from .*lib/auth\b\|setSessionLogin\|SessionManager\|sessionCache' src/
```

Expected: no results in `src/` (besides the files we're about to delete and the new `src/middleware/auth.ts` which is unrelated).

If any results remain, STOP and migrate them first (likely missed in Task 11).

- [ ] **Step 2: Delete the files**

```bash
rm src/middleware/session.ts src/lib/session.management.ts src/lib/auth.ts
```

- [ ] **Step 3: Typecheck**

Run:
```bash
rtk tsc --noEmit
```
Expected: PASS.

- [ ] **Step 4: Update `src/lib/monitor.ts` (SessionMetrics → RefreshTokenMetrics)**

Run:
```bash
rtk grep -n 'SessionMetrics' src/lib/monitor.ts src/app.ts
```

For each usage, replace the import and call sites with a thin metric over refresh tokens. Read the current `monitor.ts` first:

```bash
rtk read src/lib/monitor.ts
```

Then modify `SessionMetrics.getSessionStats()` and `getSessionActivity()` to count refresh tokens instead of sessions. The replacement implementation:

```ts
// in src/lib/monitor.ts — rename SessionMetrics to RefreshTokenMetrics or repurpose
// methods to scan refresh:* keys instead of session:* keys, count by SCAN.
```

For health endpoint compatibility, keep the same return shape (e.g., `{ active, total }`) but compute from `refresh:*` keys.

If this is too invasive, leave a stub returning `{ active: 0, total: 0, info: "metrics disabled during PASETO migration" }` and create a follow-up TODO. Note this decision in commit message.

- [ ] **Step 5: Run full test suite**

Run:
```bash
rtk npm run test
```

Expected: most tests pass. Auth route tests will FAIL — they're rewritten in Task 14. Anything else failing should be diagnosed before committing.

- [ ] **Step 6: Commit**

```bash
rtk git add -A
rtk git commit -m "chore(auth): delete legacy session middleware and helpers"
```

---

### Task 13: Create cleanup script `scripts/migrate-to-paseto-cleanup.ts`

**Files:**
- Create: `scripts/migrate-to-paseto-cleanup.ts`

- [ ] **Step 1: Implement the script**

```ts
import { redisClient, closeRedisConnection } from "../src/config/redis.js";
import { logger } from "../src/lib/logger.js";

const PATTERNS = ["session:*", "sessions:*", "csrf:*"];
const BATCH = 500;

async function deleteByPattern(pattern: string): Promise<number> {
    let cursor = "0";
    let total = 0;
    do {
        const [next, keys] = await redisClient.scan(cursor, "MATCH", pattern, "COUNT", BATCH);
        cursor = next;
        if (keys.length > 0) {
            const pipeline = redisClient.pipeline();
            for (const k of keys) pipeline.del(k);
            await pipeline.exec();
            total += keys.length;
            logger.info("paseto-cleanup: deleted batch", { pattern, count: keys.length, runningTotal: total });
        }
    } while (cursor !== "0");
    return total;
}

async function main() {
    logger.info("paseto-cleanup: starting");
    const results: Record<string, number> = {};
    for (const p of PATTERNS) {
        results[p] = await deleteByPattern(p);
    }
    logger.info("paseto-cleanup: complete", { results });
    await closeRedisConnection();
    process.exit(0);
}

main().catch((err) => {
    logger.error("paseto-cleanup: failed", { error: (err as Error).message });
    process.exit(1);
});
```

- [ ] **Step 2: Add npm script**

In `package.json`, add to `scripts`:
```json
"migrate:paseto-cleanup": "tsx scripts/migrate-to-paseto-cleanup.ts"
```

- [ ] **Step 3: Dry-run on dev Redis**

Run:
```bash
npm run migrate:paseto-cleanup
```

Expected: logs show counts for each pattern. Should be idempotent — second run shows 0 deletions.

- [ ] **Step 4: Commit**

```bash
rtk git add scripts/migrate-to-paseto-cleanup.ts package.json
rtk git commit -m "chore(auth): add legacy session cleanup script for cutover"
```

---

## Phase 5 — Test Migration

### Task 14: Add `withAuth()` helper and rewrite auth tests

**Files:**
- Modify: `src/tests/setup.ts`
- Modify: `src/tests/auth/auth.routes.test.ts`

- [ ] **Step 1: Add `makeTestAccessToken()` + `withAuth()` to `src/tests/setup.ts`**

Append to the end of `src/tests/setup.ts` (after all `vi.mock(...)` calls):

```ts
// Auth fixture: PASETO access token generator for tests
export async function makeTestAccessToken(overrides?: {
    sub?: string;
    email?: string;
    role?: string;
    sid?: string;
    expSeconds?: number;
}): Promise<string> {
    const { V4 } = await import("paseto");
    const { v4: uuid } = await import("uuid");
    const now = Math.floor(Date.now() / 1000);
    const claims = {
        sub: overrides?.sub ?? "test-user-id",
        email: overrides?.email ?? "test@mandalika.local",
        role: overrides?.role ?? "ADMIN",
        sid: overrides?.sid ?? "test-refresh-id",
        jti: uuid(),
        iat: now,
        exp: now + (overrides?.expSeconds ?? 900),
    };
    const key = Buffer.from(
        "0000000000000000000000000000000000000000000000000000000000000000",
        "hex"
    );
    return await V4.encrypt(claims, key);
}

export async function withAuth(
    init: RequestInit & { url: string },
    role: string = "ADMIN"
): Promise<RequestInit & { url: string }> {
    const token = await makeTestAccessToken({ role });
    return {
        ...init,
        headers: {
            ...(init.headers ?? {}),
            Authorization: `Bearer ${token}`,
        },
    };
}
```

- [ ] **Step 2: Rewrite `src/tests/auth/auth.routes.test.ts`**

Replace entire file:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import app from "../../app.js";
import prisma from "../../config/prisma.js";
import { redisClient } from "../../config/redis.js";
import { makeTestAccessToken } from "../setup.js";

vi.mock("../../middleware/csrf.js", () => ({
    csrfMiddleware: async (_c: any, next: any) => await next(),
}));
vi.mock("../../middleware/rate.limit.js", () => ({
    rateLimiter: () => async (_c: any, next: any) => await next(),
}));
vi.mock("@hono/node-server/conninfo", () => ({
    getConnInfo: () => ({ remote: { address: "127.0.0.1" } }),
}));
vi.mock("bcrypt", () => ({
    default: {
        genSalt: vi.fn().mockResolvedValue("salt"),
        hash: vi.fn().mockResolvedValue("$2b$10$hashedpassword"),
        compare: vi.fn().mockResolvedValue(true),
    },
}));

const validRegisterPayload = {
    email: "newuser@example.com",
    password: "Password@123",
    first_name: "New",
    last_name: "User",
    confirm_password: "Password@123",
};
const validLoginPayload = { email: "test@example.com", password: "Password@123" };

describe("AuthRoutes (PASETO)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // @ts-ignore — default: account exists for login
        prisma.account.findUnique.mockResolvedValue({
            email: "test@example.com",
            role: "ADMIN",
            status: "ACTIVE",
            password: "$2b$10$hashedpassword",
            user: {
                id: "user-uuid-1",
                first_name: "Test",
                last_name: "User",
                phone: null,
                photo: null,
                whatsapp: null,
            },
        });
        // @ts-ignore — refresh count under MAX
        redisClient.scard.mockResolvedValue(0);
    });

    describe("POST /api/auth/register", () => {
        it("returns 201 on success", async () => {
            // @ts-ignore
            prisma.account.findUnique.mockResolvedValueOnce(null);
            const res = await app.request("/api/auth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(validRegisterPayload),
            });
            expect(res.status).toBe(201);
        });

        it("returns 409 if email exists", async () => {
            const res = await app.request("/api/auth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...validRegisterPayload, email: "test@example.com" }),
            });
            expect(res.status).toBe(409);
        });

        it("returns 400 on weak password", async () => {
            const res = await app.request("/api/auth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...validRegisterPayload,
                    password: "weak1!",
                    confirm_password: "weak1!",
                }),
            });
            expect(res.status).toBe(400);
        });
    });

    describe("POST /api/auth/login", () => {
        it("returns 200 with accessToken on success", async () => {
            const res = await app.request("/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(validLoginPayload),
            });
            const body = await res.json();
            expect(res.status).toBe(200);
            expect(typeof body.data.accessToken).toBe("string");
            expect(body.data.expiresIn).toBe(900);

            const setCookie = res.headers.get("set-cookie") ?? "";
            expect(setCookie).toMatch(/refresh=/);
            expect(setCookie).toMatch(/csrf=/);
        });

        it("returns 401 on wrong password", async () => {
            const bcrypt = (await import("bcrypt")).default;
            // @ts-ignore
            bcrypt.compare.mockResolvedValueOnce(false);

            const res = await app.request("/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(validLoginPayload),
            });
            expect(res.status).toBe(401);
        });

        it("returns 401 when account not found", async () => {
            // @ts-ignore
            prisma.account.findUnique.mockResolvedValueOnce(null);
            const res = await app.request("/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: "notfound@example.com", password: "Password@123" }),
            });
            expect(res.status).toBe(401);
        });

        it("returns 429 when MAX_DEVICES reached", async () => {
            // @ts-ignore
            redisClient.scard.mockResolvedValueOnce(10);
            const res = await app.request("/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(validLoginPayload),
            });
            expect(res.status).toBe(429);
        });
    });

    describe("POST /api/auth/refresh", () => {
        it("returns 200 with new accessToken and rotates refresh cookie", async () => {
            // @ts-ignore — refresh exists
            redisClient.get.mockResolvedValueOnce(
                JSON.stringify({
                    userId: "user-uuid-1",
                    email: "test@example.com",
                    role: "ADMIN",
                    familyId: "family-1",
                    ip: "127.0.0.1",
                    userAgent: "agent",
                    remember: false,
                    createdAt: Date.now(),
                    lastUsedAt: Date.now(),
                })
            );

            const res = await app.request("/api/auth/refresh", {
                method: "POST",
                headers: {
                    Cookie: "refresh=old-rid",
                    "x-csrf-token": "csrf-val",
                },
            });
            const body = await res.json();
            expect(res.status).toBe(200);
            expect(typeof body.data.accessToken).toBe("string");
        });

        it("returns 401 when refresh not present in cookie or header", async () => {
            const res = await app.request("/api/auth/refresh", { method: "POST" });
            expect(res.status).toBe(401);
        });
    });

    describe("GET /api/auth/me", () => {
        it("returns 200 with claims when access token valid", async () => {
            const token = await makeTestAccessToken({ sub: "user-uuid-1", role: "ADMIN" });
            const res = await app.request("/api/auth/me", {
                headers: { Authorization: `Bearer ${token}` },
            });
            const body = await res.json();
            expect(res.status).toBe(200);
            expect(body.data.userId).toBe("user-uuid-1");
            expect(body.data.role).toBe("ADMIN");
        });

        it("returns 401 without token", async () => {
            const res = await app.request("/api/auth/me");
            expect(res.status).toBe(401);
        });
    });

    describe("POST /api/auth/logout", () => {
        it("returns 204 and revokes refresh", async () => {
            const token = await makeTestAccessToken();
            // @ts-ignore — getRefreshTokenMeta returns parsed meta
            redisClient.get.mockResolvedValue(
                JSON.stringify({
                    userId: "test-user-id",
                    email: "test@mandalika.local",
                    role: "ADMIN",
                    familyId: "family-1",
                    ip: "",
                    userAgent: "",
                    remember: false,
                    createdAt: 0,
                    lastUsedAt: 0,
                })
            );
            const res = await app.request("/api/auth/logout", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    Cookie: "refresh=rid-x",
                },
            });
            expect(res.status).toBe(204);
            // @ts-ignore
            expect(redisClient.del).toHaveBeenCalledWith("refresh:rid-x");
        });
    });

    describe("POST /api/auth/logout-all", () => {
        it("revokes all refreshes for user", async () => {
            const token = await makeTestAccessToken({ sub: "user-uuid-1" });
            // @ts-ignore — smembers returns rids
            redisClient.smembers.mockResolvedValue(["r1", "r2"]);
            // @ts-ignore
            redisClient.get.mockResolvedValue(
                JSON.stringify({
                    userId: "user-uuid-1",
                    email: "test@example.com",
                    role: "ADMIN",
                    familyId: "family-1",
                    ip: "",
                    userAgent: "",
                    remember: false,
                    createdAt: 0,
                    lastUsedAt: 0,
                })
            );

            const res = await app.request("/api/auth/logout-all", {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
            });
            expect(res.status).toBe(204);
            // @ts-ignore
            expect(redisClient.del).toHaveBeenCalledWith("refresh:r1");
            // @ts-ignore
            expect(redisClient.del).toHaveBeenCalledWith("refresh:r2");
        });
    });
});
```

- [ ] **Step 3: Run auth route tests**

Run:
```bash
npx vitest run src/tests/auth/auth.routes.test.ts
```

Expected: all tests PASS.

- [ ] **Step 4: Run full test suite**

Run:
```bash
rtk npm run test
```

Expected: Most pass. Any failures will be in route tests for OTHER modules that previously relied on the legacy session-based auth fixture. List the failures.

- [ ] **Step 5: Fix other module route tests using `withAuth()` helper**

For each failing test file under `src/tests/**/*.routes.test.ts`:

1. Remove the `vi.mock("hono/cookie", ...)` block.
2. Remove `mockAuthSession()` / `mockNoSession()` helpers.
3. Replace `app.request(url, { headers: { Cookie: "session=mock-session-id" } })` with:
   ```ts
   import { makeTestAccessToken } from "../setup.js";
   const token = await makeTestAccessToken({ role: "ADMIN" });
   await app.request(url, { headers: { Authorization: `Bearer ${token}` } });
   ```
4. Remove session-related `redisClient.get.mockResolvedValue(SESSION_DATA)` stubs.

This is a mechanical migration — do it for each test file one at a time, run that test file to confirm pass, then move to the next.

- [ ] **Step 6: Run full test suite again**

Run:
```bash
rtk npm run test
```

Expected: all pass. Including the 27 previously-failing tests (which were 401-related and are now fixed by the new auth fixture).

If any non-auth-related test still fails, diagnose case by case.

- [ ] **Step 7: Commit**

```bash
rtk git add -A
rtk git commit -m "test(auth): migrate all route tests to PASETO withAuth() fixture"
```

---

## Phase 6 — Documentation

### Task 15: Rewrite `docs/AUTH.md`

**Files:**
- Modify: `docs/AUTH.md`

- [ ] **Step 1: Replace the file with PASETO-architecture documentation**

Use this section layout (mirrors existing AUTH.md structure, content adapted from spec sections 2-8):

```markdown
# 🔐 Authentication & Authorization

Cara kerja PASETO access token + refresh token rotated, CSRF di backend ERP Mandalika.

---

## 1. Endpoint Auth

Mount di `/api/auth` (`module/auth/auth.routes.ts`).

| Method | Path                  | Body                                                                | Catatan |
| :----- | :-------------------- | :------------------------------------------------------------------ | :------ |
| POST   | `/api/auth/register`  | `{ first_name, last_name?, email, password, confirm_password }`     | Rate-limited 10/min prod. Email lowercase. |
| POST   | `/api/auth/login`     | `{ email, password, remember? }`                                    | Return `{ accessToken, expiresIn }`. Set cookie `refresh` (HttpOnly, Path=/api/auth) + `csrf` (non-HttpOnly). Max 10 device aktif. |
| POST   | `/api/auth/refresh`   | —                                                                   | Rotate refresh. Requires refresh cookie + `x-xsrf-header`. Returns new accessToken + new refresh + new csrf cookies. |
| GET    | `/api/auth/me`        | —                                                                   | Returns `{ userId, email, role, permissions }`. |
| POST   | `/api/auth/logout`    | —                                                                   | Revoke current refresh + clear cookies. 204. |
| POST   | `/api/auth/logout-all`| —                                                                   | Revoke ALL refresh for user (force sign-out everywhere). 204. |

### Validasi Password (Zod, `auth.schema.ts`)

(Same as before: min 8, max 100, uppercase + digit + special char.)

---

## 2. Access Token (PASETO v4.local)

- **Encrypted** (symmetric XChaCha20-Poly1305). Client tidak bisa baca claims.
- **Stateless**: verifikasi cukup decrypt + check `exp`. Tidak ada Redis hit.
- **TTL**: 15 menit (`ACCESS_TTL`).
- **Claims**:
  ```ts
  { sub: userId, email, role, jti, iat, exp, sid: refreshId }
  ```
- **Transport**: `Authorization: Bearer <accessToken>` header.
- **Tidak revocable** — accept window ≤ 15 menit untuk logout instan.

---

## 3. Refresh Token

- **Opaque** random 32-byte hex (bukan PASETO).
- **Stateful** di Redis: `refresh:<rid>` → JSON meta. TTL 7d default / 30d kalau `remember=true`.
- **Rotated** on every `/auth/refresh` call — refresh lama langsung di-DEL, refresh baru di-SET.
- **Family-based theft detection**: setiap login spawn `familyId`. Reuse refresh yang sudah di-rotate → DEL semua refresh dalam family, force re-login.
- **Transport** (browser): HttpOnly cookie `Secure`, `SameSite=Lax`, `Path=/api/auth`.
- **Transport** (mobile/headless): `Authorization: Bearer <refresh>` ke `/auth/refresh`.

### 3.1 Redis Keyspace

```
refresh:<rid>                → JSON meta. TTL refresh.
refreshes:<userId>           → SET of active rids (multi-device cap).
refresh_family:<F>           → SET of rids dalam family.
refresh_family_member:<rid>  → familyId (reverse lookup untuk theft detection).
csrf:<rid>                   → CSRF token. TTL refresh.
permcache:<userId>           → JSON permissions array. TTL 5 min.
```

---

## 4. CSRF Protection

CSRF middleware **hanya** aktif di `POST /api/auth/refresh` (endpoint yang pakai cookie auth). Endpoint bisnis pakai Bearer header → no CSRF needed.

### 4.1 Token

- Di-generate di `/auth/login` & rotate di `/auth/refresh` (32-byte hex).
- Disimpan di Redis `csrf:<rid>` (TTL = refresh TTL).
- Set cookie `CSRF_COOKIE_NAME` (NOT HttpOnly, agar JS frontend bisa baca).

### 4.2 Validasi

- Header `x-xsrf-header` wajib di `/auth/refresh`.
- Match dengan `redisClient.get(csrf:<rid>)` (rid dari refresh cookie).
- Mismatch / hilang → 403.

---

## 5. Rate Limiting

(Same structure as before, updated for new endpoints — `/login`, `/register` strict; `/refresh` moderate.)

---

## 6. RBAC

`roleMiddleware([ROLE.ADMIN])` — sama seperti sebelumnya. Role dibaca dari token claim (stateless). Permissions lazy-loaded via `getPermissions(c)` helper (in-memory cache 5 min + Redis fallback).

---

## 7. Akses Context di Handler

```ts
import { getUserId, getEmail, getRole, getPermissions } from "../../lib/auth.helpers.js";

const userId = getUserId(c);          // throws 401 if missing
const email = getEmail(c);
const role = getRole(c);
const permissions = await getPermissions(c);  // lazy fetch — Redis/DB hit only if called
```

---

## 8. Multi-Device Limit

`MAX_DEVICES = 10` (di `src/lib/constants.ts`). Login ditolak `429` jika `SCARD refreshes:<userId>` ≥ 10.

---

## 9. Headless / S2S Access

1. `POST /api/auth/login` → ambil `accessToken` dari body + refresh cookie dari `Set-Cookie` header.
2. Subsequent: `Authorization: Bearer <accessToken>`.
3. Refresh manual: `POST /api/auth/refresh` dengan `Authorization: Bearer <refresh>` (atau cookie). CSRF tetap perlu di `/auth/refresh`.

---

## 10. Key Rotation (PASETO_LOCAL_KEY)

1. `PASETO_LOCAL_KEY_OLD = <current>`, `PASETO_LOCAL_KEY = <new>`.
2. Deploy. Existing access tokens valid via OLD; new tokens via NEW.
3. Tunggu 30 menit (> ACCESS_TTL).
4. Hapus `PASETO_LOCAL_KEY_OLD` dari env.

Emergency (key leak): + jalankan script `revoke-all-refreshes` setelah step 2.

---

## 11. Error Codes

| Code | Sebab |
| :--- | :--- |
| 401  | Access token invalid/expired → FE call `/refresh` |
| 401  | Refresh token invalid/expired/rotated → FE redirect ke login |
| 403  | CSRF mismatch (hanya di `/refresh`) / role insufficient |
| 409  | Email sudah terdaftar |
| 429  | Rate limit / >10 device aktif |
```

Replace existing `docs/AUTH.md` content with this template. Adjust prose to match existing tone where needed.

- [ ] **Step 2: Verify rendered markdown**

Run:
```bash
cat docs/AUTH.md | head -50
```

Expected: properly formatted, no leftover `session:<sid>` or `setSessionLogin` references.

- [ ] **Step 3: Commit**

```bash
rtk git add docs/AUTH.md
rtk git commit -m "docs(auth): rewrite AUTH.md for PASETO architecture"
```

---

### Task 16: Update `docs/modules/auth.md`

**Files:**
- Modify: `docs/modules/auth.md`

- [ ] **Step 1: Update endpoint table**

Replace the endpoint table (lines 10-15) with:

```markdown
| Method | Path                  | Auth     | Body                                                                                |
| :----- | :-------------------- | :------- | :---------------------------------------------------------------------------------- |
| POST   | `/api/auth/register`  | ❌       | `{ first_name, last_name?, email, password, confirm_password }`                     |
| POST   | `/api/auth/login`     | ❌       | `{ email, password, remember? }`                                                    |
| POST   | `/api/auth/refresh`   | refresh  | —                                                                                   |
| GET    | `/api/auth/me`        | access   | —                                                                                   |
| POST   | `/api/auth/logout`    | access   | —                                                                                   |
| POST   | `/api/auth/logout-all`| access   | —                                                                                   |
```

- [ ] **Step 2: Update Service section**

Replace lines 42-47 with the new return shape `{ userId, email, role, status, user }` and mention constant-time bcrypt.

- [ ] **Step 3: Update Controller section**

Replace the controller table (lines 50-57) with new methods: `register`, `login`, `refresh`, `me`, `logout`, `logoutAll`.

- [ ] **Step 4: Update Cookie section**

Rename to "Refresh Cookie" with new attributes:
- Name: `env.REFRESH_COOKIE_NAME`
- HttpOnly, Secure (prod), SameSite=Lax, Path=`/api/auth`, MaxAge = REFRESH_TTL or REFRESH_TTL_REMEMBER

CSRF Cookie section: same but bound to refresh (`csrf:<rid>`).

- [ ] **Step 5: Update curl examples**

```bash
# 1. Register (no change)

# 2. Login (path changed to /login)
curl -X POST https://api.../api/auth/login \
  -c cookie.txt \
  -H "Content-Type: application/json" \
  -d '{"email":"a@b.com","password":"Aa1@safe","remember":true}'
# Response: { data: { accessToken, expiresIn } }
# Sets cookies: refresh=<rid>, csrf=<token>

# 3. Authenticated request
ACCESS=$(extract from login response)
curl https://api.../api/auth/me \
  -H "Authorization: Bearer $ACCESS"

# 4. Refresh
CSRF=$(grep csrf cookie.txt | awk '{print $7}')
curl -X POST https://api.../api/auth/refresh \
  -b cookie.txt -c cookie.txt \
  -H "x-xsrf-header: $CSRF"

# 5. Logout
curl -X POST https://api.../api/auth/logout \
  -b cookie.txt \
  -H "Authorization: Bearer $ACCESS"
```

- [ ] **Step 6: Update Error Codes**

| HTTP | Sebab |
| :--- | :--- |
| 400 | Validation gagal (Zod). |
| 401 | Kredensial salah / access token invalid/expired / refresh invalid/expired/rotated. |
| 403 | CSRF mismatch (refresh) / role insufficient. |
| 409 | Email sudah terdaftar. |
| 429 | Rate limit / >10 device aktif. |

- [ ] **Step 7: Commit**

```bash
rtk git add docs/modules/auth.md
rtk git commit -m "docs(auth): update module doc for PASETO endpoints and flow"
```

---

### Task 17: Update Postman collection

**Files:**
- Modify: `docs/postman/erp-mandalika.postman_collection.json`

- [ ] **Step 1: Locate auth folder in collection**

Run:
```bash
rtk grep -n '"name": "Auth"' docs/postman/erp-mandalika.postman_collection.json
```

- [ ] **Step 2: Update endpoints**

For each existing auth request in the JSON:
- `POST /api/auth/` (login) → rename to "Login" + path `/api/auth/login` + remove old test scripts that read CSRF from cookie before login.
- `GET /api/auth/` (me) → rename to "Me" + path `/api/auth/me` + add `Authorization: Bearer {{accessToken}}` header.
- `DELETE /api/auth/` (logout) → change to `POST /api/auth/logout`.

Add new requests:
- `POST /api/auth/refresh` — sends refresh cookie + `x-xsrf-header`. Test script: save `accessToken` from response into env var.
- `POST /api/auth/logout-all` — needs `Authorization: Bearer {{accessToken}}`.

Update collection-level test script (if any) to extract `accessToken` after login and save to env:
```js
const body = pm.response.json();
if (body?.data?.accessToken) {
    pm.environment.set("accessToken", body.data.accessToken);
}
```

- [ ] **Step 3: Validate JSON**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('docs/postman/erp-mandalika.postman_collection.json', 'utf8'))"
```

Expected: no output (parsing succeeded). If parse error → fix.

- [ ] **Step 4: Commit**

```bash
rtk git add docs/postman/erp-mandalika.postman_collection.json
rtk git commit -m "docs(auth): update Postman collection for PASETO endpoints"
```

---

## Phase 7 — Cutover (Reference for Deploy)

This is not a code task — these are the operational steps for deploying the migration. Not part of the implementation plan but listed for completeness.

1. Generate `PASETO_LOCAL_KEY` and add to prod secret manager.
2. Deploy backend.
3. Run `npm run migrate:paseto-cleanup` once (deletes legacy session keys).
4. Deploy frontend.
5. Smoke test end-to-end (register → login → /me → refresh → logout → logout-all).
6. Monitor `auth.*` metrics for 1 hour. Rollback if error rate > 5% on login/refresh.

---

## Acceptance Criteria

The migration is complete when:

- [ ] All tests in `npm run test` pass, including the previously-failing 27 route tests.
- [ ] `rtk tsc --noEmit` reports zero errors.
- [ ] `rtk grep -rn 'setSessionLogin\|SessionManager\|sessionCache\|sessionMiddleware' src/` returns no results.
- [ ] `rtk grep -rn 'env\.SESSION_COOKIE_NAME\|env\.SESSION_TTL' src/` returns no results.
- [ ] End-to-end smoke test via curl succeeds: register → login (returns accessToken + cookies) → GET /me (returns claims) → POST /refresh (rotated, new tokens) → POST /logout (204) → next /me fails 401.
- [ ] Refresh token theft test: use old refresh after rotate → 401 + family revoked → user re-login required.
- [ ] Multi-device cap: simulate 10 active sessions → 11th login returns 429.
- [ ] `docs/AUTH.md` and `docs/modules/auth.md` reflect PASETO architecture, no legacy session references.
- [ ] Postman collection has working requests for all 6 auth endpoints + valid CSRF flow for refresh.
- [ ] Cleanup script runs idempotently (second run → 0 deletions).

---

## Open Items / Risks

Tracked from spec section 11:

1. **COOKIE_DOMAIN prod**: confirm at deploy whether FE/BE are same-origin or cross-subdomain. Affects `setRefreshCookie` and `setCsrfCookie` `domain` attribute.
2. **`c.get("user")` blast radius**: Task 11 Step 3 catches all consumers; if list is large, scope review required.
3. **`SessionMetrics` → `RefreshTokenMetrics`**: in Task 12 Step 4, if too invasive, ship stub and create follow-up. Document in commit.
4. **`PASETO_LOCAL_KEY` rotation**: not exercised in this migration but `paseto.ts` supports it. Document key rotation runbook in `docs/AUTH.md` (Task 15).
5. **Refresh rotation race condition (spec 7.2)**: plan implements sequential Redis ops + `refresh_family_member:<rid>` reverse-lookup with TTL window for theft tolerance. Full Redis LUA atomicity is **NOT** in this plan — accept brief window (< 5 sec) where concurrent `/refresh` calls from same user could each succeed, both rotating to different rids. Client-side single-flight (FE axios queue) is the primary mitigation. Add LUA atomicity in a follow-up PR if metrics show meaningful race incidence.
6. **Observability metrics (spec 7.10)**: counters/gauges (`auth.login.success`, `auth.refresh.theft_detected`, etc.) NOT implemented in this plan. Add a follow-up task once migration is stable — they belong in `lib/monitor.ts` extension, low risk to ship after.
