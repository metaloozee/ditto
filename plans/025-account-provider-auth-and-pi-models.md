# Plan 025: Persist account provider credentials and run PI with connected models

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. This is an authentication and secret-handling change: do not take
> shortcuts around credential isolation, encryption, redaction, refresh
> serialization, or cleanup. If anything in "STOP conditions" occurs, stop and
> report instead of improvising. When done, update this plan's row in
> `plans/README.md` unless a reviewer says they maintain the index.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat 58fa3a7..HEAD -- \
>   alchemy.run.ts README.md Dockerfile \
>   apps/web/package.json apps/web/src apps/web/migrations apps/web/types \
>   packages/sandbox-runner/package.json \
>   packages/sandbox-runner/package-lock.json \
>   packages/sandbox-runner/src docs/architecture
> ```
>
> The drift command intentionally uses broad package directories so newly added
> nearby auth/model code is visible. Only changes overlapping the explicit Scope
> list require excerpt comparison; unrelated package changes are context, not an
> automatic STOP. Preserve compatible changes, but STOP if PI's auth API, the
> Worker-to-runner protocol, the D1 ownership model, or the current agent
> lifecycle no longer matches this plan.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: none; plans 001–024 are DONE
- **Category**: direction / security
- **Planned at**: commit `58fa3a7`, 2026-07-17
- **Execution status**: DONE — approved on branch
  `advisor/025-account-provider-auth-and-pi-models` at `0415798` and merged into
  master at `e2500df`. Independent `pnpm verify` passed with 426 app tests and
  42 runner tests. The Docker image, provider CLI gate, and local Alchemy
  auth-only catalog sandbox gate passed. External live-provider login/run rows
  are `NOT RUN` because no replaceable credentials were available; no cloud
  deployment was performed.

## Why this matters

Ditto currently has one deployment-wide OpenCode Go credential and four
hardcoded models. Users cannot connect their own API providers or PI-supported
subscriptions, and credentials cannot follow a user across projects or
sandboxes.

After this plan, provider connections belong to the signed-in **account**: one
encrypted credential per `(userId, providerId)` in D1, available to every
project and every sandbox owned by that user. Project rows, project environment
variables, sandbox files, PI `auth.json`, R2 backups, and browser storage must
never become credential authorities.

Users without a connected provider retain a zero-cost default through OpenCode
Zen. The exact PI 0.80.10 identifier is
`opencode/deepseek-v4-flash-free` (display name `DeepSeek V4 Flash Free`), not
`opencode-go/deepseek-v4-flash`. It still requires Ditto's deployment-level
`OPENCODE_API_KEY`; "free" describes the model's token cost, not anonymous
provider access.

## Locked product and architecture decisions

1. **Account scope is an invariant.** Credentials are keyed by user and provider
   only. They have no `projectId`, `sandboxId`, or workspace-session foreign key.
   Connecting once makes the provider available in every current and future
   project/sandbox for that account.
2. **D1 is credential authority.** Sandboxes receive only ephemeral auth for one
   attempt or process. Destroying/recreating a project or auth sandbox must not
   disconnect the provider.
3. **Plan 025 has an explicit portable-provider matrix.** Encode this exact
   `providerId -> allowed auth types` table in one server/runner-tested constant:

   | Provider ID | Allowed auth |
   |---|---|
   | `anthropic` | `api_key`, `oauth` |
   | `openai` | `api_key` |
   | `openai-codex` | `oauth` only |
   | `xai` | `api_key`, `oauth` |
   | `github-copilot` | `oauth` only |
   | `opencode` | `api_key` |
   | `opencode-go` | `api_key` |
   | `deepseek` | `api_key` |
   | `google` | `api_key` |
   | `mistral` | `api_key` |
   | `groq` | `api_key` |
   | `cerebras` | `api_key` |
   | `openrouter` | `api_key` |
   | `vercel-ai-gateway` | `api_key` |
   | `fireworks` | `api_key` |
   | `together` | `api_key` |

   Reject PI login branches requiring ambient files, cloud profiles, ADC, or
   host-local credential tools; those violate account-level D1 portability.
   Radius/dynamic gateways are deferred until credential-scoped network catalog
   refresh is designed. An unlisted provider/auth method is unavailable, not
   auto-enabled; if a listed provider's PI auth shape changes, STOP for API
   drift.
4. **Do not reuse better-auth's `account` table.** It belongs to application
   sign-in identity and GitHub OAuth. Add a separate Ditto-owned provider table.
5. **Do not reuse `projects.envVars`.** Provider credentials are not project
   configuration and must not be copied once per project.
6. **Use PI's public provider-owned auth API.** Upgrade both runner PI packages
   together to exact version `0.80.10`, migrate from `AuthStorage` /
   `ModelRegistry` to `ModelRuntime`, and drive
   `ModelRuntime.login(providerId, authType, interaction)` in a Node auth runner.
   Do not copy PI's OAuth client IDs, token endpoints, or refresh logic into the
   app.
7. **Full credentials run only in an auth-only sandbox.** Login and expired-token
   refresh use a generated, single-attempt sandbox with no repository/worktree,
   rooted in `/tmp`, destroyed after completion. Never write credentials under
   `/workspace`; auth/result/control files are mode `0600` and deleted in
   `finally`; no auth sandbox is included in project R2 backup.
8. **Credentials never cross a client-visible stream.** Auth SSE may contain
   provider metadata, prompt metadata, device codes, validated auth URLs,
   progress, and terminal status. It must never contain API keys, access tokens,
   refresh tokens, serialized PI credentials, PI exception details, causes,
   stacks, or upstream response bodies. Map PI failures to stable internal codes
   and generic user messages.
9. **Project runners receive the minimum runtime credential.** Stored D1 OAuth
   credentials remain lossless, including unknown PI fields. Runtime projection
   is provider-specific and allowlisted: `anthropic`/`xai` receive only
   `type`, `access`, `expires`, and a refresh sentinel; `openai-codex` also
   receives `accountId`; `github-copilot` also receives only the verified
   `enterpriseUrl` and `availableModelIds` fields needed by PI. API-key runtime
   projection is only `type`, `key`, and canonical provider `env`. Unknown
   stored fields never enter a project sandbox; if a future PI `toAuth` requires
   another field, STOP as PI drift and extend the allowlist deliberately. The
   auth service keeps real OAuth refresh tokens in D1/auth-only sandbox.
   API-key providers necessarily receive the user's API key under the existing
   documented threat model. The runner parses the
   dedicated environment value and deletes it from `process.env` before creating
   `ModelRuntime`, `AgentSession`, or bash-capable tools. This prevents normal
   tool inheritance but is not a claim that secrets are hidden from arbitrary
   same-container peer processes; eliminating that exposure requires a Worker
   model proxy and is out of scope.
10. **No PI `auth.json`.** Agent and auth runners use a seeded
    `InMemoryCredentialStore` with `modelsPath: null`. Existing
    `/workspace/.ditto/pi-agent` remains for PI resources/session behavior, but
    provider auth is never persisted there.
11. **Refresh is distributed and serialized.** Define constants satisfying
    `AUTH_RESOLUTION_TIMEOUT_MS + AUTH_PROCESS_KILL_GRACE_MS < LEASE_TTL_MS` and
    a bounded `LEASE_WAIT_MS`. PI's `CredentialStore.modify()` runs only while
    the D1 lease is held. On timeout the Worker terminates and awaits auth-runner
    exit before lease expiry/release. A second acquirer cannot refresh while the
    first process remains alive. Do not substitute optimistic retry/CAS that may
    call an upstream rotating-refresh endpoint twice.
12. **Disconnect/reconnect linearize with the same lease.** Disconnect acquires
    the provider lease, then deletes. A refresh write is update-only and can
    never recreate a deleted row. A run that already copied runtime auth may
    finish; later runs cannot load it. A stale refresh from before reconnect
    cannot overwrite the newly connected credential.
13. **OpenCode fallback is always available.** If no account credential exists
    for the selected `opencode` provider/model, Ditto may supply its operator
    `OPENCODE_API_KEY`, but only for
    `opencode/deepseek-v4-flash-free`. A user's own `opencode` credential takes
    precedence when present. The operator key must not unlock other OpenCode
    models. Both `OPENCODE_API_KEY` and `AI_CREDENTIALS_ENCRYPTION_KEY` must be
    nonempty, and the encryption key must differ from `BETTER_AUTH_SECRET`; fail
    closed in configuration and credential-service tests.
14. **Connected-provider models are server-authoritative and safely projected.**
    Persist/expose only bounded `{providerId, modelId, name, input, reasoning,
    contextWindow, maxTokens, cost}` fields. Reject unknown fields, duplicates,
    provider mismatches, oversized catalogs, headers, base URLs, and transport
    or auth configuration. The browser may cache only the selected model.
15. **Credential health gates availability.** A `needs_relogin` row remains
    encrypted for explicit reconnect but contributes no models and cannot start
    a run. Return a stable 409 requiring reconnect; do not repeatedly retry its
    failed refresh. Only successful reconnect clears the state.
16. **Current-run semantics are stable.** Disconnecting a provider while a run is
    active affects future runs only. Follow-ups continue through the already
    authenticated in-memory PI session and cannot change model.
17. **Claude limitation is accepted.** Anthropic's PI login is Node-only and uses
    a fixed localhost callback. Ditto presents the auth URL, then asks the user
    to paste the final redirect URL/code when the remote browser cannot reach
    that localhost callback. Do not build an app-owned Anthropic OAuth clone.
    Copy must explain that PI documents Claude Pro/Max use as Anthropic extra
    usage billed per token rather than ordinary plan-limit usage.
18. **Prefer device flows.** Select OpenAI Codex device-code login automatically;
    xAI and GitHub Copilot already use device flows. Preserve Copilot's optional
    enterprise-domain prompt. Validate auth-event URLs server-side against a
    provider-specific host policy; unknown hosts are rejected or rendered as
    non-clickable text. A Copilot Enterprise host must equal the normalized host
    supplied for that attempt.
19. **Alchemy remains deployment owner.** Reuse the existing Sandbox binding and
    image. Do not add SST, Wrangler-owned resources, a separate OAuth service,
    or a second deployment system.

## Current state

### Repository and runtime

- Root `package.json` owns `pnpm verify`; `apps/web` is the only pnpm workspace
  package; `packages/sandbox-runner` is an independent npm package.
- Full verification is:

  ```bash
  pnpm verify
  ```

  It runs Biome check, app typecheck/tests/build, then runner typecheck/tests/build.
- Runner/image changes require rebuilding the root Docker image by restarting
  `pnpm dev` or redeploying with Alchemy.

### Current model restriction

`apps/web/src/lib/agent-models.ts:1-40` is a compile-time OpenCode Go allowlist:

```ts
export const PROJECT_CODER_MODELS = [
  {
    id: "opencode-go/deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    provider: "opencode-go",
    providerName: "OpenCode Go",
  },
  // three more opencode-go models
] as const;

