# Mocking Guide for Frontend Tests

## ⚠️ Important: What NOT to Mock

### DO NOT Mock Base UI Components
Never mock standard UI components from `@/app/src/components/ui/` (Shadcn UI) such as:
- `Button`, `Input`, `Select`, `Dialog`, `Badge`

**Why?**
- These components are the building blocks of the UI. Mocking them misses visual integration issues.
- They are simple enough that rendering them doesn't add significant overhead.

## What TO Mock

Only mock these categories to keep tests fast and deterministic:
1. **API Services**: Classes that perform network calls (e.g., `ForecastService`).
2. **Third-party libraries with side effects**: `next/navigation`, `next/image`, etc.
3. **Complex External SDKs**: Maps, charts, or heavy third-party widgets.

## Mock Placement

| Location | Purpose |
|----------|---------|
| `tests/setup.ts` | Global mocks (e.g., `next/navigation`). |
| Test file | Test-specific mocks using `vi.mock()`. |

## Essential Mocks

### 1. Next.js Router
```typescript
const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => '/current-path',
  useSearchParams: () => new URLSearchParams('?key=value'),
}))
```

### 2. API Services (Axios based)
Mock the entire service class to control response data.
```typescript
import { ForecastService } from '@/app/(application)/forecasts/server/forecast.service'

vi.mock('@/app/(application)/forecasts/server/forecast.service')

const mockedService = vi.mocked(ForecastService)

describe('Forecast Component', () => {
  it('should display data from service', async () => {
    mockedService.getList.mockResolvedValue([{ id: 1, name: 'Product A' }])
    
    render(<ForecastList />)
    
    await waitFor(() => {
      expect(screen.getByText('Product A')).toBeInTheDocument()
    })
  })
})
```

### 3. Jotai (Atomic State)
Jotai values can often be tested without mocking by wrapping the component in a `Provider`.
```typescript
import { Provider } from 'jotai'
import { myAtom } from './atoms'

render(
  <Provider initialValues={[[myAtom, 'test-value']]}>
    <MyComponent />
  </Provider>
)
```

## Mock Best Practices

### ✅ DO
1. **Use factory functions** for mock data (e.g., `createMockProduct()`).
2. **Reset mocks** in `beforeEach` via `vi.clearAllMocks()`.
3. **Mock high-level services**, not low-level axios calls, to keep tests resilient to API changes.

### ❌ DON'T
1. **Don't mock base UI components**.
2. **Don't use `any`** in your mocks; use `Partial<T>` if you only need a subset of properties.
3. **Don't forget to await** async operations after triggering an action that calls a mocked service.
