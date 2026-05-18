# Runtime Rules (TanStack Query)

## Conditional Queries

When a query depends on an input that might be undefined (e.g., an ID from the URL), use the `enabled` flag.

```typescript
import { useQuery } from '@tanstack/react-query'

function useProductDetail(productId: string | undefined) {
  return useQuery({
    queryKey: ['products', 'detail', productId],
    queryFn: () => ProductService.getById(productId!),
    enabled: !!productId, // Only run if productId is truthy
  });
}
```

## Cache Invalidation

Mutations should almost always invalidate related query keys in their `onSuccess` handler. This keeps the UI in sync after an update.

- **Exact Match**: `queryClient.invalidateQueries({ queryKey: ['products', 'list'] })`
- **Partial Match**: `queryClient.invalidateQueries({ queryKey: ['products'] })` will invalidate *all* product-related queries.

```typescript
// server/use.product.ts
export const useUpdateProduct = () => {
    const queryClient = useQueryClient();
    
    return useMutation({
        mutationFn: (data: UpdateProductDTO) => ProductService.update(data),
        onSuccess: () => {
            // Invalidate the specific list and the detail cache
            queryClient.invalidateQueries({ queryKey: ["products", "list"] });
            queryClient.invalidateQueries({ queryKey: ["products", "detail", data.id] });
            toast.success("Product updated");
        },
    });
};
```

## `mutate` vs `mutateAsync`

Prefer `mutate` by default for event handlers. Use `mutateAsync` only when you need to chain multiple mutations or handle them in a specific order via Promises.

### Rules:
- **`mutate`**: Best for simple actions. Handle success/error via callbacks.
- **`mutateAsync`**: Use with `try/catch`. Good for `await`ing multiple operations.

```typescript
// ✅ Preferred: mutate
const onSubmit = (data) => {
  updateMutation.mutate(data, {
    onSuccess: () => closeModal(),
  });
};

// ✅ Chained: mutateAsync
const onComplexAction = async (data) => {
  try {
    const parent = await createParent.mutateAsync(data.parent);
    await createChild.mutateAsync({ ...data.child, parentId: parent.id });
    toast.success("Both created");
  } catch (error) {
    toast.error("Failed to sequence operations");
  }
};
```

## Best Practices
- **Query Keys as Constants**: Consider defining query key factories if the same keys are used in multiple files.
- **Optimistic Updates**: Use `onMutate` to update the cache before the server responds if the UI needs to feel instantaneous.
- **Error Handling**: Consistently use `sonner` or similar toast libraries in the `onSuccess`/`onError` handlers of your custom hooks.
