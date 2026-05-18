# Rule Catalog — Business Logic

## Component Isolation

### Description
Components should be isolated from global stores or providers that may not be available in all contexts (e.g., template previews or different page routes).

### Suggested Fix
Prefer passing data through props or using context providers that are guaranteed to exist in all usage scenarios.
