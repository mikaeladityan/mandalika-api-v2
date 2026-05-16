---
name: frontend-testing
description: Generate Vitest + React Testing Library tests for the frontend components, hooks, and utilities. Triggers on testing, spec files, coverage, Vitest, RTL, unit tests, integration tests, or write/review test requests.
---

# Frontend Testing Skill

This skill enables the generation of high-quality frontend tests using Vitest and React Testing Library (RTL).

## When to Apply This Skill

Apply this skill when the user asks to:
- **Write tests** for a component, hook, or utility.
- **Review existing tests** for completeness or bug detection.
- Improve **test coverage**.
- Use **Vitest** or **React Testing Library** patterns.

## Quick Reference

### Tech Stack

| Tool | Purpose |
|------|---------|
| Vitest | Test runner (consistent with backend) |
| React Testing Library | Component and Hook testing |
| jsdom | Test environment |
| TypeScript | Type safety |

### Key Commands

```bash
# Run all tests (from app/ directory)
npm test

# Run specific file
npx vitest path/to/file.test.tsx
```

### File Naming & Placement

- **Test files**: `[filename].test.tsx` or `[filename].test.ts`.
- **Placement**: Place tests in a sibling `__tests__/` directory relative to the file being tested, or in `app/src/tests/` for shared utilities.

## Test Structure Template

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MyComponent } from './index'

// ✅ Mock external dependencies (Next.js, API Services)
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/test',
}))

describe('MyComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render correctly with props', () => {
    render(<MyComponent title="Test Title" />)
    expect(screen.getByText('Test Title')).toBeInTheDocument()
  })

  it('should handle user interactions', async () => {
    const handleClick = vi.fn()
    render(<MyComponent onClick={handleClick} />)
    
    fireEvent.click(screen.getByRole('button'))
    expect(handleClick).toHaveBeenCalledTimes(1)
  })
})
```

## Testing Workflow

1. **Analyze**: Identify the inputs (props, context) and outputs (rendered text, called functions) of the component.
2. **Setup**: Mock external services and providers (e.g., TanStack Query providers if testing a component that uses hooks).
3. **Execute**: Use the AAA pattern (Arrange, Act, Assert).
4. **Verify**: Ensure the test passes and covers edge cases (loading, error, empty states).

## Best Practices

- **Avoid Testing Implementation**: Test what the user sees (text, roles) rather than internal state.
- **Use Semantic Queries**: Prefer `getByRole`, `getByLabelText`, and `getByPlaceholderText`.
- **Mock Selectively**: Only mock external systems (API, Router). Do not mock sub-components unless they are extremely complex or slow.
- **Pattern Matching**: Use regex/case-insensitive matching for text `expect(screen.getByText(/loading/i)).toBeInTheDocument()`.

Treat this skill as the guide for ensuring frontend code reliability and regressions prevention.
