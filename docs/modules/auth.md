# 🔐 Module: Auth

**Path**: `/api/auth`
**Source**: `src/module/auth/`

---

## Endpoint

| Method | Path                  | Auth     | Body                                                                                |
| :----- | :-------------------- | :------- | :---------------------------------------------------------------------------------- |
| POST   | `/api/auth/register`  | ❌       | `{ first_name, last_name?, email, password, confirm_password }`                     |
| POST   | `/api/auth/`          | ❌       | `{ email, password, remember? }`                                                    |
| GET    | `/api/auth/`          | session  | —                                                                                   |
| DELETE | `/api/auth/`          | session  | —                                                                                   |

Rate limit:
- Dev: 50 req / 5 menit, blok 1 menit.
- Prod: 10 req / 1 menit, blok 5 menit.

---

## Validation (`auth.schema.ts`)

```ts
EmailSchema    = z.string().max(100).email().toLowerCase();
PasswordSchema = z.string().min(8).max(100)
                          .regex(/[A-Z]/).regex(/[0-9]/).regex(/[^A-Za-z0-9]/);
AuthBaseSchema = { email, password };

LoginSchema    = AuthBaseSchema + { remember?: boolean };
RegisterSchema = AuthBaseSchema + { first_name: 1-100, last_name?: 0-100, confirm_password }
                                   .refine(password === confirm_password);
```

Type DTO:
- `LoginRequestDTO`
- `RegisterRequestDTO` (omit `confirm_password`).

---

## Service (`auth.service.ts`)

- `register(input)` → hash password (`bcrypt`, `SALT_ROUND` env), insert `Account` + `User`, log activity.
- `login(input)` → cari `Account` by email + `bcrypt.compare`. Throw 401 jika salah.

---

## Controller (`auth.controller.ts`)

| Method      | Logic                                                                                                                |
| :---------- | :------------------------------------------------------------------------------------------------------------------- |
| `register`  | `AuthService.register(body)` → 201.                                                                                  |
| `login`     | Cek `MAX_DEVICES = 5` via `SessionManager.getUserActiveSessions`. Generate `sessionToken`, log activity, call `setSessionLogin`. |
| `getAccount`| Ambil `c.get("session")`. Throw 401 jika kosong.                                                                     |
| `logout`    | Hapus `session:<sid>` + `csrf:<sid>` di Redis. `deleteCookie` keduanya.                                              |

---

## Session Cookie

- Nama: `env.SESSION_COOKIE_NAME`.
- Atribut: `HttpOnly`, `Secure` di prod, `SameSite=Lax`.
- TTL: `env.SESSION_TTL` detik (sliding).
- Headless: `Authorization: Bearer <sessionId>`.

## CSRF Cookie

- Nama: `env.CSRF_COOKIE_NAME` (TIDAK HttpOnly agar JS frontend bisa baca).
- TTL: 15 menit.
- Diperbarui via `GET /csrf`.

---

## Contoh

```bash
# 1. Register
curl -X POST https://api.../api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"first_name":"Admin","email":"a@b.com","password":"Aa1@safe","confirm_password":"Aa1@safe"}'

# 2. Get CSRF
curl -c cookie.txt https://api.../csrf

# 3. Login
CSRF=$(grep csrf cookie.txt | awk '{print $7}')
curl -X POST https://api.../api/auth/ \
  -b cookie.txt -c cookie.txt \
  -H "Content-Type: application/json" \
  -H "x-xsrf-header: $CSRF" \
  -d '{"email":"a@b.com","password":"Aa1@safe","remember":true}'

# 4. Get current account
curl -b cookie.txt https://api.../api/auth/

# 5. Logout
curl -X DELETE -b cookie.txt -H "x-xsrf-header: $CSRF" https://api.../api/auth/
```

---

## Error Code

| HTTP | Sebab                                       |
| :--- | :------------------------------------------ |
| 400  | Validation gagal (Zod).                     |
| 401  | Kredensial salah / session expired.         |
| 409  | Email sudah terdaftar (saat register).      |
| 429  | Rate limit / >5 device aktif.               |

Detail lebih dalam → [`../AUTH.md`](../AUTH.md).