export const DEFAULT_PROJECT_CODER_MODEL = PROJECT_CODER_MODELS[0].id;
```

`apps/web/src/lib/agent-run-service.ts:39-46` rejects everything else before
business logic:

```ts
export const agentStreamBodySchema = z.object({
  projectId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  message: z.string().trim().min(1),
  model: z.string().min(1).refine(isProjectCoderModelSpecifier, {
    message: "Invalid model.",
  }),
});
```

The same static guard is used for follow-ups in
`apps/web/src/lib/agent-control-service.ts:20-29`.

The selected model is browser-local Zustand state in
`apps/web/src/lib/user-preferences-store.ts:14-29`. That remains preference
state only; it must not become auth state.

### Current credential path

`alchemy.run.ts:56` binds one operator secret:

```ts
OPENCODE_API_KEY: alchemy.secret(process.env.OPENCODE_API_KEY),
```

`apps/web/src/lib/agent-run.ts:94-105` injects that value into the sandbox shell:

```ts
const shell = await sandbox.createSession({
  id: `agent-${options.conversationId}`,
  cwd: options.cwd,
  env: {
    ...projectEnv,
    OPENCODE_API_KEY: options.env.OPENCODE_API_KEY,
    DITTO_GIT_CALLBACK_URL: agentGitCallbackUrl(options.env),
    DITTO_GIT_CALLBACK_TOKEN: gitCallbackToken,
    ...dittoGitAuthorEnv(),
  },
});
```

The job JSON contains prompt/model/cwd but no credential. Preserve that
property.

`packages/sandbox-runner/src/run-agent.ts:83-116` uses PI 0.80.3's legacy API
and leaves the key in process environment:

```ts
const authPath = path.join(options.agentDir, "auth.json");
const authStorage = AuthStorage.create(authPath);
if (process.env.OPENCODE_API_KEY) {
  authStorage.setRuntimeApiKey("opencode-go", process.env.OPENCODE_API_KEY);
}
const modelRegistry = ModelRegistry.create(authStorage);
// ...
await createAgentSession({ authStorage, modelRegistry, ... });
```

`packages/sandbox-runner/package.json:17-18` pins both PI packages to `0.80.3`.
PI 0.80.10 replaces those session options with `modelRuntime` and adds xAI
subscription OAuth.

### Existing account and secret storage

`apps/web/src/db/schema.ts:157-181` defines better-auth's `account` table with
OAuth token columns. It is not Ditto's AI-provider store and must remain
unchanged except for generated relation effects, if any.

`projects.envVars` at `apps/web/src/db/schema.ts:60` is project-scoped. Its
values are encrypted with `encryptText` / `decryptText` from
`apps/web/src/lib/crypto.ts`, and the UI returns keys only. Reuse the crypto
primitive and write-only UI pattern, but use a new deployment secret and
user/provider additional authenticated data.

Current AES-GCM code at `apps/web/src/lib/crypto.ts:61-112` has no associated
context:

```ts
export async function encryptText(plaintext: string, secret: string) {
  // random salt + IV, PBKDF2-SHA-256, AES-256-GCM
}

