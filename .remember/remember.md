# Handoff

## State
Docs restructure in progress on branch `staging`. Old per-module nested docs (`docs/modules/{auth,inventory-v2,manufacturing,product,purchasing}/ENDPOINT.md|FRONTEND_INTEGRATION.md|ROADMAP.md` etc.) deleted. New flat layout staged: top-level guides (`API_REFERENCE.md`, `ARCHITECTURE.md`, `AUTH.md`, `CONVENTIONS.md`, `DATABASE.md`, `DEPLOYMENT.md`, `DOCUMENT_NUMBERING.md`, `ERROR_HANDLING.md`, `OBSERVABILITY.md`) plus one-file-per-module under `docs/modules/*.md`. `docs/README.md` and `docs/TESTING.md` modified. Nothing committed yet.

## Next
1. Review new docs content for accuracy vs current code (esp. auth, inventory-v2, manufacturing, purchasing).
2. Stage + commit docs restructure — single commit, conventional message (`docs: flatten module docs structure`).
3. Verify no code references old deleted paths (`grep -r "docs/modules/.*/ENDPOINT.md"`).

## Context
- Project uses RTK prefix for all shell commands (token savings) — see `.claude/CLAUDE.md`.
- Caveman mode active full level this session.
- Main branch is `main`; currently on `staging`.
- User asked no clarifying questions during session — went straight to /remember.
