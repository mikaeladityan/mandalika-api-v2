# Rule Catalog - Service Data Access (Repository Pattern)

## Scope

- Covers: Implementing database access patterns within the **Service Layer** (`.service.ts`), managing complex query reuse, and maintaining clean separation from controllers.
- Does NOT cover: Prisma schema design (handled by `db-schema-rule.md`) or basic architecture layering (handled by `architecture-rule.md`).

## Rules

### Encapsulate all DB logic in Services

- Category: maintainability
- Severity: critical
- Description: In this project, the **Service Layer** doubles as the repository layer. All Prisma Client interactions (ORM or Raw SQL) must be encapsulated within service methods.
- Suggested fix: Do not introduce a separate repository folder or abstraction layer. Instead, focus on building robust, reusable service methods that handle all data persistence and retrieval.
- Example:
  - Good (Service handles everything):
    ```typescript
    // [feature].service.ts
    export class ProductService {
      static async detail(id: number) {
        return await prisma.product.findUnique({
          where: { id },
          include: { unit: true, size: true },
        });
      }
    }
    ```

### Reuse shared query logic via Helper Methods

- Category: maintainability
- Severity: suggestion
- Description: If multiple service methods or different service modules need the same complex filter, join, or mapping logic, extract it into a private static helper method within the service class.
- Suggested fix: Use private static methods to manage shared `include` blocks or common column transformations (e.g. converting `Decimal` to `Number`).
- Example:
  - Good (Shared helper within service):

    ```typescript
    export class ProductService {
      private static getStandardIncludes() {
        return { product_type: true, unit: true, size: true };
      }

      static async list() {
        return prisma.product.findMany({ include: this.getStandardIncludes() });
      }

      static async detail(id: number) {
        return prisma.product.findUnique({
          where: { id },
          include: this.getStandardIncludes(),
        });
      }
    }
    ```

### Handle Transactions in Services

- Category: reliability
- Severity: critical
- Description: Complex operations involving multiple table updates must use `prisma.$transaction` within the service method to ensure atomicity.
- Suggested fix: Wrap multi-step database changes in a transaction block. Avoid exposing transaction objects (`tx`) outside of the service layer unless required for service-to-service calls.
- Example:
  - Good (Atomic transaction):
    ```typescript
    static async clean() {
      await prisma.$transaction(async (tx) => {
        await tx.forecast.deleteMany({ where: { ... } });
        await tx.product.deleteMany({ where: { ... } });
      });
    }
    ```

### Use Case-Specific DTOs for Service Returns

- Category: maintainability
- Severity: suggestion
- Description: Service methods should return data formatted according to the `Response[Feature]DTO` defined in the schema. Do not return raw Prisma entities if they contain sensitive data or require type transformation.
- Suggested fix: Map Prisma results to DTOs and handle type conversions (e.g., Decimal results to numbers) before returning them to the controller.
