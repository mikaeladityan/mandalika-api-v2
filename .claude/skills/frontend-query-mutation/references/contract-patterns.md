# Data Interaction Patterns (DTOs & Services)

## Intent
- Use **Zod Schemas** as the source of truth for data validation and TypeScript types.
- Centralize API logic in **Service Classes** (e.g., `ForecastService`).
- Use **Custom Hooks** to orchestrate TanStack Query logic and UI side effects.

## Minimal Structure
Feature-based organization under `app/src/app/(application)/[feature]/server/`:
```text
server/
├── [feature].schema.ts   # Zod DTO definitions
├── [feature].service.ts  # Axios fetchers & transformations
└── use.[feature].ts      # React Query hooks
```

## Core Workflow

### 1. Define Schemas (Zod)
Define both API Request and Response schemas in `[feature].schema.ts`.
```typescript
export const ForecastSchema = zod.object({
  id: zod.number(),
  productName: zod.string(),
  // ...
});
export type Forecast = zod.infer<typeof ForecastSchema>;
```

### 2. Implement Service (Axios)
Implement static methods in a Service class. Map raw responses to Zod schemas if runtime validation is required.
```typescript
export class ForecastService {
  static async getList(params: QueryParams): Promise<Forecast[]> {
    const { data } = await api.get('/forecasts', { params });
    return data;
  }
}
```

### 3. Consume via Hooks (TanStack Query)
Wrap service calls in `useQuery` or `useMutation`.
```typescript
export const useForecasts = (query: string) => {
  return useQuery({
    queryKey: ['forecasts', 'list', query],
    queryFn: () => ForecastService.getList({ query }),
  });
};
```

## Decision Rules

### When to use a Service vs direct Fetch?
- **Always use a Service**: To keep components decoupled from the API client (Axios) and to allow for easy mocking in tests.

### When to use a Custom Hook?
- **Logic Sharing**: When multiple components need the same query/mutation logic.
- **Complex Orchestration**: When a mutation needs to invalidate multiple queries or trigger specific UI feedback (toasts).

## Anti-Patterns
- **Direct Axios in Components**: Hard to test and leads to duplicated query keys.
- **`any` Types**: Always use `zod.infer` or manual interfaces for API responses.
- **Manual State for Fetching**: Use TanStack Query's `isLoading`, `isError`, and `data` instead of manual `useState` for loading flags.