export async function decryptText(payload: string, secret: string) {
  // validates version and decrypts
}
```

Extend it compatibly: existing project-env payloads must still decrypt, while
provider credentials bind AES-GCM additional data to a stable string containing
both `userId` and `providerId`.

### Existing orchestration patterns to follow

- Direct authenticated streaming route:
  `apps/web/src/routes/api.agent.stream.ts`.
- Thin route + injected domain service:
  `apps/web/src/lib/agent-run-service.ts` and its test.
- Authenticated live control through a bounded `/tmp` job and Unix socket:
  `apps/web/src/lib/agent-control-service.ts`,
  `packages/sandbox-runner/src/control-channel.ts`, and their tests.
- Strict versioned runner NDJSON:
  `packages/sandbox-runner/src/protocol.ts` and
  `apps/web/src/lib/agent-stream-protocol.ts`.
- Keys-only/write-only secret UI:
  `apps/web/src/components/project-settings-dialog.tsx` and
  `apps/web/src/integrations/trpc/routers/projects.ts`.
- Account settings entry point:
  `apps/web/src/components/nav-user.tsx:130-141` currently renders an inert
  `Settings` menu item.
- Tests are colocated `*.test.ts` / `*.test.tsx`; complex services use injected
  dependencies and deterministic clocks/IDs.

### Verified PI 0.80.10 facts

Read these installed, version-matched files before editing:

- `/home/ayan/.nvm/versions/node/v24.14.1/lib/node_modules/@earendil-works/pi-coding-agent/docs/providers.md`
- `/home/ayan/.nvm/versions/node/v24.14.1/lib/node_modules/@earendil-works/pi-coding-agent/docs/sdk.md`
- `/home/ayan/.nvm/versions/node/v24.14.1/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.d.ts`
- The runner's newly installed 0.80.10 copies after `npm install`.

Required public API shape:

```ts
const credentials = new InMemoryCredentialStore();
await credentials.modify(providerId, async () => credential);
const modelRuntime = await ModelRuntime.create({
  credentials,
  modelsPath: null,
  allowModelNetwork: false,
});
const credential = await modelRuntime.login(providerId, authType, interaction);
const model = modelRuntime.getModel(providerId, modelId);
```

`CredentialStore.modify()` is the refresh serialization boundary. OpenAI Codex
is OAuth-only, so do not use `setRuntimeApiKey()` for it. GitHub Copilot OAuth
credentials carry account-specific endpoint/model metadata; preserve the full
credential object rather than reducing OAuth to a string token.

PI 0.80.10's generated OpenCode Zen catalog contains:

```ts
{
  id: "deepseek-v4-flash-free",
  name: "DeepSeek V4 Flash Free",
  provider: "opencode",
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
}
```

The provider ID is `opencode`, its display name is `OpenCode Zen`, and its auth
still resolves `OPENCODE_API_KEY`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install runner lock update | `npm install --prefix packages/sandbox-runner --save-exact @earendil-works/pi-ai@0.80.10 @earendil-works/pi-coding-agent@0.80.10` | exit 0; both manifest and runner lock resolve 0.80.10 |
| Generate D1 migration | `pnpm db:generate` | exit 0; one new ordered SQL migration and matching Drizzle metadata |
| App focused tests | `pnpm test -- src/lib/account-provider-credentials.test.ts src/lib/provider-auth-service.test.ts src/lib/agent-run-service.test.ts src/lib/agent-run.test.ts src/routes/api.provider-auth.stream.test.ts src/routes/api.provider-auth.control.test.ts src/components/provider-settings-dialog.test.tsx src/components/composer.test.tsx` | all selected tests pass |
| Runner tests | `npm test --prefix packages/sandbox-runner` | all runner tests pass |
| Runner typecheck | `npm run typecheck --prefix packages/sandbox-runner` | exit 0, no errors |
| Full gate | `pnpm verify` | exit 0: check, both typechecks, all tests, app build, runner build |
| Diff scope | `git status --short` | only files listed under Scope plus generated migration/route artifacts |

Do not run `pnpm format` or `pnpm fix`; both mutate broadly. Use targeted edits and
`pnpm check` through the full gate.

## Suggested executor toolkit

- Before adding helpers, use the `find-similar-functions` skill/truffler if
  available with queries such as `credential`, `encrypt`, `control job`,
  `parse model`, and `sandbox session`. Inspect matches before deciding to add
  new functions.
- Use `workers-best-practices` before changing Worker routes or Alchemy bindings.
- Use `fixing-accessibility` and `baseline-ui` for the account-provider dialog.
- Use `vercel-react-best-practices` for provider/model query wiring in React.
- Do not use a formatter or dependency-upgrade tool beyond the exact PI install
  command above.

## Scope

**In scope** (the only source/config files that may be modified or created):

- Root/config/docs:
  - `alchemy.run.ts`
  - `Dockerfile`
  - `README.md`
  - `docs/architecture/agent-harness.md`
  - `docs/architecture/security.md`
  - `docs/architecture/server-and-data.md`
  - `docs/architecture/frontend.md`
  - `docs/architecture/repository-map.md`
- D1 and generated schema artifacts:
  - `apps/web/src/db/schema.ts`
  - one generated `apps/web/migrations/0010_*.sql`
  - `apps/web/migrations/meta/0010_snapshot.json`
  - `apps/web/migrations/meta/_journal.json`
- Web backend/auth:
  - `apps/web/src/lib/crypto.ts`
  - `apps/web/src/lib/crypto.test.ts` (create)
  - `apps/web/src/lib/account-provider-credentials.ts` (create)
  - `apps/web/src/lib/account-provider-credentials.test.ts` (create)
  - `apps/web/src/lib/provider-auth-service.ts` (create)
  - `apps/web/src/lib/provider-auth-service.test.ts` (create)
  - `apps/web/src/lib/provider-auth-protocol.ts` (create)
  - `apps/web/src/lib/provider-auth-protocol.test.ts` (create)
  - `apps/web/src/lib/agent-models.ts`
  - `apps/web/src/lib/agent-run-service.ts`
  - `apps/web/src/lib/agent-run-service.test.ts`
  - `apps/web/src/lib/agent-run.ts`
  - `apps/web/src/lib/agent-run.test.ts`
  - `apps/web/src/lib/agent-control-service.ts`
  - `apps/web/src/lib/agent-control-service.test.ts`
  - `apps/web/src/lib/secret-redaction.ts`
  - `apps/web/src/lib/secret-redaction.test.ts`
- Routes/tRPC:
  - `apps/web/src/routes/api.provider-auth.stream.ts` (create)
  - `apps/web/src/routes/api.provider-auth.stream.test.ts` (create)
  - `apps/web/src/routes/api.provider-auth.control.ts` (create)
  - `apps/web/src/routes/api.provider-auth.control.test.ts` (create)
  - `apps/web/src/routes/api.agent.stream.test.ts`
  - `apps/web/src/integrations/trpc/routers/provider-auth.ts` (create)
  - `apps/web/src/integrations/trpc/routers/provider-auth.test.ts` (create)
  - `apps/web/src/integrations/trpc/router.ts`
  - `apps/web/src/routeTree.gen.ts` (generated by TanStack tooling only)
- Web client/UI:
  - `apps/web/src/lib/provider-auth-client.ts` (create)
  - `apps/web/src/lib/provider-auth-client.test.ts` (create)
  - `apps/web/src/lib/user-preferences-store.ts`
  - `apps/web/src/components/provider-settings-dialog.tsx` (create)
  - `apps/web/src/components/provider-settings-dialog.test.tsx` (create)
  - `apps/web/src/components/nav-user.tsx`
  - `apps/web/src/components/composer.tsx`
  - `apps/web/src/components/composer.test.tsx`
- Runner package:
  - `packages/sandbox-runner/package.json`
  - `packages/sandbox-runner/package-lock.json`
  - `packages/sandbox-runner/src/run-agent.ts`
  - `packages/sandbox-runner/src/run-agent.test.ts`
  - `packages/sandbox-runner/src/cli.ts`
  - `packages/sandbox-runner/src/protocol.ts`
  - `packages/sandbox-runner/src/protocol.test.ts`
  - `packages/sandbox-runner/src/provider-auth.ts` (create)
  - `packages/sandbox-runner/src/provider-auth.test.ts` (create)
  - `packages/sandbox-runner/src/provider-auth-cli.ts` (create)
  - `packages/sandbox-runner/src/provider-auth-control.ts` (create)
  - `packages/sandbox-runner/src/provider-auth-control.test.ts` (create)
  - `packages/sandbox-runner/src/provider-auth-control-cli.ts` (create)
  - `packages/sandbox-runner/src/provider-catalog-cli.ts` (create)
- Plan index:
  - `plans/README.md`

**Out of scope** (do not touch even if related):

- Better-auth configuration or the existing `user`, `session`, `account`, and
  `verification` table contracts.
- `projects.envVars` behavior or the project settings dialog.
- GitHub sign-in/App/install-token flows. GitHub Copilot is a separate PI
  provider connection and must not reuse the GitHub import OAuth token.
- A model-request proxy/gateway through the Worker.
- Custom OAuth endpoints/client registrations or copied PI OAuth internals.
- A click-only hosted Anthropic callback; manual redirect/code entry is the
  accepted limitation.
- Team/shared credentials, organizations, billing, usage metering, quotas, or
  administrator-managed provider accounts.
- Import/export of PI `auth.json`.
- Per-project provider overrides.
- Model temperature/thinking controls, pricing UI, image generation, or model
  benchmarking.
- Deployment with `pnpm deploy`; no cloud deployment is authorized by this plan.
- Any dependency upgrade except the exact paired PI `0.80.10` runner upgrade.

## Git workflow

- Branch: `advisor/025-account-provider-auth-and-pi-models`
- Use small Conventional Commits matching repository history. Recommended
  sequence:
  1. `refactor(agent): adopt PI model runtime`
  2. `feat(auth): persist account provider credentials`
  3. `feat(auth): bridge PI provider login`
  4. `feat(agent): use account provider credentials`
  5. `feat(chat): list connected provider models`
  6. `docs(auth): document provider credential flow`
- Do not push or open a PR unless explicitly instructed.

## Steps

### Step 1: Upgrade the runner to PI 0.80.10 and establish the fallback

1. Run the exact runner install command from "Commands you will need". Confirm
   both `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` are exactly
   `0.80.10` in `packages/sandbox-runner/package.json` and its lockfile. Do not
   update unrelated packages.
2. Migrate `packages/sandbox-runner/src/run-agent.ts` from `AuthStorage` and
   `ModelRegistry` to `ModelRuntime` and `InMemoryCredentialStore`:
   - for this intermediate step, preserve the current OpenCode env fallback by
     seeding an in-memory credential under the parsed provider; Step 5 replaces
     this temporary bridge with `DITTO_PI_CREDENTIAL` and removes ambient key
     inheritance;
   - seed one credential under the provider parsed from `modelSpecifier`;
   - create `ModelRuntime` with `modelsPath: null` and no ambient model config;
   - resolve the model with `getModel(providerId, modelId)`;
   - pass `modelRuntime` to `createAgentSession`;
   - preserve session files, tools, queueing, controls, event ordering, and
     disposal exactly.
3. Do not use PI's default file credential store. Add a regression assertion
   that no `auth.json` path is created or passed.
4. Replace the compile-time default in `apps/web/src/lib/agent-models.ts` with:

   ```ts
   export const DEFAULT_PROJECT_CODER_MODEL =
     "opencode/deepseek-v4-flash-free" as const;
   ```

   Keep a small `parseModelSpecifier`/syntax validator here (one slash, nonempty
   provider and model IDs, bounded total length). Dynamic availability moves to
   account credential logic in later steps.
5. Update current fixtures from `opencode-go/deepseek-v4-flash` to the exact
   fallback where the test means "default model". Keep deliberately generic
   `provider/model` fixtures generic.
6. Extend the root `Dockerfile` health assertions so the new auth/catalog CLIs
   added later must exist before the image is accepted. Until those files land,
   either make this Docker edit in Step 3 or keep the commit local and do not run
   the full image build between Steps 1 and 3.

**Verify**:

```bash
npm run typecheck --prefix packages/sandbox-runner && \
npm test --prefix packages/sandbox-runner -- --run src/run-agent.test.ts
```

Expected: exit 0; tests prove `modelRuntime` is passed, the selected provider is
seeded in memory, unknown models fail cleanly, and no file-backed auth path is
used.

Also run:

```bash
rg -n 'AuthStorage|ModelRegistry|opencode-go/deepseek-v4-flash' \
  packages/sandbox-runner/src apps/web/src/lib/agent-models.ts
