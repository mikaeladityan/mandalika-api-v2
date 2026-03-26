# 🏗️ System Architecture

This document describes the high-level architecture and technical stack of the Mandalika ERP Backend.

## 🛠️ Technology Stack

- **Runtime**: [Node.js](https://nodejs.org/) (LTS)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Web Framework**: [Hono](https://hono.dev/)
- **ORM**: [Prisma](https://www.prisma.io/)
- **Primary Database**: [PostgreSQL](https://www.postgresql.org/)
- **Cache & Session Management**: [Redis](https://redis.io/)
- **Testing**: [Vitest](https://vitest.dev/)
- **Logging**: [Winston](https://github.com/winstonjs/winston)
- **Validation**: [Zod](https://zod.dev/)

---

## 🏗️ Folder Structure

The project follows a modular architecture organized by domain:

```bash
api/src/
├── config/       # Global configuration (Prisma, Redis, Env)
├── lib/          # Shared libraries, utilities, and helper classes
├── middleware/   # Cross-cutting concerns (Auth, Error handling, Rate limiting)
├── module/       # Main business logic partitioned by domain
│   ├── application/
│   │   ├── bom/            # Bill of Materials logic
│   │   ├── forecast/       # Forecasting engine
│   │   ├── product/        # Product management
│   │   ├── rawmat/         # Raw material inventory
│   │   ├── recipe/         # Formula and recipe management
│   │   └── recomendation/  # Procurement decision support
│   ├── auth/               # Authentication & session handlers
│   └── route.ts            # Main application router
├── pkg/          # Internal packages or standalone utilities
└── tests/        # Comprehensive test suites (Unit & Integration)
```

---

## 🔄 Request Lifecycle

1.  **Entry Point**: `src/server.ts` starts the specialized Hono server.
2.  **App Initialization**: `src/app.ts` configures global middlewares.
3.  **Global Middlewares**:
    - `requestId`: Injects unique UUID for tracing.
    - `secureHeaders`: Standard security headers (CSP, HSTS).
    - `cors`: Handles cross-origin requests.
    - `compress`: Gzip response compression.
    - `rateLimiter`: Protects against brute-force/DoS.
    - `sessionMiddleware`: Retrieves session data from Redis.
    - `csrfMiddleware`: Validates CSRF tokens for mutating requests.
4.  **Routing**: Dispatched via `src/module/route.ts`.
5.  **Domain Layers**:
    - **Controller**: Parses request, invokes service, and handles response mapping.
    - **Service**: Implements business logic and interacts with the database via Prisma.
    - **Schema**: Defines request/response shapes and Zod validation.
6.  **Error Handling**: Centralized `errorHandler` middleware catches `ApiError` or unhandled exceptions and returns standardized JSON.

---

## 🔐 Security Principles

- **CSRF Protection**: Non-GET/OPTIONS requests require a valid CSRF token in the `X-XSRF-TOKEN` header, matched against a secret stored in the user's Redis session.
- **Session Management**: Sessions are stored in Redis (`session:{id}`) for persistence across restarts and fast access.
- **Data Integrity**: Critical fields like `z_value` or `price` are cast correctly during logic processing. Soft-deletion is used for main entities (`deleted_at`).
- **SQL Injection**: Handled natively by Prisma's query builder or strictly parameterized Tagged Templates when using `prisma.$queryRaw`.

---

## 📈 Performance & Scalability

- **Caching**: Frequently accessed data for recipes and inventory is cached in Redis to reduce database load.
- **Heavy Computations**: The Forecasting Engine is optimized for sequential processing across horizons.
- **Monitoring**: `src/lib/monitor.ts` tracks session activity and system metrics accessible via the `/health` endpoint.
