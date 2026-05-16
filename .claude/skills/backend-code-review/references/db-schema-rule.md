# Rule Catalog — DB Schema & Query Design

## Scope

- Covers: Prisma model definitions, indexing strategies, ORM vs Raw SQL usage, and placement of data access logic in the service layer.

## Rules

### Prefer Prisma ORM over Raw SQL

- Category: maintainability
- Severity: critical
- Description: Always use Prisma's type-safe ORM methods (`prisma.user.findUnique`, `prisma.product.create`, etc.) as the first choice. This ensures type safety, better developer experience, and easier maintenance.
- Suggested fix: Use `$queryRaw` or `$executeRaw` only when Prisma's ORM is insufficient for the task or significantly slower.
- Example:
  - Bad (Unnecessary Raw SQL):
    ```typescript
    // In service layer
    const users =
      await prisma.$queryRaw`SELECT * FROM users WHERE status = 'ACTIVE'`;
    ```
  - Good (ORM usage):
    ```typescript
    // In service layer
    const users = await prisma.user.findMany({ where: { status: "ACTIVE" } });
    ```

### Use Raw SQL for Performance-Critical Operations

- Category: performance
- Severity: suggestion
- Description: Use Prisma Raw SQL (`$queryRaw`, `$executeRaw`) for operations where the ORM is inefficient, such as massive bulk inserts, complex analytical queries with multiple joins/aggregations, or when specific PostgreSQL features are required.
- Suggested fix: Use Raw SQL for bulk inserts and complex fetch list data if performance testing shows a clear advantage. Document the rationale in the service method.
- Example:
  - Good (Complex fetch via Raw SQL):
    ```typescript
    // In service layer
    export const getInventoryReport = async () => {
      // Complex aggregation that is easier/faster in Raw SQL
      return await prisma.$queryRaw`
        SELECT p.name, SUM(i.quantity) as total 
        FROM products p 
        JOIN product_inventories i ON p.id = i.product_id 
        GROUP BY p.name
      `;
    };
    ```

### Mandatory Indexing for Search and Sort Fields

- Category: performance
- Severity: critical
- Description: Every field used in `WHERE` clauses, `ORDER BY` statements, or as a foreign key in relations must be properly indexed using `@@index` or `@@unique` in `schema.prisma`. Proper indexing is mandatory for system scalability.
- Suggested fix: Review the `@@index` definitions whenever a new query pattern is introduced. Ensure composite indexes cover common query filters.
- Example:
  - Bad:
    ```prisma
    model Product {
      id   Int    @id @default(autoincrement())
      code String @unique
      name String
      // Missing index on 'name' even though we search or sort by it
    }
    ```
  - Good:
    ```prisma
    model Product {
      id         Int      @id @default(autoincrement())
      code       String   @unique @db.VarChar(100)
      name       String   @db.VarChar(100)
      created_at DateTime @default(now())

      @@index([name])
      @@index([created_at])
      @@map("products")
    }
    ```

### Data Access belongs in the Service Layer

- Category: maintainability
- Severity: critical
- Description: All Prisma queries (ORM or Raw) must reside within the `[feature].service.ts` files. Controllers should only call service methods and should never interact with the `prisma` client directly.
- Suggested fix: Move any database logic from controllers or other layers into the appropriate service module.
- Example:
  - Bad:
    ```typescript
    // [feature].controller.ts
    const list = async (c: Context) => {
      const data = await prisma.product.findMany(); // Violation: direct DB access
      return ApiResponse.sendSuccess(c, data);
    };
    ```
  - Good:

    ```typescript
    // [feature].service.ts
    export const list = () => prisma.product.findMany();

    // [feature].controller.ts
    const list = async (c: Context) => {
      const data = await ProductService.list(); // Correct: uses service layer
      return ApiResponse.sendSuccess(c, data);
    };
    ```

### Follow Schema Naming and Mapping Conventions

- Category: maintainability
- Severity: suggestion
- Description: Use snake_case for field names in Prisma models to match the database convention used in this project. Always use `@@map` to ensure database tables follow explicit naming standards.
- Suggested fix: Ensure every model has a `@@map("table_name")` and use explicit relation handling.
- Example:

  ```prisma
  model UserProfile {
    id         Int      @id @default(autoincrement())
    first_name String   @db.VarChar(100)
    created_at DateTime @default(now())

    @@map("user_profiles")
  }
  ```
