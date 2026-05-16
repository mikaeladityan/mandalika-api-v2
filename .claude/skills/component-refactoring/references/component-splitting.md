# Component Splitting Patterns

This document provides detailed guidance on splitting large React components into smaller, focused units within the ERP project.

## When to Split Components

Split a component when you identify:

1. **Multiple UI sections** - Distinct visual areas (e.g., Header, Filter Bar, Table, Dialogs) that can be managed independently.
1. **Conditional rendering blocks** - Large `{condition && <JSX />}` blocks, especially for complex forms or specialized views.
1. **Repeated patterns** - Similar UI structures used multiple times (e.g., table cells, status badges).
1. **300+ lines** - Component exceeds manageable size, making navigation and testing difficult.
1. **Modal clusters** - Multiple dialogs/drawers rendered in one component.

---

## Splitting Strategies

### Strategy 1: Section-Based Splitting

Identify visual sections and extract each as a component. For page-level components, follow the `components/pages/[feature]/` directory structure.

```typescript
// ❌ Before: Monolithic Forecast component (500+ lines)
const ForecastPage = () => {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
           {/* 100 lines of Title, Search, and Action Buttons */}
        </CardHeader>
        <CardContent>
           {/* 200 lines of Table logic and rendering */}
        </CardContent>
      </Card>
      {/* 150 lines of Dialogs */}
    </div>
  )
}

// ✅ After: Split into focused components
// pages/forecast/
//   ├── index.tsx              (orchestration)
//   ├── forecast-header.tsx    (title & filter row)
//   ├── table/                 (table logic, columns)
//   └── dialogs/               (modals & drawers)
```

### Strategy 2: Modal & Dialog Extraction

Extract modals with their own internal state management or as dedicated components receiving visibility props.

```typescript
// ✅ After: Modal manager or individual dialog extraction
// pages/forecast/dialogs/batch-forecast.dialog.tsx
export function BatchForecastDialog({ open, onOpenChange, onSuccess }) {
    // Keep dialog-specific submission logic here
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>...</DialogContent>
        </Dialog>
    )
}

// Main Page
const ForecastPage = () => {
    const [openDialog, setOpenDialog] = useState(false)
    return (
        <>
            <ForecastHeader onRunAnalytics={() => setOpenDialog(true)} />
            <BatchForecastDialog open={openDialog} onOpenChange={setOpenDialog} />
        </>
    )
}
```

### Strategy 3: Table Column Extraction

For `DataTable` implementations, always extract column definitions to a separate file.

```typescript
// pages/forecast/table/column.tsx
export const ForecastColumns = ({ periods, onEditManual }) => [
  {
    accessorKey: "product_name",
    header: "Produk",
    cell: ({ row }) => <ProductNameCell product={row.original} />
  },
  // ...
]
```

---

## Directory Structure Patterns

### Page-Level Feature Structure (ERP Standard)

Follow the pattern found in `app/src/components/pages/`:

```
forecast/
  ├── index.tsx           # Main orchestration (The "Page" component)
  ├── print-report.tsx    # Specialized view (Printable)
  ├── table/              # Table-related logic
  │   ├── column.tsx
  │   └── index.tsx
  ├── dialogs/            # All feature-specific modals
  │   ├── batch-forecast.dialog.tsx
  │   └── manual-forecast.dialog.tsx
  └── hooks/              # UI-only hooks if needed
```

### Server/Data Layer Structure

Follow the pattern found in `app/src/app/(application)/[feature]/server/`:

```
server/
  ├── [feature].schema.ts   # Zod DTOs
  ├── [feature].service.ts  # API Fetchers
  └── use.[feature].ts      # TanStack Query & Table State hooks
```

---

## Props Design

### Minimal Props Principle

Pass only what's needed. Instead of passing a whole `product` object to a badge, pass just the `status`.

```typescript
// ✅ Good: Destructure to minimum required
<StatusBadge status={product.status} />
```

### Callback Props Pattern

Use callbacks for child-to-parent communication, following the `on[Action]` naming convention.

```typescript
<ForecastHeader
  onSearch={table.setSearch}
  onFilterChange={table.setType}
  onReset={table.resetFilters}
/>
```

---

## Related Rules

- [Complexity Reduction Patterns](complexity-patterns.md)
- [Hook Extraction Patterns](hook-extraction.md)
  return <>{renderEmpty()}</>
  }
  return (
  <div>
  {items.map((item, index) => renderItem(item, index))}
  </div>
  )
  }

// Usage
<List
items={operations}
renderItem={(op, i) => <OperationItem key={i} operation={op} />}
renderEmpty={() => <EmptyState message="No operations" />}
/>

```

```