```

Expected: no legacy runner auth imports/usages and no old default in
`agent-models.ts`.

### Step 2: Add the account credential vault and distributed lease

1. Add `aiProviderCredentials` to `apps/web/src/db/schema.ts` with:
   - generated text primary key;
   - `userId` FK to `user.id`, `onDelete: "cascade"`;
   - `providerId` text;
   - `authType` enum `api_key | oauth`;
   - `encryptedCredential` text;
   - non-secret `modelCatalog` JSON text containing only the safe projection
     defined in Locked decision 14;
   - `status` enum `connected | needs_relogin`, default `connected`;
   - nullable bounded `lastErrorCode` (stable internal code only, never an
     upstream message/body);
   - integer `version`, default `1`, not null;
   - nullable `leaseId` and timestamp `leaseExpiresAt`;
   - created/updated timestamps;
   - unique index on `(userId, providerId)` and an index on `userId`.
2. Add `providerAuthAttempts` with only non-secret coordination metadata:
   attempt ID, `userId`, provider ID, auth type, auth sandbox ID, status
   (`pending | complete | failed | cancelled`), expiry, and timestamps. It must
   not contain prompts, prompt answers, credentials, authorization codes, or
   tokens.
3. Generate migration 0010 with `pnpm db:generate`. Inspect the SQL and snapshot;
   never hand-edit generated Drizzle metadata. Confirm both tables cascade from
   `user` and no project/sandbox FK exists.
4. Extend `encryptText`/`decryptText` compatibly with optional AES-GCM
   `additionalData`. Existing calls without it must preserve the current v1
   project-env format and behavior. Provider credential calls use the
   unambiguous canonical AAD
   `JSON.stringify(["ditto:provider-credential", userId, providerId])`; test
   identifiers containing `:` and other delimiters.
5. Add `AI_CREDENTIALS_ENCRYPTION_KEY` as an Alchemy secret binding. Update
   README configuration. It must be nonempty and distinct from
   `BETTER_AUTH_SECRET`; do not silently fall back to the auth secret. The
   credential boundary also fails closed when the operator
   `OPENCODE_API_KEY` needed for fallback is empty.
6. Implement `account-provider-credentials.ts` as the sole plaintext credential
   boundary in the Worker. It must provide narrow operations:
   - list non-secret connection status/model metadata by `userId`;
   - load/decrypt exactly one `(userId, providerId)` credential;
   - upsert a credential and safe model catalog, clearing `needs_relogin`;
   - mark `needs_relogin` with a stable code after a confirmed OAuth refresh
     failure, preserving the encrypted credential for explicit reconnect;
   - delete one owned credential while holding its lease;
   - atomically acquire a bounded lease for one user/provider;
   - update a refreshed credential only when the row still exists and lease
     ID/version match; this path is update-only and must never recreate a row;
   - release in failure cleanup;
   - opportunistically clear expired auth attempts/leases.
7. Define and export concrete timing constants. Use values appropriate to the
   existing ten-minute agent command timeout, but enforce this relation in a
   test:

   ```text
   AUTH_RESOLUTION_TIMEOUT_MS + AUTH_PROCESS_KILL_GRACE_MS < LEASE_TTL_MS
   ```

   Also define bounded `LEASE_WAIT_MS`. D1 lease acquisition is one conditional
   update/insert decision. On timeout, terminate and await the auth-only runner
   before lease release/expiry. Never hold the lease for model generation.
8. `credentialSecretValues` must collect every nonempty string leaf in the
   canonical credential except the structural `type` discriminator, including
   unknown future provider fields. Provider/catalog labels are separate safe
   objects and must never be traversed as credential data.

**Verify**:

```bash
pnpm test -- src/lib/crypto.test.ts src/lib/account-provider-credentials.test.ts
```

Expected tests include:

- account A cannot read/delete account B's row;
- the same account credential can be loaded without any project/sandbox ID;
- project and sandbox deletion are irrelevant to the row;
- duplicate provider upserts replace one row rather than creating duplicates;
- values never appear in list/status results;
- configuration rejects empty required secrets and equal encryption/auth keys;
- wrong user/provider AAD cannot decrypt a ciphertext, including identifiers
  containing delimiter characters;
- existing no-AAD project-env round-trip still works;
- only one concurrent lease acquisition succeeds;
- expired lease recovery works;
- stale lease/version cannot overwrite a newer credential;
- disconnect versus refresh cannot recreate a deleted row;
- reconnect versus stale refresh preserves the newly connected credential;
- refresh failure persists `needs_relogin` plus a stable code but no upstream
  error text;
- deleting the user cascades credential/attempt rows (assert from migration SQL
  or a D1 integration fixture already used by the repo).

Inspect migration shape:

```bash
rg -n 'ai_provider_credentials|provider_auth_attempts|projectId|sandboxId' \
  apps/web/migrations/0010_*.sql
