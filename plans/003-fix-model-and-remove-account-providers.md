# Fix the model and remove account-provider product paths

Status: TODO

Written against commit `62c99b4`. Complete plan 002 first.

Before editing, compare the current commit and target spec with plan 001's
recorded values. Read drift in model, provider, settings, and runner files. Stop
if multi-model or bring-your-own-provider support has been approved again.

## Goal

Expose only `opencode/deepseek-v4-flash-free`, keep thinking levels `off`,
`high`, and `max`, and remove account-provider connections from the Worker,
runner, and UI. This plan does not yet remove `DITTO_PI_CREDENTIAL`; plan 007
does that after each workspace session has a trusted sandbox identity.

## Current state

`apps/web/src/lib/agent-run-service.ts` resolves encrypted account credentials
before project and message side effects. `Composer` queries
`providerAuth.models`, keeps a selected-model preference, and renders a model
picker. Provider connection code spans Worker routes, tRPC, runner CLIs, and
Docker symlinks.

The fixed model and exact thinking levels already exist in
`apps/web/src/lib/agent-models.ts`:

```ts
export const DEFAULT_PROJECT_CODER_MODEL =
	"opencode/deepseek-v4-flash-free" as const;
export const FALLBACK_MODEL_THINKING_LEVELS = ["off", "high", "max"] as const;
```

## Files in scope

- `apps/web/src/lib/agent-models.ts` and tests
- `apps/web/src/lib/agent-run-service.ts` and tests
- `apps/web/src/lib/agent-control-service.ts` and tests
- `apps/web/src/lib/agent-stream-client.ts` and tests
- `apps/web/src/lib/user-preferences-store.ts`
- `apps/web/src/components/composer.tsx` and tests
- provider settings, provider-auth routes, protocol, client, tRPC router, and
  their tests
- `apps/web/src/integrations/trpc/router.ts`
- `apps/web/src/routes/settings.tsx`, `apps/web/src/components/nav-user.tsx`, and
  generated route output as required by the router build
- `packages/sandbox-runner/src/provider-auth*`, provider catalog code, protocol
  variants used only by provider auth, and their tests
- `packages/sandbox-runner/package.json`
- `Dockerfile`
- `README.md`, `PRODUCT.md`, `CONTEXT.md`, and affected architecture docs

Keep `ai_provider_credentials`, `provider_auth_attempts`, and
`AI_CREDENTIALS_ENCRYPTION_KEY` in the schema and deployment bindings until
plan 012. That ordering prevents an older Worker from running against removed
tables during a rolling deployment.

Do not change sandbox ownership, Git transport, backup transport, or the
OpenCode credential injection path in this plan.

## Required implementation

1. Replace syntax-only model validation with an exact literal check in both the
   Worker and runner.
2. Remove `model` from browser-controlled initial-run and follow-up payloads, or
   accept it only as an optional backward-compatibility field that must equal
   the fixed literal. Prefer removal because the product is pre-launch.
3. Keep `thinkingLevel` optional for old clients, but reject every value outside
   `off`, `high`, and `max` before project, session, or message side effects.
4. Remove the model picker and server model query. Show the fixed model name as
   non-interactive context only if the composer still needs a label.
5. Remove `selectedModel` and `setSelectedModel` from the persisted preference.
   Keep the thinking-level preference and reset an old unsupported value to a
   supported default.
6. Remove Account Settings and every provider connect, reconnect, disconnect,
   catalog, stream, and control path. If `/settings` has no remaining purpose,
   remove the route and navigation item.
7. Remove the provider-auth runner binaries and Docker assertions or symlinks.
8. Simplify agent preparation to validate `OPENCODE_API_KEY` before sandbox or
   D1 side effects, construct only the current fallback credential projection,
   and retain secret redaction until plan 007.
9. Remove dead provider encryption, OAuth refresh, and catalog implementation
   files only after `rg` proves that no remaining source imports them.

## Tests

Update the nearest existing tests. Prove:

- missing `OPENCODE_API_KEY` fails before project, session, message, or sandbox
  calls
- other model values fail at both Worker and runner seams
- only `off`, `high`, and `max` reach the runner
- Composer has no model picker or provider query
- Account Settings routes and tRPC keys are absent
- the runner package exposes no provider-auth binaries
- agent streaming, follow-up, Stop, and Git metadata behavior still pass

Use existing dependency injection in `agent-run-service.test.ts`; do not build a
second fake database framework.

## Verification

```bash
rg -n "providerAuth|provider-auth|provider-catalog|selectedModel|AI_CREDENTIALS" apps/web/src packages/sandbox-runner/src packages/sandbox-runner/package.json Dockerfile
pnpm --filter @ditto/web test -- src/lib/agent-run-service.test.ts src/components/composer.test.tsx
npm test --prefix packages/sandbox-runner -- src/runner-model.test.ts src/run-agent.test.ts src/run-git-metadata.test.ts
pnpm typecheck
pnpm runner:verify
pnpm verify
```

Expected result: the first command reports only intentionally retained schema,
migration, or transition references. All verification commands exit 0.

## Done criteria

- Browser input cannot select a model.
- Worker and runner accept only the fixed model and three thinking levels.
- Account-provider routes, UI, runner commands, and implementation code are
  gone.
- Provider tables and the encryption binding remain clearly marked for removal
  in plan 012.
- Durable docs no longer claim that account providers are available.

## Maintenance note

Adding another model or credential source requires a new request contract and a
product decision. Do not turn the fixed-model constants back into a catalog by
local extension.

## Stop conditions

- If a remaining feature uses provider-auth protocol variants for non-provider
  work, stop and split those variants before deleting the protocol file.
- If removing `/settings` would also remove an unrelated account function, keep
  the route and replace only its provider content.
