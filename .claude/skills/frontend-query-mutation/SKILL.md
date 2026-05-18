---
name: frontend-query-mutation
description: Guide for implementing ERP frontend query and mutation patterns with TanStack Query and Axios. Trigger when creating or updating DTOs in feature server folders, wiring feature services, consuming custom query/mutation hooks, handling conditional queries, cache invalidation, or error handling.
---

# Frontend Query & Mutation

## Intent

- Use **Zod Schema & DTOs** as the single source of truth in `server/[feature].schema.ts`.
- Prefer **Custom Hooks** (e.g., `use.[feature].ts`) to wrap TanStack Query logic.
- Keep invalidation and mutation side effects (like Sonner toasts) in the service/hook layer.
- Ensure type safety by mapping API responses to DTOs in the Service layer.

## Workflow

1. **Backend First**: Ensure the API endpoint and Zod schemas are defined in the `api/` directory (following `dev.md`).
2. **Define DTOs**: Create or update `app/src/app/(application)/[feature]/server/[feature].schema.ts` to match backend schemas.
3. **Service Layer**: Implement fetchers in `app/src/app/(application)/[feature]/server/[feature].service.ts` using the project's axios-based api client.
4. **React Query Hooks**:
   - Wrap `useQuery` for fetching in `app/src/app/(application)/[feature]/server/use.[feature].ts`.
   - Wrap `useMutation` for actions (create, update, delete).
   - Implement `onSuccess` handlers for cache invalidation via `queryClient.invalidateQueries`.

## Directory Structure (ERP Pattern)

Follow the pattern for every feature under `app/src/app/(application)/`:
```
[feature]/
  └── server/
      ├── [feature].schema.ts   # Zod DTOs
      ├── [feature].service.ts  # Axios Fetchers
      └── use.[feature].ts      # TanStack Query & Mutation Hooks
```

## Example Pattern

```typescript
// use.forecast.ts
export const useActionForecast = () => {
    const queryClient = useQueryClient();
    
    const runMutation = useMutation({
        mutationKey: ["forecasting", "run"],
        mutationFn: (params: RunForecastDTO) => ForecastService.run(params),
        onSuccess: (res) => {
            queryClient.invalidateQueries({ queryKey: ["forecasting", "list"] });
            toast.success(res.message || "Forecast running...");
        },
    });

    return { runMutation };
};
```

## Best Practices
- **Query Keys**: Use consistent array-based keys: `["domain", "action", params]`.
- **Invalidation**: Always invalidate related lists after a successful create/update/destroy mutation.
- **Error Handling**: Use the global error interceptors but handle specific field errors in `@tanstack/react-form` if applicable.

Treat this skill as the authority for all data-fetching and state-management integration on the frontend.