```

Expected: both tables exist; `ai_provider_credentials` contains no `projectId`
or `sandboxId` columns. `provider_auth_attempts` may contain an auth sandbox ID
for transient routing only.

### Step 3: Build a PI-owned auth/catalog runner with a secret-free protocol

1. Create a strict versioned provider-auth protocol distinct from the existing
   agent protocol. Public runner events may include:
   - catalog/provider metadata;
   - `auth_url`, `device_code`, `info`, `progress`;
   - prompt metadata `{ promptId, type, message, placeholder?, options? }`;
   - `credential_ready` with no credential fields;
   - terminal `done` or bounded `error`.
2. Prompt answers travel through a dedicated bounded Unix socket/control CLI,
   modeled after `control-channel.ts`, keyed by auth attempt ID. Requests are
   exact-shape `{attemptId, promptId, action: "answer", value}` or
   `{attemptId, action: "cancel"}`. Limit answer size, serialize requests, reject
   stale/wrong prompt IDs, and delete sockets/jobs in `finally`. Pre-create every
   answer-bearing `/tmp` control job with mode `0600` before writing; verify its
   mode before CLI execution and delete it immediately after its single read.
3. Implement `provider-auth.ts` using only public PI APIs:
   - `ModelRuntime.create({ credentials, modelsPath: null, ... })`;
   - enumerate only the portable provider/auth matrix from Locked decision 3;
   - support explicit `login` and noninteractive `resolve` job modes;
   - in `login`, call `runtime.login(providerId, authType, interaction)`;
   - in `resolve`, parse `DITTO_PI_STORED_CREDENTIAL` inside the unique
     auth-only sandbox, delete it from `process.env` immediately, seed the
     existing full D1 credential, call PI auth resolution under the Worker-held
     lease, and return both the updated stored credential and a runtime
     credential stripped of the real OAuth refresh token;
   - relay `notify()` and `prompt()` through the public protocol;
   - automatically answer OpenAI Codex's login-method selector with
     `device_code` while relaying all other prompts, including Copilot enterprise
     domain and Anthropic `manual_code`;
   - after success, list only models available to that credential and project
     them through the exact safe model schema from Locked decision 14;
   - write login `{credential, models}` or resolve
     `{storedCredential, runtimeCredential, models}` to a Worker-generated
     result path under `/tmp` with mode `0600`;
   - emit only secret-free `credential_ready`;
   - wait for the Worker to read and delete that exact result file before
     emitting terminal success. Use a short bounded poll/timeout; the runner's
     `finally` deletes a still-present file after timeout/failure. This handshake
     prevents the runner from deleting the result before the stream handler can
     consume it and prevents success before D1 persistence.
4. The result path must be supplied in the generated job, normalized under a
   fixed `/tmp/ditto-provider-auth-results` directory, and deleted by the Worker
   immediately after its one read. Runner cleanup removes leftovers only; it
   must not race the normal Worker read. Never print result content to
   stdout/stderr.
5. Implement `provider-catalog-cli.ts` as a credential-free one-shot command
   returning only the portable provider matrix, provider IDs/names, supported
   auth methods/labels, and the exact safe static model projection. It must not
   read ambient provider env, `auth.json`, `models.json`, project files, Radius,
   or profile/ADC-backed providers.
6. Add npm/bin/build and Docker assertions for `provider-auth-cli.js`,
   `provider-auth-control-cli.js`, and `provider-catalog-cli.js`.
7. Preserve stored credentials losslessly, including unknown PI fields. Build
   project runtime credentials through the provider-specific allowlist in Locked
   decision 9: preserve only fields known to be needed by PI `toAuth`, replace
   the real refresh token with a non-secret sentinel, and issue only when access
   expiry safely exceeds the maximum agent-run window. Unknown stored fields are
   valid at rest/auth-only resolution but rejected from runtime projection; if
   PI starts requiring one, STOP for explicit review.
8. Catch PI auth/refresh exceptions at the runner boundary and emit only stable
   error codes plus generic messages. Never serialize exception message, cause,
   stack, or upstream response body; those may contain a newly issued secret
   that is not yet known to the redactor.

**Verify**:

```bash
npm test --prefix packages/sandbox-runner && \
npm run typecheck --prefix packages/sandbox-runner && \
npm run build --prefix packages/sandbox-runner
```

Expected: all runner tests pass. Then assert build artifacts directly:

```bash
test -s packages/sandbox-runner/dist/provider-auth-cli.js && \
test -s packages/sandbox-runner/dist/provider-auth-control-cli.js && \
test -s packages/sandbox-runner/dist/provider-catalog-cli.js
```

Expected: exit 0.

Required auth tests use mocked PI interactions—never real credentials/network:

- the exact provider/auth matrix is emitted; `openai-codex` and
  `github-copilot` reject API-key mode, unlisted/ambient providers reject all;
- API-key secret prompt answer reaches PI but never an emitted event;
- Codex selects device code automatically;
- xAI/Copilot device event fields relay exactly;
- Copilot enterprise prompt round-trips;
- Anthropic manual-code prompt round-trips;
- cancel aborts login and removes socket/result/job;
- malformed/oversized/stale controls are rejected;
- API-key and manual-code answer jobs plus credential result files are mode 0600
  and removed after one read;
- a PI exception containing an unknown credential-shaped sentinel is mapped to
  a generic code/message and absent from stdout, stderr, events, and result;
- model projection rejects headers/base URLs/unknown fields, duplicate IDs,
  provider mismatch, and oversized catalogs;
- runtime credential projection preserves required Codex/Copilot metadata,
  strips unknown stored OAuth fields and the real refresh token, and stops on an
  unsupported provider requirement;
- credential result content never appears on stdout;
- catalog output contains `opencode/deepseek-v4-flash-free` and identifies it as
  zero cost while still identifying `opencode` as API-key authenticated.

### Step 4: Add authenticated Worker auth-broker routes

1. Implement `provider-auth-service.ts` following the existing agent-control
   service pattern. It owns:
   - provider catalog invocation, portable-matrix filtering, exact safe model
     projection, and strict output validation;
   - server-side provider-specific auth URL host validation before SSE emission;
   - auth-attempt creation/expiry/ownership;
   - auth-only sandbox/session creation with no project/worktree dependency;
   - `/tmp` job/result/control paths;
   - runner NDJSON parsing and secret-free SSE events;
   - reading the 0600 result only after `credential_ready`;
   - credential encryption/upsert into D1;
   - result/job/session/sandbox cleanup in `finally`;
   - redacted, bounded errors.
2. Reuse the existing Sandbox binding with an auth-specific generated sandbox ID.
   Do not call project bootstrap, restore, backup, worktree, or GitHub helpers.
   Verify locally that an auth-only sandbox can start independently of a project
   under the current Container configuration. If it cannot, trigger the matching
   STOP condition rather than changing the resource graph.
3. Add cookie-authenticated direct routes:
   - `POST /api/provider-auth/stream` starts one login and streams public auth
     events;
   - `POST /api/provider-auth/control` answers/cancels one active prompt after
     checking attempt ownership and expiry.
4. The stream body accepts only a PI-enumerated provider/auth method. The control
   route never echoes `value`; successful response is metadata-only.
5. Add `providerAuth` tRPC router operations:
   - `catalog`: safe providers/auth choices;
   - `connections`: account connection status (`connected` or
     `needs_relogin`), stable error code, and safe model metadata only;
   - `models`: fallback plus safe models from account credential rows;
   - `disconnect`: acquire the lease, then delete the current user's provider
     row without allowing an in-flight stale refresh to recreate it.
   Explicit catalog refresh is deferred; reconnect refreshes model metadata.
6. Register the router and let TanStack regenerate `routeTree.gen.ts`; do not edit
   generated route declarations by hand.
7. Ensure auth result plaintext and raw PI exceptions are never logged, included
   in thrown error text, returned from tRPC, or passed to `redactStructured`
   after they could already have reached a logger. Redaction is defense-in-depth,
   not permission to emit them. Unknown/non-HTTPS auth URLs are rejected or sent
   as non-clickable text; Copilot Enterprise URLs must match that attempt's
   normalized enterprise host.

**Verify**:

```bash
pnpm test -- \
  src/lib/provider-auth-protocol.test.ts \
  src/lib/provider-auth-service.test.ts \
  src/routes/api.provider-auth.stream.test.ts \
  src/routes/api.provider-auth.control.test.ts \
  src/integrations/trpc/routers/provider-auth.test.ts
