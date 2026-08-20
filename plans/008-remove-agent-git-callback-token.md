# Remove the agent Git callback token

Status: TODO

Written against commit `62c99b4`. Complete plan 006 first. Plan 007 may run
before or after this plan.

Before editing, compare the current commit and target spec with plan 001's
recorded values. Read drift in Ditto tools, agent Git policy, authority, and
route code. Stop if the allowed agent Git actions changed.

## Goal

Let the image-owned Ditto extension request Git status, push, and pull-request
actions through a synthetic internal origin. Resolve authority from trusted
sandbox identity and D1. Remove the HS256 callback JWT, callback URL, and
`/api/agent/git` route.

## Current state

`agent-run.ts` mints a JWT from `BETTER_AUTH_SECRET` and injects both callback
URL and token. `ditto-git-callback.ts` posts an authorization bearer token to
the Worker route. The route verifies claims and dispatches
`agent-git-handler.ts`.

Keep the existing exact tool schemas and Git policy. The seam changes; the
allowed product actions do not.

## Files in scope

- `packages/sandbox-runner/src/ditto-git-callback.ts` and tests
- `packages/sandbox-runner/src/ditto-git-tools.ts` and tests
- `apps/web/src/lib/agent-run.ts` and tests
- `apps/web/src/lib/agent-git-handler.ts` and tests
- `apps/web/src/lib/sandbox-authority.ts` and tests
- `apps/web/src/lib/sandbox-egress-broker.ts` and tests
- a new Ditto-action request-contract adapter and tests
- `apps/web/src/lib/agent-git-jwt.ts` and tests, to delete
- `apps/web/src/routes/api.agent.git.ts` and tests, to delete
- generated route output
- affected architecture and security docs

Do not change network Git credential transport in this plan. Push may still use
the existing isolated launcher until plan 009.

## Authority and contract

Open a `ditto_action` family operation alongside the active agent run. Bind it
to the workspace-session identity, lifecycle generation, user, project,
session, exact branch, expiry, and allowed action set. Close it whenever the
agent run settles or the runtime becomes stale.

The extension calls a code-owned origin such as
`http://ditto.internal/v1/git-action`. The origin and path are constants in the
image. They contain no identity or capability.

The broker adapter must:

1. Require the synthetic host, exact path, POST, JSON content type, no query,
   and a bounded body.
2. Reject authorization, cookie, proxy, forwarding, and caller correlation
   headers.
3. Parse with the existing strict action schema. Reject duplicate or unknown
   fields.
4. Resolve the trusted identity and sole open `ditto_action` operation.
5. Build `ResolvedAgentGitContext` from D1 ownership and runtime state rather
   than JWT claims or caller fields.
6. Call the existing Worker-owned Git modules directly. Do not loop through a
   public Worker URL.
7. Return a bounded, redacted result. Never include known project secrets,
   installation tokens, operation rows, or exact denial details.

## Runner changes

- Replace callback URL and token environment reads with the fixed synthetic
  origin.
- Remove `DITTO_GIT_CALLBACK_URL` and `DITTO_GIT_CALLBACK_TOKEN` from every
  process environment and redaction list.
- Preserve tool names, labels, parameter schemas, and result shape.
- Keep push and open-PR unavailable when the Worker denies the operation.

## Tests

Prove:

- agent environments, commands, jobs, and `/proc` contain no callback JWT or
  callback URL
- an arbitrary public request cannot invoke the synthetic adapter
- no open operation, stale generation, wrong session, wrong branch, expired
  operation, malformed action, extra field, or oversized body fails closed
- action responses are bounded and redacted
- push and pull-request actions retain current ownership, dirty-tree, secret
  preflight, branch, and no-merge or no-close policy
- agent status requests do not receive decrypted project environment values
- the route and JWT module are absent from the route tree and source graph

## Verification

```bash
pnpm --filter @ditto/web test -- src/lib/agent-git-handler.test.ts src/lib/ditto-action-contract.test.ts src/lib/agent-run.test.ts
npm test --prefix packages/sandbox-runner -- src/ditto-git-callback.test.ts src/ditto-git-tools.test.ts
rg -n "DITTO_GIT_CALLBACK|agent-git-jwt|/api/agent/git" apps/web/src packages/sandbox-runner/src docs/architecture
pnpm typecheck
pnpm runner:verify
pnpm verify
```

Expected result: the search returns no live source or durable-doc references.
All commands exit 0.

## Done criteria

- No Git callback bearer token or callback URL enters a sandbox.
- Agent Git actions resolve only through current D1 identity and operation
  authority.
- Tool behavior remains available except merge and close, which remain denied.
- The public callback route and JWT implementation are deleted.

## Maintenance note

Treat every new agent Git tool as a new request-contract variant. Derive its
authority from D1 and keep identity fields out of the sandbox request schema.

## Stop conditions

- If the synthetic origin can bypass the catch-all broker, stop and fix handler
  precedence. Do not expose a replacement public callback route.
- If direct dispatch requires trusting fields from the request body for
  identity or branch, stop and derive those fields from D1.
