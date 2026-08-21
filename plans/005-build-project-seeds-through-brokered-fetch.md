# Build project seeds through brokered Git fetch

Status: DONE

Written against commit `62c99b4`. Complete plans 003 and 004 first.

Executed 2026-08-21 from `c5a8f73` (plans 001–004 already on HEAD). Advisor
verdict: accept. Merged onto `brain` as `e7dc34b`. Spec digest unchanged:
`f104e9ba66b97ce8f5a196a08854fa7819cfd7e37186f8b46cfb429c2124c5b3`.

Before editing, compare the current commit and target spec with plan 001's
recorded values. Read drift in project import, Git, authority, schema, and
Sandbox entrypoint code. Stop if project ownership or builder trust changed.

## Goal

Replace persistent project sandboxes for new imports with temporary builders.
The builder fetches only the owned repository through a Worker Git contract,
streams an immutable project seed to R2, and is then retired permanently.

This plan introduces the `SandboxAuthority` and `SandboxEgressBroker` modules as
a complete vertical slice. Do not add unused authority helpers before the
builder uses them.

## Current state

`projects.create` generates a sandbox UUID and calls `bootstrapSandbox()`.
`bootstrapSandbox()` mints a GitHub installation token, puts the token in a
clone URL, and calls `sandbox.gitCheckout()`. The project row then owns the
sandbox ID and stock backup handle.

## Files in scope

- `apps/web/src/db/schema.ts`, one generated migration, and Drizzle metadata
- `apps/web/src/server.ts`
- `alchemy.run.ts`
- new authority and broker modules under `apps/web/src/lib`
- new Git pkt-line and fetch-contract modules under `apps/web/src/lib`
- new `apps/web/src/lib/project-seed.ts` and tests
- `apps/web/src/lib/privileged-git.ts` and tests, preserving its local temp-bare
  repository controls
- `apps/web/src/lib/sandbox-bootstrap.ts` and tests
- `apps/web/src/integrations/trpc/routers/projects.ts` and tests
- `apps/web/src/lib/github-app.ts` only for the existing narrow token mint
- project import UI only if seed states require new copy
- `CONTEXT.md` and affected architecture docs

Do not broker push, model requests, or Ditto extension actions in this plan.
Do not migrate workspace sessions yet.

## Durable schema

Add normalized tables for:

- permanent sandbox identities, including kind, random sandbox ID, trusted
  Cloudflare container ID, owner IDs, lifecycle generation, state, retirement
  time, and timestamps
- privileged operations, including identity, generation, family, type,
  contract version, repository, allowed refs, maximum requests, consumed
  requests, expiry, closure, and correlation ID
- project seeds, including project, source commit, archive ID, format version,
  full compatibility key, build state, failure reason code, and timestamps

Do not cascade-delete sandbox identities. Retirement tombstones are permanent.
Operations may be deleted later by retention policy only after the identity
tombstone remains sufficient to fail closed.

## Module interfaces

`SandboxAuthority` must hide raw D1 rows. Its external operations are:

- register a runtime identity
- rotate a lifecycle generation before replacement
- retire an identity permanently
- bracket one privileged operation with guaranteed closure
- resolve one outbound request from trusted handler context

`SandboxEgressBroker` exposes only `handleOutbound(request, context)`. It owns
contract classification, authority lookup, denial recording, fresh upstream
request construction, response header limits, and redirect rejection.

The broker uses a named catch-all outbound handler with trusted parameters that
contain identity ID and lifecycle generation. Validate `ctx.containerId`
against D1. The sandbox supplies none of those values.

## Brokered fetch contract

1. Accept only `github.com` on port 443 and exact smart-HTTP paths for the
   project's owned `owner/repo.git`.
2. Permit only ref discovery and `git-upload-pack` requests required for the
   exact default branch. Bound methods, headers, query fields, body bytes,
   protocol version, pkt-line count, object IDs, capabilities, and response
   bytes.
3. Remove caller authorization, cookie, proxy, forwarding, and protocol headers
   that the contract does not explicitly allow.
4. Mint the installation token only after durable authority and the full
   request contract pass.
5. Construct a new upstream HTTPS request. Use `redirect: "manual"` and reject
   redirects.
6. Stream pack data. Do not buffer request or response bodies.
7. Permit the builder to fetch only the repository and refs recorded in its
   provisioning operation. Give it no model operation and no project
   environment values.

Use the official Git smart-HTTP and pack protocol documents as the grammar:

- https://git-scm.com/docs/gitprotocol-http
- https://git-scm.com/docs/gitprotocol-pack
- https://git-scm.com/docs/gitprotocol-v2

## Project seed flow

1. Authorize the GitHub repository before inserting or starting a builder.
2. Insert the project, pending seed row, identity, and provisioning operation in
   one D1 batch before sandbox work.
3. Create a random lowercase UUID sandbox ID and trusted identity. Set the
   broker handler before the first network command.
4. Fetch the owned default branch through the broker into `/workspace` with a
   public GitHub URL and disabled redirects, hooks, credential helpers, and
   inherited Git configuration.
5. Configure Ditto Git identity and apply the dependency policy.
6. Compute the complete compatibility key from the spec.
7. Create the seed through the token-free archive module.
8. Mark the project ready only after seed metadata is durable.
9. Close operations, destroy the builder, and retire its identity on every
   outcome. Keep the tombstone if R2 cleanup is pending.

## Tests

Test the external broker seam and project-seed flow. Prove:

- unknown, stale, mismatched, and retired identities fail before token mint
- one identity cannot open two `git_transport` operations
- a fixed placeholder carries no authority without an open operation
- wrong repository, ref, method, path, query, content type, protocol version,
  body size, capability, or redirect fails closed
- denied privileged requests never fall through to public internet forwarding
- builder environment and process listings contain no platform or project
  credentials
- project readiness follows durable seed storage
- builder destruction leaves a permanent identity tombstone
- an archive failure leaves the project failed and does not promote a seed

Keep the existing isolated temp-bare and ref-validation tests. Adapt them to a
credential-free network command instead of deleting their local isolation
coverage.

## Verification

```bash
pnpm db:generate
pnpm --filter @ditto/web test -- src/lib/sandbox-authority.test.ts src/lib/sandbox-egress-broker.test.ts src/lib/git-fetch-contract.test.ts src/lib/project-seed.test.ts src/lib/privileged-git.test.ts
pnpm typecheck
pnpm build
pnpm verify
```

Run the local Sandbox integration gate from plan 001 with an actual private test
repository. Expected result: fetch succeeds, the builder environment has no
installation token, and every malformed contract case fails.

## Done criteria

- New projects own immutable seed metadata and no persistent sandbox.
- Builder Git fetch uses the broker and keeps the installation token in the
  Worker.
- D1 can reject stale and retired identities without consulting a sandbox.
- The builder is destroyed and permanently retired after seed creation.
- Existing project rows remain readable until plan 012 resets pre-launch data.

## Maintenance note

Pin each Git-fetch request shape to a contract version. A Git or Sandbox SDK
upgrade must add and test a new version before changing the accepted grammar.

## Stop conditions

- If the trusted handler context cannot bind both container ID and lifecycle
  generation, stop and return to plan 001.
- If the Git client emits an unbounded or undocumented request shape that the
  contract cannot validate, stop. Do not forward it with credentials.
- If safe fetch requires a token in a URL, environment, file, or process
  argument, stop.