```

Expected tests include 401 for anonymous routes; 404 for foreign/stale attempts;
strict protocol rejection; portable provider-matrix enforcement; no project
lookup; successful account-scoped upsert; durable `needs_relogin` transition;
wrong-host/non-HTTPS URL rejection; Copilot Enterprise host binding; control
value absent from response/log fixtures; unknown-secret PI error mapped to a
stable generic failure; cleanup after success, cancel, runner failure, client
disconnect, and malformed result; disconnect/refresh linearization; and no
backup API call.

Run a source guard:

```bash
rg -n 'encryptedCredential|refreshToken|accessToken|credential_ready' \
  apps/web/src/routes apps/web/src/integrations/trpc/routers/provider-auth.ts
```

Expected: route/router code contains no response serialization of credential
fields. `credential_ready` may appear only as secret-free control metadata.

### Step 5: Resolve account credentials at agent startup and persist refreshes

1. Replace static request availability with two stages:
   - schema validates only bounded `provider/model` syntax;
   - `prepareAgentRun` checks that the model is either the exact fallback or is
     present in an owned `connected` account credential's stored model catalog;
     `needs_relogin` rows contribute no models and return a stable reconnect 409.
   Do this before worktree/message side effects where practical.
2. At execution startup, choose auth:
   - owned `connected` credential for the model's provider, if present;
   - owned `needs_relogin` row: reject with stable 409 without attempting auth;
   - otherwise operator `OPENCODE_API_KEY` only when model is exactly
     `opencode/deepseek-v4-flash-free`;
   - otherwise return a typed `409` explaining that the provider must be
     connected.
3. Build the runtime credential before launching the project runner:
   - API-key credential: use the account key as the runtime credential;
   - unexpired OAuth credential whose access expiry exceeds the maximum agent
     command window plus safety skew: copy access plus provider metadata, replace
     the real refresh token with a fixed non-secret sentinel, and preserve the
     safe expiry;
   - expired/near-expiry OAuth credential: acquire the D1 lease, start a unique
     auth-only sandbox in noninteractive `resolve` mode with the full credential,
     enforce the timeout/kill/lease ordering, read/delete its 0600 result,
     update the existing D1 row, release the lease, then use only its stripped
     runtime credential in the project sandbox.
   Full OAuth refresh tokens must never enter a project sandbox.
4. Pass only that runtime credential via `DITTO_PI_CREDENTIAL` to the project
   shell. In `run-agent.ts`, parse then immediately execute:

   ```ts
   delete process.env.DITTO_PI_CREDENTIAL;
   delete process.env.OPENCODE_API_KEY;
   ```

   before creating any session/tool. Seed the in-memory store, create
   `ModelRuntime`, and resolve the model. The synthetic OAuth credential is
   guaranteed not to expire during the bounded run and cannot refresh because
   it contains no real refresh token. The project runner does not write back
   account credentials and does not emit `credential_ready`.
5. Refresh resolution completes and persists in the auth-only sandbox path
   before the project runner starts. On timeout/failure, terminate and await the
   auth process, delete result/control files, release the lease, persist a stable
   `needs_relogin` state only for confirmed OAuth refresh failure, and fail the
   pending assistant cleanly. Never hold the lease for model generation.
6. For the operator fallback, construct an ephemeral canonical `api_key`
   runtime credential in Worker memory. Never persist it in a user's row. The
   runner consumes/deletes it through the same project-runner path, with no
   writeback.
7. Remove direct `OPENCODE_API_KEY` injection from the shell env. Keep the
   Alchemy binding because it is the fallback source inside the Worker.
8. Add every string leaf from the runtime credential and full credential used by
   the auth-only resolver to the relevant redaction boundary before any output
   from that process is parsed. No key/access/refresh or unknown credential
   string may enter messages, SSE, stderr diagnostics, PI events, or Git diffs.
9. Do not put credentials or result paths containing credentials in the runner
   job. A generated `/tmp` result path is allowed; its file content is not.
10. Follow-up controls accept a bounded model specifier and rely on the active
    runner's exact model equality check. They must not reload credentials or
    allow model changes mid-run.

**Verify**:

```bash
pnpm test -- \
  src/lib/agent-run-service.test.ts \
  src/lib/agent-run.test.ts \
  src/lib/agent-control-service.test.ts \
  src/lib/secret-redaction.test.ts \
  src/routes/api.agent.stream.test.ts
