# Test Generation Checklist

Use this checklist when generating or reviewing tests for frontend components.

## Pre-Generation
- [ ] Read the component source code completely.
- [ ] Identify component type (component, hook, utility, page).
- [ ] Check for existing tests in the same directory.
- [ ] **Identify ALL files in the directory** that need testing (not just index).

## Testing Strategy
- [ ] **Incremental Workflow**: Never generate all tests at once. Process one file at a time.
- [ ] Order files by complexity: utilities → hooks → simple → complex → integration.
- [ ] **Identify Dependencies**: Test dependencies before dependents.

## Complexity Assessment
- [ ] **300+ lines**: Strongly consider refactoring or splitting before testing.
- [ ] **High Complexity**: Use multiple `describe` blocks and organized structures.

## Integration vs Mocking
- [ ] **DO NOT mock base UI components** (Shadcn UI).
- [ ] Import real project components instead of mocking where possible.
- [ ] Only mock: API services, and third-party libraries with side effects (e.g., `next/navigation`).

## Required Test Sections
- [ ] **Rendering tests**: Component renders without crashing.
- [ ] **Props tests**: Required props, optional props, default values.
- [ ] **Edge cases**: null, undefined, empty values, boundaries.
- [ ] **Event handling**: User interactions (clicks, keyboard).
- [ ] **Async states**: Loading, success, error (for queries/mutations).

## Code Quality
- [ ] Uses `describe` blocks to group related tests.
- [ ] Test names follow `should <behavior> when <condition>` pattern.
- [ ] AAA pattern (Arrange-Act-Assert) is clear.
- [ ] `vi.clearAllMocks()` in `beforeEach`.
- [ ] Mock data uses actual types from source.
- [ ] Factory functions have proper return types.

## Coverage Goals (Per File)
- [ ] 100% function coverage.
- [ ] 100% statement coverage.
- [ ] >95% branch coverage.
- [ ] >95% line coverage.

## Post-Generation
- [ ] Run the specific test file: `npm test path/to/file.spec.tsx`.
- [ ] **MUST PASS** before proceeding to the next file.
- [ ] Fix any failures immediately.
