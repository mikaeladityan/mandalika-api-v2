# Playwright Best Practices

Use this reference when writing or reviewing locator, assertion, isolation, or synchronization logic for the project's Cucumber-based E2E suite.

Official sources:
- https://playwright.dev/docs/best-practices
- https://playwright.dev/docs/locators
- https://playwright.dev/docs/test-assertions
- https://playwright.dev/docs/browser-contexts

## What Matters Most

### 1. Keep Scenarios Isolated
Playwright's model is built around clean browser contexts so one test does not leak into another. In this suite, that principle maps to per-scenario session setup in `features/support/hooks.ts`.

Apply it like this:
- Do not depend on another scenario having run first.
- Do not persist ad hoc scenario state outside the World context.
- When a flow needs special auth/session semantics, express that through tags or explicit hook changes.

### 2. Prefer User-Facing Locators
Playwright recommends built-in locators that reflect what users perceive on the page.

Preferred order:
1. `getByRole`
2. `getByLabel`
3. `getByPlaceholder`
4. `getByText`
5. `getByTestId` when an explicit test contract is the most stable option.

Avoid raw CSS/XPath selectors unless no stable user-facing contract exists.

### 3. Use Web-First Assertions
Playwright assertions auto-wait and retry. Prefer them over manual state inspection.

Prefer:
- `await expect(page).toHaveURL(...)`
- `await expect(locator).toBeVisible()`
- `await expect(locator).toBeEnabled()`
- `await expect(locator).toHaveText(...)`

Avoid:
- `expect(await locator.isVisible()).toBe(true)`
- Custom polling loops for DOM state
- `waitForTimeout` as synchronization

### 4. Let Actions Wait for Actionability
Locator actions already wait for the element to be actionable. Do not preface every click/fill with extra timing logic unless necessary for clarity.

## Review Questions
- Would this locator survive DOM refactors that do not change user-visible behavior?
- Is this assertion using Playwright's retrying semantics?
- Is any explicit wait masking a real readiness problem?
- Does this code preserve per-scenario isolation?