npm test --prefix packages/sandbox-runner -- --run \
  src/run-agent.test.ts src/protocol.test.ts
```

Expected tests include:

- account credential works from two different project/sandbox fixtures;
- deleting/recreating a sandbox does not alter D1 connection status;
- `needs_relogin` hides models and returns reconnect 409 without a refresh
  attempt; successful reconnect restores availability;
- foreign account credential never resolves;
- connected provider credential beats fallback for the same provider;
- fallback works only for `opencode/deepseek-v4-flash-free` and uses operator
  key without persisting it;
- another OpenCode model without an account credential returns 409;
- credential env is absent before `createAgentSession` and bash tool creation;
- no `auth.json` is created;
- project runner receives no real OAuth refresh token;
- refreshed OAuth credential persists before the project runner starts or emits
  `ready`/assistant deltas;
- concurrent startup refreshes serialize; a fake-clock test proves the second
  lease cannot acquire while the first auth process is alive, including timeout
  and kill grace; stale writer cannot overwrite;
- disconnect during refresh cannot recreate the row; reconnect defeats a stale
  refresh write;
- refresh failure releases lease, records stable `needs_relogin`, preserves old
  encrypted credential for explicit reconnect, hides the raw PI error, and
  terminally fails the assistant row;
- credentials split across runner chunks are redacted;
- job JSON contains no credential;
- follow-up cannot change model.

Source guards:

```bash
rg -n 'OPENCODE_API_KEY:' apps/web/src/lib/agent-run.ts
rg -n 'process\.env\.(DITTO_PI_CREDENTIAL|OPENCODE_API_KEY)' \
  packages/sandbox-runner/src/run-agent.ts
```

Expected: no direct operator-key shell injection; runner reads and then deletes
both possible secret env names before session creation.

### Step 6: Expose account connections and connected models in the UI

1. Create `provider-settings-dialog.tsx` opened from the existing account
   `Settings` menu item in `nav-user.tsx`. It is account-level: copy must say
   connections apply to all projects. Do not place it in Project Settings.
2. Show PI-enumerated providers and supported methods. Connection states are
   `not connected`, `connecting`, `connected via API key`, `connected via
   subscription`, `needs re-login`, and `error`. Never show or retrieve stored
   secret values; reconnect replaces a credential.
3. Drive auth through `provider-auth-client.ts`:
   - consume SSE public events;
   - open auth/device URLs only from validated HTTPS origins (localhost callback
     text is display/paste guidance, not an auto-open target after redirect);
   - render device code with accessible copy action;
   - render `secret` prompts as password inputs;
   - post prompt answers/cancel to the control route;
   - clear all entered values and local component state on completion/close.
4. Anthropic UI must explicitly show the accepted manual flow and extra-usage
   billing caveat. Do not imply that Claude plan limits are consumed normally.
5. Disconnect requires confirmation, deletes only the signed-in user's row, and
   explains that upstream token revocation is provider-managed. It must not
   delete projects, sessions, messages, or sandboxes.
6. Replace the composer's static `PROJECT_CODER_MODELS` mapping with the
   authenticated `providerAuth.models` query. Always include the fallback model;
   add account-connected models grouped by provider.
7. Change the Zustand selected-model type from a compile-time union to a bounded
   string preference. If the persisted value is absent from the server list,
   reset to `DEFAULT_PROJECT_CODER_MODEL`. Never persist credentials, auth type,
   provider account data, or model catalog in Zustand/localStorage.
8. Preserve current composer keyboard, streaming, follow-up, and model logo
   behavior. Disable submission with a clear state while model availability is
   loading or if a just-disconnected model is selected.
9. Meet WCAG AA basics: labelled dialogs/fields, keyboard-completable auth,
   visible focus, live progress/status, non-color-only states, and focus return
   after dialog close.

**Verify**:

```bash
pnpm test -- \
  src/components/provider-settings-dialog.test.tsx \
  src/components/composer.test.tsx \
  src/lib/provider-auth-client.test.ts
```

Expected tests cover account-scope copy; API-key secret field; device code;
Anthropic paste/caveat; cancel/cleanup; no secret in DOM after close; disconnect
confirmation; fallback-only account; connected models; stale preference reset;
and unchanged composer submit/follow-up behavior.

Browser storage guard:

```bash
rg -n 'credential|apiKey|accessToken|refreshToken|providerAuth' \
  apps/web/src/lib/user-preferences-store.ts
```

Expected: no credential/auth persistence; only selected model preference remains.

### Step 7: Document and run the complete security/verification matrix

1. Update README environment/configuration:
   - `AI_CREDENTIALS_ENCRYPTION_KEY` is required and distinct from auth secret;
   - `OPENCODE_API_KEY` is the operator credential for the exact free fallback;
   - users may connect account-level providers in Account Settings.
2. Update architecture docs with:
   - account credential D1 table/ownership;
   - auth-only sandbox and `/tmp` cleanup;
   - device/manual OAuth behavior;
   - D1 lease and refresh ordering;
   - ephemeral runner credential injection/deletion;
   - no `auth.json`, project env, R2, job, or SSE credential persistence;
   - fallback precedence and exact model ID;
   - sandbox destruction not affecting account connections.
3. Update `repository-map.md` for every new source/test/route/runner file.
4. Run the full gate.
5. Rebuild the sandbox image locally through the normal Alchemy dev path and run
   this manual matrix with test accounts/replaceable credentials only:
   - no connection → fallback sends a successful prompt;
   - API-key provider connect → model visible in two projects → successful run;
   - Codex device-code connect and run;
   - xAI device-code connect and run;
   - GitHub Copilot device-code connect (blank enterprise domain) and run;
   - Anthropic auth URL → failed localhost redirect copied/pasted → run, with
     billing caveat visible;
   - destroy/recreate one project sandbox → connections remain listed and work;
   - disconnect provider → models disappear for future runs while fallback stays;
   - refresh/re-login failure shows bounded error and no token in logs/SSE/D1
     message content;
   - inspect a project R2 backup manifest/files: no auth result, credential,
     `auth.json`, or auth-control job.
6. Do not use production credentials or deploy. If external provider access is
   unavailable, record those manual rows as `NOT RUN (reason)`, not passed.

**Verify**:

```bash
pnpm verify
```

Expected: exit 0, including app and runner builds.

Then run:

```bash
rg -n 'opencode-go/deepseek-v4-flash|AuthStorage|ModelRegistry' \
  apps/web/src packages/sandbox-runner/src README.md docs/architecture
