# Rule Catalog — Prisma Query Patterns

## Scope

- Covers: Prisma Client lifecycle, interactive transactions (`$transaction`), concurrency safeguards (optimistic/pessimistic locking), and error handling strategies.
- Does NOT cover: table/model schema design (handled by `db-schema-rule.md`).

## Rules

### Use Interactive Transactions for complex write units

- Category: best practices
- Severity: critical
- Description: Multi-step database updates must be atomic. Use Prisma's Interactive Transaction API (`prisma.$transaction(async (tx) => { ... })`) to ensure all operations succeed or fail together. Avoid passing the Prisma Client instance into non-service methods; use the `tx` instance within the transaction block.
- Suggested fix:
  - Keep transaction windows short: move network I/O, heavy computation, or external API calls **outside** of the `async (tx)` callback.
  - Ensure all database calls within the block use the `tx` object instead of the global `prisma` client.
- Example:
  - Bad:
    ```typescript
    await prisma.$transaction(async (tx) => {
      await tx.order.create({ data });
      await callExternalShippingApi(); // Violation: External I/O inside transaction
      await tx.inventory.update({ ... });
    });
    ```
  - Good:

    ```typescript
    const result = await prisma.$transaction(async (tx) => {
      return await tx.order.create({ data });
    });

    // External work happens outside the critical DB lock window
    await callExternalShippingApi();

    await prisma.inventory.update({ ... });
    ```

### Handle Missing Records and Conflicts sessionally

- Category: reliability
- Severity: critical
- Description: Always verify the existence of a record before attempting updates that are expected to succeed. Use `ApiError` to return clean error messages to the frontend if a pre-condition is not met.
- Suggested fix: Use `findUnique` or `findFirst` to check for data presence before executing business logic that depends on it.
- Example:
  - Good (Explicit check):

    ```typescript
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) throw new ApiError(404, "Produk tidak ditemukan");

    // Proceed with logic...
    ```

### Protect write paths with Concurrency Safeguards

- Category: quality
- Severity: critical
- Description: High-concurrency write paths (e.g., updating stock levels) must use locking mechanisms to prevent race conditions.
- Suggested fix:
  - **Optimistic Locking**: Use the `where` clause with an `updated_at` or `version` field. Verify that the update affected exactly 1 row.
  - **Distributed Locking**: Use the `redisClient` for locking critical sections that span multiple services or contain side effects.
  - **Pessimistic Locking**: For extreme contention, use `$queryRaw` to execute `SELECT ... FOR UPDATE`.
- Example:
  - Good (Optimistic Lock):

    ```typescript
    const result = await prisma.product.updateMany({
      where: {
        id,
        updated_at: expectedUpdatedAt, // guard
      },
      data: { quantity: newQuantity },
    });

    if (result.count === 0) {
      throw new ApiError(409, "Data telah berubah, silakan coba lagi");
    }
    ```

### Prefer Prisma methods over Raw SQL

- Category: maintainability
- Severity: suggestion
- Description: Raw SQL should only be used when the Prisma ORM is technically incapable of performing the query or is significantly less efficient.
- Suggested fix: Refer to `db-schema-rule.md` for specific guidelines on when Raw SQL is acceptable (e.g., complex reporting or massive bulk inserts).
  ``
