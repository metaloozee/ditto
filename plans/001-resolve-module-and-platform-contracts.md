# Resolve module and Sandbox platform contracts

Status: DONE

Written against commit `62c99b4`. The target spec digest was
`d24ce53aeb29603f6c743e90354387828687299c199859e0d8988648ff262460`.

Executed 2026-08-20 in worktree
`/home/ayan/.grok/worktrees/ayan-ditto/subagent-01a01ffd-4672-7ee0-8e6c-8ef3f79c38e8`.
Advisor verdict: accept. Spec digest after execution:
`f104e9ba66b97ce8f5a196a08854fa7819cfd7e37186f8b46cfb429c2124c5b3`.
HEAD remains `62c99b4`. Changes are uncommitted in the worktree.

Before editing, run `git rev-parse --short HEAD` and `sha256sum
docs/specs/platform-credential-broker.md`. Read the intervening diff if either
value changed. Stop if the trust model, required guarantees, or cutover rules
changed.

## Goal

Turn the approved behavior in `docs/specs/platform-credential-broker.md` into an
implementable module design. Prove the stable Sandbox SDK facts that later
plans depend on. This is a design and local-spike plan. It does not switch any
production path.

## Why this plan comes first

The spec currently names D1 records and lifecycle steps but does not define the
interfaces that own them. It also uses both "current authorized operation" and
"all open operations." A fixed public placeholder cannot select between two
open operations in the same contract family.

`apps/web/src/server.ts` currently exports the stock class:

```ts
export { Sandbox } from "@cloudflare/sandbox";
```

The installed SDK supports a subclass, a catch-all outbound handler,
`ctx.containerId`, dynamic handler parameters, HTTPS interception, and
`ContainerProxy`. Prove those facts locally before later plans rely on them.

## Files in scope

- `docs/specs/platform-credential-broker.md`
- `docs/research/sandbox-security-architecture-research.md`, only if a measured
  platform result corrects the existing research
- temporary probe code under `.scratch/platform-credential-broker/`
- no application source files in the finished diff

Do not change `apps/web/src/server.ts`, `alchemy.run.ts`, D1 schema, or runtime
code in the final diff. Do not deploy the probe.

## Module decisions to add to the spec

Add one "Module design" section. Use these names consistently.

1. `SandboxAuthority` owns identity registration, lifecycle generation,
   permanent retirement, operation opening and closure, and request resolution.
   Callers never receive raw authority rows.
2. `SandboxEgressBroker` exposes one handler interface for sandbox outbound
   traffic. It dispatches to internal request-contract adapters and the public
   internet policy.
3. `ProjectSeed` builds and restores immutable project seeds. It depends on the
   authority, Git-fetch contract, and archive transport inside its
   implementation.
4. `WorkspaceRuntime` owns sandbox readiness, lifecycle leases, capacity work,
   restore, retirement, and the trusted sandbox adapter returned to callers.
5. `WorkspaceRecovery` accepts only a runtime-issued exclusive workspace lease.
   It owns checkpoint generations, R2 metadata, restore fallback, and cleanup.

Specify these operation rules:

- Contract families are `model`, `git_transport`, and `ditto_action`.
- An identity can have at most one open operation in each family.
- Different families may overlap. This permits an agent run to request a Git
  action without making operation selection ambiguous.
- The handler chooses the sole open operation for the request's classified
  family. The sandbox never supplies an operation ID.
- `git_metadata` and other bounded operations reserve one request atomically in
  D1 before forwarding. A failed upstream request does not restore the count.
- The first implementation does not cache open-operation authority.

Correct the lifecycle diagram so both provisioning and restore can reach
`ready`. Define a running capacity slot as an unexpired D1 lease held by a
runtime that the Worker most recently observed as active. A cold `ready`
runtime owns no slot until work requests a wake.

## Local spike

Use the existing Alchemy development environment. Temporary code may expose a
localhost-only diagnostic route while `pnpm dev` runs, but remove that code
before finishing.

Prove all of these behaviors against `@cloudflare/sandbox@0.12.3`:

1. A Ditto-owned subclass can set `enableInternet = false` and register a
   catch-all named outbound handler.
2. Exporting `ContainerProxy` makes HTTP and HTTPS interception work locally.
3. `ctx.containerId` remains stable for one Sandbox Durable Object.
4. Parameters passed through `setOutboundHandler()` reach the handler and
   cannot be supplied or changed by a sandbox request.
5. A public request rejected by the privileged classifier does not bypass the
   catch-all handler.
6. Node.js inside the image trusts the interception certificate without
   disabling TLS verification.
7. RPC `readFile(path, { encoding: "none" })` and `writeFile(path, stream)` move
   a binary file larger than 32 MiB without base64 conversion.
8. The Worker can stream that file to and from the local R2 binding without
   exposing an object key or R2 configuration to the sandbox process.

Record commands, SDK version, image version, observed identifiers, byte counts,
and pass or fail results in the spec. Do not record request bodies, credentials,
headers, query strings, archive content, or bearer values.

Platform references:

- https://developers.cloudflare.com/sandbox/guides/outbound-traffic/
- https://developers.cloudflare.com/sandbox/configuration/transport/
- https://developers.cloudflare.com/sandbox/api/files/

## Verification

Run the local spike twice from a clean sandbox ID. The second run must not rely
on state created by the first run.

Then run:

```bash
git diff --check -- docs/specs/platform-credential-broker.md
git status --short
```

Expected result: the spec and optional research document are the only durable
changes. `.scratch/` remains ignored.

## Done criteria

- The spec contains all five module interfaces and operation-family rules.
- The lifecycle diagram contains `restoring -> ready`.
- Capacity slot ownership has one durable definition.
- Every spike item has a dated local result.
- No application code or deployment configuration remains changed.

## Maintenance note

Rerun this contract spike before changing the Sandbox SDK, container base
image, RPC transport, or outbound-handler configuration. A passing unit test is
not a substitute for the local container checks in this plan.

## Stop conditions

- If handler parameters can be controlled from the sandbox, stop and revise the
  identity design. Do not replace them with a sandbox bearer token.
- If `ctx.containerId` cannot be related to a Worker-created identity, stop and
  design a trusted Sandbox RPC that returns its Durable Object ID.
- If HTTPS interception requires disabling certificate verification, stop. The
  OpenCode and Git broker plans cannot proceed.
- If RPC file streaming buffers the full file in Worker memory, stop and revise
  the archive design.