```

Expected: no live legacy default/auth implementation references. Historical plan
files are intentionally excluded.

Finally:

```bash
git status --short
```

Expected: only in-scope source/config/docs, generated route tree, generated
migration metadata, this plan, and `plans/README.md` are modified.

## Test plan

### App/backend tests

- `crypto.test.ts`: no-AAD compatibility; correct-AAD round trip; wrong user or
  provider fails; malformed payload fails without plaintext in error.
- `account-provider-credentials.test.ts`: ownership, account scope across
  projects/sandboxes, write-only responses, safe model projection,
  connected/needs-relogin transitions, upsert/delete, lease concurrency,
  timeout/kill/expiry ordering, disconnect/reconnect races, stale update
  rejection, cascade shape.
- `provider-auth-protocol.test.ts`: strict public event parsing, bounded fields,
  unknown/extra-field rejection, credential-shaped output rejection.
- `provider-auth-service.test.ts`: auth-only sandbox, no project dependency,
  result-file read/delete, D1 upsert, attempt ownership/expiry, cancellation,
  cleanup, redacted failures, no backup calls.
- Route tests: cookie auth, malformed input, thin service delegation, SSE order,
  control ownership, and no answer echo.
- `provider-auth` tRPC tests: status/model metadata only, owned disconnect,
  fallback always present, foreign account isolation.
- Agent lifecycle tests: validation before side effects, fallback restriction,
  account credential selection, two-sandbox reuse, refresh lease/writeback,
  cleanup and terminal failure.
- Redaction tests: canonical API-key/OAuth credential string values across text,
  structured events, stderr, and split deltas.

### Runner tests

- ModelRuntime migration and in-memory seed.
- No file auth storage or `auth.json`.
- Secret env deletion before tools/session.
- Provider/model resolution including OpenCode Zen fallback.
- Provider-owned API-key/device/manual interactions.
- Prompt correlation/cancel/size limits/socket cleanup.
- Secret result file permissions and no stdout leakage.
- Auth-only resolve refreshes/persists the full credential and produces a
  refresh-token-free runtime credential before any project runner starts.
- Existing follow-up/Stop and custom Git tools remain unchanged.

### UI tests

- Account-level placement/copy and accessible dialog controls.
- API-key, device-code, Copilot enterprise, and Anthropic manual flows.
- No stored value retrieval or retained secret DOM state.
- Connected models and exact fallback behavior.
- Stale local model preference reset.
- Existing composer submission/live controls regressions.

## Done criteria

All criteria are mandatory:

- [ ] Both runner PI packages resolve exact `0.80.10`; no unrelated dependency
      version changed.
- [ ] `ai_provider_credentials` is uniquely account/provider scoped and has no
      project/sandbox ownership column.
- [ ] Provider credentials survive project sandbox destruction/recreation in
      automated tests and the available manual matrix.
- [ ] Credentials use `AI_CREDENTIALS_ENCRYPTION_KEY` plus user/provider AAD;
      existing project-env ciphertext remains readable.
- [ ] Better-auth `account` and `projects.envVars` do not store PI credentials.
- [ ] No provider credential is written under `/workspace`, PI `auth.json`,
      project jobs, project env settings, message rows, localStorage, or R2
      backups.
- [ ] Auth/API-key prompt answers, raw PI exceptions, and canonical credentials
      never appear in client-visible SSE, tRPC responses, logs, or errors.
- [ ] Every answer/result control file is mode 0600, single-read, and deleted in
      success/failure paths.
- [ ] Runner secret env is deleted before creating bash-capable tools/session;
      project sandboxes never receive real OAuth refresh tokens.
- [ ] OAuth refresh is serialized per user/provider with an atomic distributed
      lease, explicit timeout/kill/TTL ordering, and persists before the project
      runner starts.
- [ ] Disconnect/reconnect is linearized against refresh; stale refresh cannot
      recreate or overwrite a credential.
- [ ] Stored/browser model metadata is the exact safe projection and contains no
      headers, endpoints, transport, or auth fields.
- [ ] The exact portable provider/auth matrix is enforced in runner, service,
      catalog, and tests; ambient/profile/Radius branches are unavailable.
- [ ] Codex/xAI/Copilot device flows and Anthropic manual-paste flow are covered
      by mocked automated tests; manual availability is recorded honestly.
- [ ] `needs_relogin` rows expose no models and cannot start/retry a run until a
      successful reconnect.
- [ ] The operator-authenticated fallback is exactly
      `opencode/deepseek-v4-flash-free`, backed by operator
      `OPENCODE_API_KEY`; no other model receives operator auth.
- [ ] Connected account models are available across all of that user's projects
      and rejected for other users.
- [ ] Disconnect affects future runs only and does not mutate project/session
      data.
- [ ] `pnpm verify` exits 0.
- [ ] No files outside Scope are modified.
- [ ] `plans/README.md` marks Plan 025 DONE only after all automated gates pass
      and records manual `PASS` / `FAIL` / `NOT RUN` results.

## STOP conditions

Stop and report; do not improvise if any occurs:

1. PI 0.80.10 no longer exposes `ModelRuntime`, `InMemoryCredentialStore`,
   provider-owned `login`, or the verified OpenCode model/provider identifiers.
2. The exact paired PI upgrade requires another dependency upgrade or breaks the
   existing agent/follow-up/Git-tool contract beyond the migration described.
3. An auth-only sandbox cannot be created independently of a project with the
   current Sandbox binding/Container limits. Do not change `maxInstances`, add a
   second Container/DO, or introduce a service without product/infrastructure
   approval.
4. A provider login can only be made to work by copying PI OAuth client IDs,
   endpoints, PKCE/token code, or other non-public internals.
5. Anthropic requires a hosted click-only callback rather than the approved
   manual redirect/code paste.
6. Credentials would need to be written under `/workspace`, included in R2,
   printed to stdout/stderr, or sent through browser-visible SSE.
7. The runner cannot remove credential environment before bash/tool child
   processes inherit it, or the implementation would need to claim API keys are
   hidden from arbitrary same-container peers. A Worker model proxy would
   require separate product approval.
8. D1 cannot atomically acquire/release the proposed lease. Do not replace it
   with a CAS loop that can invoke rotating refresh twice; report the need for a
   Durable Object or other lock owner.
9. Account credential persistence would require altering/reusing better-auth's
   `account` tokens or project `envVars`.
10. Model availability cannot be validated server-side without sending a
    credential to the browser.
11. Any test/log/fixture unexpectedly exposes a real credential. Stop, remove the
    exposure without reproducing the value, and recommend rotation.
12. Migration generation produces anything beyond the two intended tables,
    indexes, and foreign keys.
13. A focused verification fails twice after a reasonable correction, or full
    verification reveals a pre-existing red baseline not documented in the live
    repository.
14. Required implementation needs a file outside Scope. Report the file and
    reason before editing it.

## Maintenance notes

- PI provider catalogs and OAuth behavior are version-coupled. Upgrade
  `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` together, rerun
  the provider-auth protocol tests, and verify the fallback model ID on every PI
  upgrade.
- `modelCatalog` is a non-secret connection-time snapshot. A future product may
  add explicit refresh, but it must use the same account credential/lease path;
  never refresh by exposing credentials to the browser.
- Reviewers should scrutinize every transition where plaintext exists: D1
  decrypt, auth/result file, shell env parse/delete, PI refresh writeback, and
  redaction setup. "Encrypted at rest" does not compensate for a leaked stream
  or inherited process environment.
- The auth sandbox is an execution mechanism, not a persistence boundary. D1
  remains authoritative even if auth sandbox lifecycle changes later.
- If organizations/team accounts are added, do not overload this account-level
  table silently. Introduce an explicit credential owner model and migration.
- Claude's billing/callback caveats may change upstream. Update UI copy only
  against current PI and Anthropic documentation; do not promise plan-limit
  behavior.
- The operator OpenCode key remains a platform secret and should be monitored
  for aggregate abuse/rate limits. Quotas and billing controls are explicitly a
  later product decision, not part of this plan.
