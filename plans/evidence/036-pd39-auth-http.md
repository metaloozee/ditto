# 036 PD39 real-auth HTTP smoke evidence

Command: `pnpm --filter @ditto/credential-tests exec vitest run src/pi-durable-auth-http.worker.test.ts`
Result: 25 passed (25).

Real Better Auth `getSession` runs on real signed cookies against a real local D1. Only `@tanstack/react-router` is mocked, to capture the route handlers.

## Status table

| Route | Missing | Expired | Tampered | Foreign / fabricated session | Valid owner |
|---|---|---|---|---|---|
| control POST | 401 | 401 | 401 | n/a | n/a |
| observe POST | 401 | 401 | 401 | 503 `runtime_unavailable` | n/a |
| workspace-action POST | 401 | 401 | 401 | 503 `runtime_unavailable` | n/a |
| models POST | 401 | 401 | 401 | 503 `runtime_unavailable` | n/a |
| stream GET | 401 | 401 | 401 | n/a | n/a |
| stream POST (prompt) | 401 | 401 | 401 | 503 `runtime_unavailable` | 202, 1 `session_commands` row |

Every non-valid case also asserts zero rows in workspace_sessions, sandbox_identities, session_commands, messages, workspace_runtime_work, candidate_workspace_claims, runtime_command_memberships and privileged_operations.

The plan expected `model_unconfigured` for the foreign prompt. Through the `CandidateProduct` service binding the fixture's `CandidateCommandError` loses its class, so the route returns 503 `runtime_unavailable`. That is the pinned behavior; it is still non-2xx with no writes.

## Deliberate-failure checks

- Cookie signed with `"wrong-secret"`: failed as intended (6 tests red, including "signed test cookie is accepted" and the valid prompt case).
- Past-expiry update skipped: failed as intended (all 6 "expired session" cases red).

Both edits were reverted and not committed.

## Deviations

- Step 1 fallback (mocking `better-auth/tanstack-start`): not used.
- The `@tanstack/react-router` mock targets `../../web/node_modules/@tanstack/react-router` because the credential-tests package does not depend on it.
- Web modules (`lib/auth.ts` and the route files) are loaded by absolute path through `import()` so the package's `tsc` does not typecheck the web app's `Env` and route-tree types.
- The `session.expiresAt` column stores whole seconds, so the expiry helper writes `floor(ms / 1000)`.
- Setup also installs the `CandidateCredential` fixture DO, which the valid prompt needs.

## Case 5

The valid owner case is fixture-backed admission (the `CandidateFixtureProduct` binding), with authentication real throughout.
