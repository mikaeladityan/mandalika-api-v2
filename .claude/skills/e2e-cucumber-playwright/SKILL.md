---
name: e2e-cucumber-playwright
description: Write, update, or review end-to-end tests using Cucumber, Gherkin, and Playwright. Use when the task involves .feature files, features/step-definitions/, or E2E testing best practices for this repository.
---

# E2E Testing (Cucumber + Playwright) Skill

This skill enables the creation and maintenance of End-to-End (E2E) tests for the ERP system.

## When to Apply This Skill
- Creating new `.feature` files for user stories.
- Updating **Step Definitions** in `features/step-definitions/`.
- Troubleshooting failed E2E test runs.
- Reviewing E2E test coverage for a feature.

## Tech Stack
- **Cucumber**: For Gherkin-based test specification.
- **Playwright**: For browser automation and assertions.
- **Node.js**: The underlying runtime.

## Workflow

   - Scope locators to stable containers when the page has repeated elements.
   - Avoid page-object layers or extra helper abstractions unless repeated complexity clearly justifies them.
4. Use Playwright in the local style.
   - Prefer user-facing locators: `getByRole`, `getByLabel`, `getByPlaceholder`, `getByText`, then `getByTestId` for explicit contracts.
   - Use web-first `expect(...)` assertions.
   - Do not use `waitForTimeout`, manual polling, or raw visibility checks when a locator action or retrying assertion already expresses the behavior.
5. Validate narrowly.
   - Run the narrowest tagged scenario or flow that exercises the change.
   - Run `npm test:e2e` (or equivalent).
   - Broaden verification only when the change affects hooks, tags, setup, or shared step semantics.

## Review Checklist

- Does the scenario describe behavior rather than implementation?
- Does it fit the current session model, tags, and World context usage?
- Should an existing step be reused instead of adding a new one?
- Are locators user-facing and assertions web-first?
- Does the change introduce hidden coupling across scenarios, tags, or instance state?
- Does it document or implement behavior that differs from the real hooks or configuration?

Lead findings with correctness, flake risk, and architecture drift.

## References

- [`references/playwright-best-practices.md`](references/playwright-best-practices.md)
- [`references/cucumber-best-practices.md`](references/cucumber-best-practices.md)
