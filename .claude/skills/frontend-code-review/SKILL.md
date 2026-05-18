---
name: frontend-code-review
description: "Trigger when the user requests a review of frontend files (e.g., .tsx, .ts, .js). Support both pending-change reviews and focused file reviews while applying the checklist rules."
---

# Frontend Code Review

## Intent
Use this skill whenever the user asks to review frontend code (especially `.tsx`, `.ts`, or `.js` files). Support two review modes:

1. **Pending-change review** – inspect staged/working-tree files slated for commit and flag checklist violations before submission.
2. **File-targeted review** – review the specific file(s) the user names and report the relevant checklist findings.

## Checklist

### 1. Project Patterns
- **Directory Structure**: Does the file follow the `app/src/app/...` or `app/src/components/pages/` pattern?
- **Server Layer**: Are services and hooks correctly placed in a `server/` subdirectory?
- **DTO Usage**: Does the component use Zod-validated DTOs for data interaction?

### 2. React & Next.js Best Practices
- **Hooks**: Are hooks extracted if complexity is high (> 300 lines)?
- **Performance**: Are `useMemo` and `useCallback` used appropriately for expensive operations or stable callbacks?
- **Hydration**: Are there any potential hydration mismatches (e.g., using `new Date()` directly in render)?

### 3. Styling & UI
- **Tailwind/CSS**: Does it use the project's standard CSS patterns?
- **Shadcn UI**: Are standard UI components (`Card`, `Button`, `DataTable`) used instead of custom raw elements where applicable?

### 4. Technical Quality
- **Types**: Is the code properly typed? Avoid using `any` unless absolutely necessary.
- **Error Handling**: Are API calls wrapped in proper error handling (e.g., Sonner toasts for mutations)?

## Review Process
1. Analyze the code for logic errors, pattern violations, and styling inconsistencies.
2. Group findings into **Urgent Issues** (bugs, security, pattern breaks) and **Suggestions** (readability, minor perf).
3. Provide clear, actionable suggested fixes for each finding.

## Required Output Format

### If issues are found:
```
# Code Review
Found <N> urgent issues:

## 1 [Issue Title]
FilePath: <path> line <line>
<relevant snippet>

### Suggested Fix
<fix code or description>

---

Found <M> suggestions for improvement:
...
```

### If no issues are found:
```
# Code Review
No issues found.
```

