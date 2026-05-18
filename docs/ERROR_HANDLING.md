# 🚨 Error Handling

Format error response dan kelas error tersedia di `lib/errors/api.error.ts`. Central handler ada di `middleware/error.handler.ts`.

---

## 1. Kelas Error

| Class                | HTTP | Use case                                                |
| :------------------- | :--- | :------------------------------------------------------ |
| `ApiError`           | any  | Base class. `new ApiError(statusCode, message, details?, name?)` |
| `ValidationError`    | 400  | Wrapper untuk `ZodError`. Detail per `field/message/code` di `details.issues`. |
| `UnauthorizedError`  | 401  | "Authentication required" (default).                    |
| `ForbiddenError`     | 403  | "Insufficient permissions".                             |
| `NotFoundError`      | 404  | `new NotFoundError("Purchase Order")` → `"Purchase Order not found"`. |
| `ConflictError`      | 409  | Bentrok unik/state (duplikat kode, status invalid).     |
| `RateLimitError`     | 429  | + opsional `retryAfter`, `limit`.                       |

Throw biasa di service:

```ts
throw new ApiError(422, "Stok tidak cukup", { requested: 10, available: 3 });
throw new ConflictError("Email sudah terdaftar");
throw new NotFoundError("Goods Receipt");
```

---

## 2. Format Response

Sukses (dari `ApiResponse.sendSuccess`):

```json
{
  "query": { "total": 120, "page": 1, "take": 25 },
  "status": "success",
  "data": [...]
}
```

Error standar (dari `error.handler.ts`):

```json
{
  "success": false,
  "error": "<ErrorName>",
  "message": "<human readable>",
  "details": { ... },
  "requestId": "<uuid>"
}
```

`details` hanya muncul saat error punya properti `details`.

### 2.1 Validation Error (Zod)

```json
{
  "success": false,
  "error": "ValidationError",
  "message": "Validation failed",
  "details": {
    "issues": [
      { "field": "body.password", "message": "Kata sandi minimal 8 karakter", "code": "too_small" },
      { "field": "body.email",    "message": "Format email tidak valid",     "code": "invalid_string" }
    ]
  },
  "requestId": "<uuid>"
}
```

### 2.2 Rate Limit Error

Response 429 + header:

```
Retry-After: 60
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
```

Body:

```json
{
  "success": false,
  "error": "RateLimitError",
  "message": "Too many requests",
  "retryAfter": 60,
  "requestId": "<uuid>"
}
```

### 2.3 Prisma P2025

Prisma `RecordNotFoundError` (kode `P2025`) auto-handled menjadi:

```json
{ "success": false, "error": "NotFound", "message": "Record not found.", "requestId": "<uuid>" }
```

### 2.4 Hono HTTPException

Status sesuai `err.status`, body:

```json
{ "success": false, "error": "<msg>", "message": "<msg>", "requestId": "<uuid>" }
```

### 2.5 Unknown / Internal

Status 500. `message` di-mask di production:

- **Prod**: `"An unexpected error occurred. Please try again later."`
- **Dev**: pesan asli + `stack` + `type`.

---

## 3. `errorHandler` Sequence

`app.onError(errorHandler)` di `app.ts` dipasang paling awal. Urutan check di handler:

```
1. HTTPException (Hono)            → c.json(err.status)
2. ZodError                        → ValidationError → 400
3. RateLimitError                  → 429 + headers
4. ApiError (incl. subclass)       → status sesuai
5. Prisma P2025                    → 404
6. Default                         → 500 (mask di prod)
```

Logging selalu jalan (sebelum return), dengan field: `requestId`, `userId`, `path`, `method`, `error`, `name`, `stack (dev only)`.

---

## 4. Throwing dari Middleware

Boleh throw `ApiError` di middleware mana saja. `authMiddleware` punya path khusus:

- `authMiddleware` tangkap `ApiError`-nya sendiri dan return `c.json({ success: false, message }, statusCode)` daripada delegate ke handler global. Ini agar bisa `deleteCookie` saat session corrupt.

---

## 5. Validator Custom

Untuk endpoint dengan body kompleks gunakan `validateBody`. Untuk query+form gunakan `validate`. Lihat `middleware/validation.ts`:

```ts
// JSON body
foo.post("/", validateBody(CreateFooSchema), FooController.create);

// query + form-data
foo.get("/search", validate(QueryFooSchema), FooController.search);
```

Output `validateBody` disimpan di `c.set("body", parsed)`.

---

## 6. Best Practice

1. **Throw early**. Tidak perlu cek nullable lalu return — biarkan ApiError.
2. **Pesan dalam Bahasa Indonesia** untuk pesan yang akan ditampilkan ke user.
3. Untuk debugging tambahan, isi `details` (object). Hindari leaking sensitive info di prod.
4. Jangan log password / token. Gunakan `logger.error(msg, { error: err.message })`.
5. Untuk error transient (DB down, Redis), throw `ApiError(503, "Service unavailable")`.
