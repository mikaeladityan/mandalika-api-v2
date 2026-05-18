# Rule Catalog — Architecture

## Scope

- Covers: controller/service/schema/routes layering, dependency direction, responsibility placement, Prisma model usage.

## Rules

### Keep business logic out of controllers

- Category: maintainability
- Severity: critical
- Description: Controllers should parse input, call services, and return serialized responses using `ApiResponse`. Business decisions inside controllers make behavior hard to reuse and test.
- Suggested fix: Move domain/business logic into the `service.ts` file. Keep controller handlers thin and focused on orchestration.
- Example:
  - Bad:
    ```typescript
    // [feature].controller.ts
    const create = async (c: Context) => {
      const body = await c.req.json();
      if (body.price <= 0) {
        throw new ApiError(400, "Price must be positive");
      }
      const product = await prisma.product.create({ data: body });
      return ApiResponse.sendSuccess(c, product);
    };
    ```
  - Good:
    ```typescript
    // [feature].controller.ts
    const create = async (c: Context) => {
      const body = await c.req.json(); // validated by middleware earlier
      const result = await ProductService.create(body);
      return ApiResponse.sendSuccess(c, result);
    };
    ```

### Preserve layer dependency direction

- Category: best practices
- Severity: critical
- Description: Routes depend on Controllers, Controllers depend on Services, and Services depend on Prisma models/schemas. Reversing this direction (e.g., service importing Hono `Context`) leaks transport concerns into domain code.
- Suggested fix: Ensure lower layers (Service/Schema) don't depend on upper layers (Controller/Routes).
- Example:
  - Bad:

    ```typescript
    // [feature].service.ts
    import { Context } from "hono";

    export const getDetail = async (c: Context) => {
      const id = c.req.param("id");
      return prisma.data.findUnique({ where: { id } });
    };
    ```

  - Good:
    ```typescript
    // [feature].service.ts
    export const getDetail = async (id: string) => {
      return prisma.data.findUnique({ where: { id } });
    };
    ```

### Keep libs business-agnostic

- Category: maintainability
- Severity: critical
- Description: Modules under `api/src/lib/` should remain reusable, business-agnostic building blocks. They must not encode product/domain-specific rules or business decisions.
- Suggested fix:
  - If business logic appears in `api/src/lib/`, extract it into the appropriate `service.ts` module.
  - Keep `lib` dependencies clean: avoid importing services or application-specific models into `lib`.
- Example:
  - Bad:

    ```typescript
    // api/src/lib/formatter.ts
    import { UserService } from "../module/application/user/user.service";

    export const formatUserName = async (userId: string) => {
      const user = await UserService.detail(userId);
      return `User: ${user.name}`;
    };
    ```

  - Good:

    ```typescript
    // api/src/lib/string-utils.ts
    export const capitalize = (str: string) =>
      str.charAt(0).toUpperCase() + str.slice(1);

    // api/src/module/application/user/user.service.ts
    import { capitalize } from "../../../lib/string-utils";
    export const detail = async (id: string) => {
      const user = await prisma.user.findUnique({ where: { id } });
      return { ...user, name: capitalize(user.name) };
    };
    ```
