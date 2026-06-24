# Implementation Plans

Generated on 2026-06-24. Execute in the order below unless dependencies say otherwise. Each executor: read the plan fully before starting, honor its STOP conditions, and update your row when done.

## Execution order & status

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| 001 | Implement the GitHub App Auth Flow | P1 | M | — | TODO |
| 002 | Database Schema and tRPC Projects | P1 | S | 001 | TODO |
| 003 | Sandbox Provisioning and Bootstrap | P1 | M | 001, 002 | TODO |

Status values: TODO | IN PROGRESS | DONE | BLOCKED (with one-line reason) | REJECTED (with one-line rationale — finding fixed independently or approach abandoned)

## Dependency notes

- 002 depends on 001 because it maps the repository and installation data established during App authorization.
- 003 depends on 001 and 002 because sandbox bootstrapping requires the App token generator (001) and database project metadata records (002) to function.

## Verification baseline

Use these commands when executing plans:

- `pnpm exec tsc --noEmit` — passes typechecking.
- `pnpm lint` — checks linting warnings.
- `pnpm test` — runs unit tests.
