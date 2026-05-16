# Hook Extraction Patterns

This document provides detailed guidance on extracting custom hooks from complex components in the ERP project.

## When to Extract Hooks

Extract a custom hook when you identify:

1. **Coupled state groups** - Multiple `useState` hooks that are logically dependent (e.g., search, pagination, and filters).
1. **Business logic** - Complex data transformations, projections, or calculations (e.g., calculating forecast periods).
1. **Reusable patterns** - Logic shared across modules (e.g., handling local storage or mobile detection).
1. **API Orchestration** - Complex TanStack Query configurations involving multiple dependent queries.

---

## Extraction Process: Example Case Study

### Step 1: Identify Coupled State

In the `Forecast` component, the table state (search, type filter, size filter, horizon, and pagination) is highly coupled.

```typescript
// ❌ Problem: Too much state in the main component
const [search, setSearch] = useState("");
const [typeId, setTypeId] = useState<number>();
const [sizeId, setSizeId] = useState<number>();
const [horizon, setHorizon] = useState(3);
const [page, setPage] = useState(1);
```

### Step 2: Create the Custom Hook

Extract this logic to `use.[feature].ts` in the feature's `server/` directory.

```typescript
// app/(application)/forecasts/server/use.forecast.ts

export const useForecastTableState = (is_others?: boolean) => {
  const [search, setSearch] = useState("");
  const [type_id, setType] = useState<number>();
  const [size_id, setSize] = useState<number>();
  const [horizon, setHorizon] = useState(3);
  const [page, setPage] = useState(1);
  const [take, setPageSize] = useState(10);

  const resetFilters = () => {
    setSearch("");
    setType(undefined);
    setSize(undefined);
  };

  const queryParams = useMemo(
    () => ({
      search,
      type_id,
      size_id,
      horizon,
      page,
      take,
      is_others,
    }),
    [search, type_id, size_id, horizon, page, take, is_others],
  );

  return {
    search,
    setSearch,
    type_id,
    setType,
    size_id,
    setSize,
    horizon,
    setHorizon,
    page,
    setPage,
    take,
    setPageSize,
    resetFilters,
    queryParams,
  };
};
```

### Step 3: Use the Hook in the Component

```typescript
// pages/forecast/index.tsx
const ForecastPage = () => {
  const table = useForecastTableState(is_others)

  // Component is now clean of table state orchestration
  return <ForecastHeader table={table} />
}
```

---

## Naming Conventions (ERP Standard)

### Hook Names

- Use the `use` prefix.
- Feature-specific hooks: `useForecast`, `useInventory`.
- Logic-specific hooks: `useForecastTableState`, `useStockCardFilters`.

### File Names

- Custom hooks: `use.[feature].ts` (for data/logic hooks).
- Generic hooks: `use-local-storage.ts` (kebab-case).

### Return & Param Types

- Suffix with `Return`: `UseForecastTableReturn`.
- Suffix with `Params`: `UseForecastParams`.

---

## Common Hook Patterns

### 1. Data Fetching (TanStack Query)

Always wrap `useQuery` and `useMutation` in custom hooks.

```typescript
export const useForecast = (params: QueryForecastDTO) => {
  const list = useQuery({
    queryKey: ["forecasting", "list", params],
    queryFn: () => ForecastService.list(params),
  });
  return { list };
};
```

### 2. Local Storage Sync

```typescript
// hooks/use-local-storage.ts
export function useLocalStorage<T>(key: string, initialValue: T) {
  // Logic for sync state with localStorage...
}
```

---

## Testing Extracted Hooks (Vitest)

Test hooks in isolation using `@testing-library/react`. Place tests in `api/src/tests/` (following backend pattern) or in a `tests/` folder in the app layer.

```typescript
// use.forecast.test.ts
import { renderHook, act } from "@testing-library/react";
import { useForecastTableState } from "./use.forecast";
import { describe, it, expect } from "vitest";

describe("useForecastTableState", () => {
  it("should reset filters correctly", () => {
    const { result } = renderHook(() => useForecastTableState());

    act(() => {
      result.current.setSearch("testing");
      result.current.setType(123);
    });

    expect(result.current.search).toBe("testing");

    act(() => {
      result.current.resetFilters();
    });

    expect(result.current.search).toBe("");
    expect(result.current.type_id).toBeUndefined();
  });
});
```

---

## Related Rules

- [Complexity Reduction Patterns](complexity-patterns.md)
- [Component Splitting Patterns](component-splitting.md)
