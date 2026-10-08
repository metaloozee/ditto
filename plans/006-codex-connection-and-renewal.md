# 006: Establish Codex connection support and credential ownership

Status: DONE for the [independently accepted fixture-backed local scope](evidence/006-advisor-final-review.md), integrated into `feat/pi-durable` at `e43d2609cab0e3580043d8f365b4e34cc690d40c`. Source commit: `3a70355b8d3772d53255d39bb79fc7aaf56f4951`. All three initial review blockers are fixed; [integration and cleanup](evidence/006-integration.md) preserve source identities and evidence. Historical execution base: `ef172ef`. Historical readiness base: `432e332bbcb9a9361612e30a052c479604e621a8`. Historical planning base: `bcce03e`. Phase: L3, privileged access.

The [005 integration](evidence/005-integration.md) supplies accepted L2. The [Codex contract](evidence/006-codex-contract.md) documents public-source evidence and unresolved Ditto hosted support. Live connection and renewal remain disabled; PD38 is `not run`. The separate product Workers test package resolves the Vitest 4/3 compatibility gate without changing existing resolutions. Independent credential, runtime and repository checks pass, including revision substitution and bounded-denial regressions. This acceptance does not complete L3 or authorize live-provider use, existing-environment migrations, deployment, staging or commit.
Spec: `docs/specs/pi-durable-session-runtime.md`, decisions 1, 3.1–3.2, 4, 6, 12, 17–18; PD01, PD28, PD41; OD1, OD5–OD7.

## Outcome

Prove a supported authentication/discovery design, then implement one product-side credential DO per connected user. It stores encrypted access, refresh and retained identity tokens and serializes renewal across workspace requests. Runtime Workers and execution sandboxes receive responses, never subscription credentials. This DO does not run Pi or own task/conversation state.

This is fixture-backed engineering work. Actual subscription authentication or spending requires separate approval and plan 020. Do not infer a ban on hosted Codex access from unrelated Sign in with ChatGPT rules; equally, do not assume another application's client ID or loopback flow authorizes Ditto.

## Current state and scope

`alchemy.run.ts` currently binds `BETTER_AUTH_SECRET`, GitHub secrets and `OPENCODE_API_KEY` to the product Worker. `apps/web/src/lib/session-runtime-product.ts` demonstrates the private product entrypoint pattern:

```ts
export class ProductEntrypoint extends WorkerEntrypoint<Env> {
```

No Codex credential module exists at base. Export the credential DO only from the product Worker composition in `apps/web/src/server.ts`, not `apps/runtime/src/server.ts` or its stub ProductEntrypoint. Update Alchemy's product DO bindings and append a new SQLite migration tag without replacing the existing Sandbox migration. The product credential DO performs credential-bearing fetch; callers submit validated operation data, never tokens or arbitrary Authorization headers. Preserve Ditto's GitHub sign-in, which authenticates the product user independently of the new model connection. Use the existing product-owned crypto patterns only after separating key purpose and AAD; do not pass the authentication secret to the runtime.

Allowed: new focused Codex credential module/DO and backend handlers under `apps/web/src`, product schema and generated migrations for ownership/status, narrow shared data contracts, product binding/types in Alchemy and tests. D1 stores ownership/status projections, not the token source of truth. New migration files are code artifacts; applying migrations to any existing environment is not authorized. UI connection controls belong to 018.

## Steps

1. Review current official Codex authentication, provider rules and pinned Pi provider implementation. Record supported client identity, redirect/device flow, local and hosted callback requirements, token lifecycle and account-backed discovery/validation method under `plans/evidence/006-codex-contract.md`, with sources and unknowns. Do not implement a guessed public callback or copy a foreign client identity. If local/hosted support cannot be established, isolate the uncertain part and keep its status blocked. Pure fixture contract work can continue without claiming live support.
   Check: a written contract with separate known, fixture-tested and externally unverified facts, plus `pnpm --filter @ditto/web typecheck` after types are added.
2. Implement owned connect/status/disconnect operations using existing authentication/ownership seams. Add a callback/device/loopback route only if step 1 identifies that exact supported flow, client identity and endpoints. For a proved callback flow, validate state/expiry and single use. If support is unresolved, implement only fixture token persistence/renewal and keep live connection endpoints unavailable. Store encrypted credentials only in the credential DO, with unique nonces and owner/record/version AAD, product-only keyring and historical-key handling. Use a separate product credential key, not the runtime key. Persist only bounded non-secret connection status in D1.
   Add `apps/web/src/lib/codex-connection.test.ts`. Run `pnpm --filter @ditto/web exec vitest run src/lib/codex-connection.test.ts`; foreign/missing auth and reused/expired callback fixtures must produce no credential writes or requests.
3. Serialize renewal for two workspace sessions of the same user using durable renewal/connection generations, not an in-memory mutex alone. Persist rotated credential replacement atomically, prevent a late old refresh result overwriting a newer connection, and handle disconnect/revoke racing renewal. A crash after upstream rotation but before durable replacement may require reconnect if the provider offers no safe reconciliation. Never blindly retry a possibly spent one-use refresh token or invent exactly-once renewal. Persist a revoked connection generation and product-side revocation fence; either denial blocks requests. A late refresh cannot clear either or recreate a deleted projection. Reconnection is a new explicit owned action, not revival by a stale refresh.
   Same command with deterministic token fixtures and crash points. Add a product-only Workers test entry/config, for example `apps/web/vitest.credential-workers.config.ts`, and `apps/web/src/lib/codex-credential-do.worker.test.ts`. It loads the credential DO and disposable SQLite without the runtime Worker or live credentials. Run `pnpm --filter @ditto/web exec vitest run --config vitest.credential-workers.config.ts src/lib/codex-credential-do.worker.test.ts`. Resolve the Workers-pool/Vitest compatibility before adding dependencies; if web Vitest 4 is unsupported, use an isolated compatible product test package/config and restamp the exact command rather than upgrading the whole app or moving the DO into the runtime. Register it in verification.
4. Return only safe connection/account-capability results to the product/runtime. Reject execution/builder callers and caller-supplied owner IDs as authority. Fresh authority checks must not be extended by cache lifetime. Ensure no token enters logs, D1 projections, runtime bindings, sandbox environment or error output.
   Same command; extend forbidden-binding/import tests and run `pnpm runtime:verify`.
5. Record code-level acceptance, missing external evidence and exact local commands. Run `pnpm verify`; credential DO tests must be wired into repository verification once added. Keep PD38 `not run` without approval.

## Done and stop

Owned connection state, encrypted storage, cross-workspace renewal and revoke races pass through product operations and real local SQLite. The supported auth method is documented; any unverified provider/host condition remains explicit and blocks claims of live support. No API-key billing fallback, Codex CLI engine or token-returning extension.

Before execution, refresh paths and concrete contracts from 004/005 without changing state ownership. Stop if completing the design requires credentials in the runtime or unsupported client/callback behavior. No reset, deployment, live allowance, staging or commit is authorized. Future credential renewal changes must rerun crash and cross-workspace cases, not only a happy-path login.
