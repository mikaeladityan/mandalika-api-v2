---
name: component-refactoring
description: Refactor high-complexity React components. Use when components grow too large (e.g., lineCount > 300) or when the user asks for code splitting, hook extraction, or complexity reduction.
---

# React Component Refactoring Skill

Refactor high-complexity React components within the project following the patterns and workflow below.

## Quick Reference

### Core Guidelines
- **Target Line Count**: Individual components should ideally stay under **300 lines**.
- **State Responsibility**: Extract complex state management (searching, filtering, pagination) into custom hooks.
- **UI Responsibility**: Split monolithic JSX into focused sub-components organized within the feature directory.

---

## Core Refactoring Patterns

### Pattern 1: Extract Custom Hooks

**When**: Component has complex state management, multiple `useState`/`useEffect` hooks, or logic mixed with UI rendering.

**Convention**: Place feature-specific logic in `server/use.[feature].ts` or alongside the component.

```typescript
// ❌ Before: Complex state logic in page component
const ForecastPage: FC = () => {
  const [search, setSearch] = useState('')
  const [typeId, setTypeId] = useState<number>()
  const [horizon, setHorizon] = useState(3)
  
  // 50+ lines of fetching/orchestration logic...
  
  return <div>...</div>
}

// ✅ After: Extract to custom hook
// server/use.forecast.ts
export const useForecastTableState = () => {
  const [search, setSearch] = useState('')
  const [typeId, setTypeId] = useState<number>()
  
  // Cohesive filter/table logic here
  
  return { search, setSearch, typeId, setTypeId, ... }
}

// Component becomes cleaner
const ForecastPage: FC = () => {
  const table = useForecastTableState()
  return <ForecastHeader table={table} />
}
```

### Pattern 2: Extract Sub-Components

**When**: Single component has multiple UI sections (Header, Table, Dialogs), conditional rendering blocks, or repeated patterns.

**Convention**: Organize sections into sub-directories or separate files in the same feature folder.

```typescript
// ❌ Before: Monolithic JSX
const StockDashboard = () => {
  return (
    <div>
      {/* 100 lines of Statistics Card */}
      {/* 200 lines of Stock Table with complex cell logic */}
      {/* 100 lines of Action Dialogs */}
    </div>
  )
}

// ✅ After: Split into focused components
// stocks/
//   ├── index.tsx           (orchestration only)
//   ├── stock-stats.tsx     (visual cards)
//   ├── stock-table.tsx     (data grid)
//   └── stock-dialogs.tsx   (modal management)

const StockDashboard = () => {
  return (
    <div>
      <StockStats data={stats} />
      <StockTable data={list} />
      <StockDialogs active={active} />
    </div>
  )
}
```

### Pattern 3: Simplify Conditional Logic

**When**: Deep nesting (> 3 levels), complex ternaries, or multiple `if/else` chains.

```typescript
// ✅ Use lookup tables + early returns
const STATUS_BADGE_MAP = {
  PENDING: <Badge variant="warning">Pending</Badge>,
  APPROVED: <Badge variant="success">Approved</Badge>,
  REJECTED: <Badge variant="destructive">Rejected</Badge>,
}

const StatusDisplay = ({ status }) => {
  return STATUS_BADGE_MAP[status] || <Badge variant="secondary">Unknown</Badge>
}
```

### Pattern 4: Extract Column Definitions

**When**: `DataTable` columns have complex rendering logic or many conditionally visible columns.

**Convention**: Place in `table/column.tsx`.

```typescript
// table/column.tsx
export const getForecastColumns = ({ horizon, onAction }) => [
  {
    accessorKey: "name",
    header: "Product",
    cell: ({ row }) => <ProductCell product={row.original} />
  },
  // ...
]
```

---

## Refactoring Workflow

### Step 1: Identify Complexity
Look for components in `app/src/components/pages/` that:
- Exceed 300 lines of code.
- Have deeply nested JSX (more than 4-5 levels deep).
- Mix complex business logic (e.g., date calculations) with UI rendering.

### Step 2: Plan the Extraction
1. **Logic First**: Extract state and API orchestration into a custom hook in the `server/` directory.
2. **UI Second**: Split the JSX into logical sections (Header, Table, Dialogs).
3. **Common UI**: Move reusable elements to `app/src/components/ui/` or `app/src/components/shared/`.

### Step 3: Execute Incrementally
1. **Extract one piece at a time.**
2. **Verify functionality** manually or via `npm test` after each extraction.
3. Ensure types and imports are correctly updated.

---

## Common Mistakes to Avoid

### ❌ Over-Engineering
Don't create tiny hooks/components for simple things. If a component is 50 lines and readable, it doesn't need refactoring.

### ❌ Breaking Project Patterns
- Always follow the directory structure in `.claude/dev.md`.
- Keep API logic in the `server/` folder of the feature.
- Use standard Shadcn UI components where possible.

## References

- [Complexity Reduction Patterns](references/complexity-patterns.md)
- [Component Splitting Patterns](references/component-splitting.md)
- [Hook Extraction Patterns](references/hook-extraction.md)

### Related Skills
- `frontend-testing` - For testing refactored components with Vitest.
- `frontend-query-mutation` - For data layer patterns and contracts.
