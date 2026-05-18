# Testing Workflow Guide

This guide defines the workflow for generating frontend tests, especially for complex directories with multiple files.

## Scope Clarification
- **Single file**: Process one test file at a time, aiming for full coverage (100% function, >95% branch).
- **Multi-file directory**: Process one file at a time, verify each passes before proceeding to the next.

## ⚠️ Critical Rule: Incremental Approach
When testing a directory with multiple files, **NEVER generate all test files at once.** 

### Step 1: Analyze and Plan
1. **List all files** that need tests in the directory.
2. **Order by dependency**: Test utility functions, then hooks, then components.
3. **Complexity Check**: Components over 300 lines should be considered for refactoring before testing.

### Step 2: Process Incrementally
For EACH file in the ordered list:
1. Write the test file.
2. Run: `npm test path/to/file.spec.tsx`.
3. If FAIL → Fix immediately, re-run.
4. If PASS → Proceed to the next file.

**DO NOT proceed until the current file's tests pass.**

### Step 3: Final Verification
After all individual tests pass, run all tests in the directory:
```bash
npm test path/to/directory/
```

## Common Pitfalls
- **Generating everything at once**: Leads to compounding failures and difficult debugging.
- **Skipping simple files**: Simple files often have the most critical utility logic that others depend on.
- **Ignoring failures**: Moving past a failing test creates technical debt that is harder to fix later.
