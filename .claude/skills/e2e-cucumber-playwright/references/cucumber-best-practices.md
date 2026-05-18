# Cucumber Best Practices

Use this reference when writing or reviewing Gherkin scenarios or step definitions for the project's E2E suite.

Official sources:

- https://cucumber.io/docs/gherkin/reference/
- https://cucumber.io/docs/cucumber/step-definitions/
- https://cucumber.io/docs/cucumber/api/?lang=javascript

## Organized Testing
Group scenarios by feature area and use tags to control execution scope (e.g., `@smoke`, `@regression`).

If a proposed tag implies behavior, verify that hooks or runner configuration actually implement it.

## Review Questions

- Does the scenario read like a real example of product behavior?
- Are the steps behavior-oriented instead of implementation-oriented?
- Is a reused step still truthful in this feature?
- Is a new tag documenting real behavior, or inventing semantics that the suite does not implement?
- Would a new reader understand the outcome without opening the step-definition file?
