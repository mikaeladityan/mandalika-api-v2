# Complexity Reduction Patterns

This document provides patterns for reducing cognitive complexity in ERP React components.

## Understanding Complexity

### Cognitive Complexity

Cognitive complexity measures how difficult it is to understand the control flow of a component. High complexity (especially in page-level components like `Forecast` or `StockCard`) leads to bugs and difficult maintenance.

### What Increases Complexity

| Pattern             | Complexity Impact    |
| ------------------- | -------------------- | -------- | --------------- |
| `if/else`           | +1 per branch        |
| Nested conditions   | +1 per nesting level |
| `switch/case`       | +1 per case          |
| `for/while/do`      | +1 per loop          |
| `&&`/`              |                      | ` chains | +1 per operator |
| Nested callbacks    | +1 per nesting level |
| Ternary expressions | +1 per nesting       |

---

## Pattern 1: Replace Conditionals with Lookup Tables

**Before** (complexity: ~10):
Large switch/if statements for rendering UI based on status or type.

```typescript
const StatusBadge = ({ status }: { status: string }) => {
  if (status === 'PENDING') {
    return <Badge variant="warning">Pending</Badge>
  } else if (status === 'APPROVED') {
    return <Badge variant="success">Approved</Badge>
  } else if (status === 'REJECTED') {
    return <Badge variant="destructive">Rejected</Badge>
  } else {
    return <Badge variant="secondary">Unknown</Badge>
  }
}
```

**After** (complexity: ~2):
Use a record mapping for cleaner rendering logic.

```typescript
const STATUS_CONFIG = {
  PENDING: { label: 'Pending', variant: 'warning' },
  APPROVED: { label: 'Approved', variant: 'success' },
  REJECTED: { label: 'Rejected', variant: 'destructive' },
} as const

const StatusBadge = ({ status }: { status: keyof typeof STATUS_CONFIG }) => {
  const config = STATUS_CONFIG[status] || { label: 'Unknown', variant: 'secondary' }
  return <Badge variant={config.variant}>{config.label}</Badge>
}
```

---

## Pattern 2: Use Early Returns

Avoid deep nesting by checking for invalid states first.

**Before** (complexity: ~10):

```typescript
const handleRunForecast = () => {
  if (table.horizon > 0) {
    if (!isProcessing) {
      if (isValidated) {
        runAnalytics();
      } else {
        showError("Validation failed");
      }
    }
  }
};
```

**After** (complexity: ~4):

```typescript
const handleRunForecast = () => {
  if (table.horizon <= 0) return;
  if (isProcessing) return;

  if (!isValidated) {
    showError("Validation failed");
    return;
  }

  runAnalytics();
};
```

---

## Pattern 3: Extract Complex Logic to Named Constants

Especially useful for complex filtering or column definitions in `DataTable`.

**Before**:

```typescript
const columns = useMemo(() => [
  {
    header: "Product",
    cell: ({ row }) => (
      <div>
        <span>{row.name}</span>
        {row.is_new && <Badge>New</Badge>}
        {row.stock < 10 && <span className="text-red-500">Low Stock</span>}
      </div>
    )
  },
  // ... more complex inline logic
], [])
```

**After**:
Extract the cell rendering to a named component or a helper function.

```typescript
const ProductNameCell = ({ product }) => (
  <div>
    <span>{product.name}</span>
    {product.is_new && <Badge>New</Badge>}
    {product.stock < 10 && <span className="text-red-500">Low Stock</span>}
  </div>
)

const columns = useMemo(() => [
  {
    header: "Product",
    cell: ({ row }) => <ProductNameCell product={row.original} />
  },
], [])
```

---

## Pattern 4: Replace Chained Ternaries

Chained ternaries are hard to read and debug. Use `if/else` in a separate function.

**Before**:

```typescript
const color =
  status === "ready" ? "green" : status === "syncing" ? "blue" : "gray";
```

**After**:

```typescript
const getStatusColor = (status: string) => {
  if (status === "ready") return "green";
  if (status === "syncing") return "blue";
  return "gray";
};
const color = getStatusColor(status);
```

---

## Pattern 5: Extract Event Handler Logic

Extract complex handlers (like search/filtering orchestration) into hooks like `useForecastTableState`.

**Before**:

```typescript
const ForecastPage = () => {
  const [search, setSearch] = useState("");
  const [typeId, setTypeId] = useState<number>();

  const handleReset = () => {
    setSearch("");
    setTypeId(undefined);
  };

  // 50 more lines of search/filter state logic...
};
```

**After**:

```typescript
const ForecastPage = () => {
  const table = useForecastTableState()

  return (
    <Input value={table.search} onChange={e => table.setSearch(e.target.value)} />
    <Button onClick={table.resetFilters}>Clear</Button>
  )
}
```

---

## Target Metrics for ERP Components

| Metric                 | Target                             |
| ---------------------- | ---------------------------------- |
| Total Component Length | < 300 lines                        |
| Max Function Length    | < 40 lines                         |
| Nesting Depth          | ≤ 3 levels                         |
| JSX Complexity         | Extract sections to sub-components |

---

## Related Rules

- [Component Splitting Patterns](component-splitting.md)
- [Hook Extraction Patterns](hook-extraction.md)
