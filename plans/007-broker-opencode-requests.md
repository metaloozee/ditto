# Broker OpenCode requests

Status: TODO

Written against commit `62c99b4`. Complete plan 006 first.

Before editing, compare the current commit and target spec with plan 001's
recorded values. Read drift in PI, OpenCode, agent, metadata, authority, and
broker code. Stop if the fixed model or request-contract assumptions changed.

## Goal

Keep `OPENCODE_API_KEY` in the Worker while preserving normal chat and Git
metadata generation. Sandbox code uses one fixed public placeholder that has no
authority without a current identity and an open D1 operation.

## Why this plan follows session isolation

The old project sandbox can host concurrent workspace sessions. A trusted
outbound handler sees the sandbox identity, not the process that issued a
request. Switching OpenCode earlier would let one session use another
session's operation window. Plan 006 gives each workspace session a distinct
identity first.

## Current state

`agent-run.ts` places `DITTO_PI_CREDENTIAL` in the agent shell. Git metadata
does the same in `session-git-metadata.ts`. `runner-model.ts` deletes the value
before PI creates tools, but the sandbox already held the real credential.

## Files in scope

- `apps/web/src/lib/sandbox-authority.ts` and tests
- `apps/web/src/lib/sandbox-egress-broker.ts` and tests
- a new exact OpenCode request-contract adapter and tests
- `apps/web/src/lib/agent-run-service.ts` and tests
- `apps/web/src/lib/agent-run.ts` and tests
- `apps/web/src/lib/session-git-metadata.ts` and tests
- `packages/sandbox-runner/src/runner-model.ts` and tests
- `packages/sandbox-runner/src/run-agent.ts` and tests
- `packages/sandbox-runner/src/run-git-metadata.ts` and tests
- `apps/web/src/server.ts` only to connect the already-proved broker handler
- affected architecture and security docs

Do not change Git callback transport or GitHub network transport in this plan.

## Authority model

Use the operation-family rules from plan 001:

- `agent_run` is an unbounded-request `model` operation with an expiry equal to
  the bounded agent command window.
- `git_metadata` is a one-request `model` operation with a short expiry.
- Only one `model` operation may be open per identity.
- A one-request operation increments its consumed count atomically before the
  upstream request starts.
- Close the operation in `finally` when the command settles, the runtime becomes
  stale, Stop completes, archive starts, or deletion starts.

If the OpenCode key is missing, reject the operation before creating a sandbox
session, writing a job, inserting messages, or mutating Git state.

## Runner credential behavior

1. Delete all code that reads a real model credential from the process
   environment.
2. Seed PI's in-memory credential store with one code-owned public placeholder
   for the exact fixed model. Do not put even that placeholder in a shell
   environment if the runner can create it directly.
3. Keep `modelsPath: null` and `allowModelNetwork: false`.
4. Reject every model other than `opencode/deepseek-v4-flash-free`.
5. Preserve the locked resource loader from plan 002.

## OpenCode request contract

Derive the exact versioned request schema from the local contract capture in
plan 001. Do not accept a generic OpenAI-compatible request.

Validate before forwarding:

- trusted identity, generation, operation type, expiry, and request budget
- exact placeholder authorization
- HTTPS host, port, method, path, and query
- bounded content length, content type, content encoding, and stream protocol
- duplicate and unknown fields
- the complete request body schema and exact model
- absence of cookies, user authorization, proxy, forwarding, and alternate
  authority headers
- request-contract version

Buffer only the bounded JSON request body needed for complete schema validation.
Construct a new upstream request from validated fields. Set the real key only
on that request. Use `redirect: "manual"`.

Stream the upstream response. Allow only documented status codes and a bounded
set of headers. Do not buffer model output. Preserve cancellation by forwarding
the request abort signal.

After three contract denials in one operation, close the operation, fail the
agent run, and set a durable review reason on the workspace session. Keep the
threshold as a named deployment constant with tests.

## Tests

Test absence as well as success:

- agent, metadata, control, preview, backup, Git, and container environments
  contain no OpenCode key or serialized real credential
- `/proc` and command arguments contain no real key during a local run
- missing or invalid key fails before side effects
- unknown identity, stale generation, closed operation, wrong operation type,
  wrong placeholder, wrong model, malformed JSON, duplicate fields, unknown
  authority fields, oversized body, wrong streaming mode, and redirect fail
  closed
- failed privileged requests never reach the public internet adapter
- metadata consumes exactly one request under contention
- agent operations allow multiple valid requests until expiry or closure
- response streaming and cancellation do not buffer the complete response
- three denials close the operation and mark review without deleting recovery
  data

## Verification

```bash
pnpm --filter @ditto/web test -- src/lib/open-code-contract.test.ts src/lib/sandbox-egress-broker.test.ts src/lib/agent-run-service.test.ts src/lib/agent-run.test.ts src/lib/session-git-metadata.test.ts
npm test --prefix packages/sandbox-runner -- src/runner-model.test.ts src/run-agent.test.ts src/run-git-metadata.test.ts
rg -n "DITTO_PI_CREDENTIAL|OPENCODE_API_KEY" apps/web/src packages/sandbox-runner/src
pnpm typecheck
pnpm runner:verify
pnpm verify
```

Expected result: `OPENCODE_API_KEY` appears only in Worker configuration and
broker code. `DITTO_PI_CREDENTIAL` has no runtime source reference. All commands
exit 0.

Run the local Sandbox integration gate. Confirm HTTPS trust, streamed output,
cancellation, and credential absence.

## Done criteria

- The real OpenCode key never enters any sandbox.
- Agent and metadata requests cross one versioned broker contract.
- The handler checks D1 for every privileged request.
- Git metadata consumes one request atomically.
- Normal chat streaming, follow-up, Stop, and thinking levels remain available.

## Maintenance note

PI or OpenCode upgrades require a captured request diff and a new contract
version. Never widen the existing schema to make an upgrade pass.

## Stop conditions

- If PI sends materially different request bodies for the same pinned runner
  version, stop and version each supported shape explicitly.
- If response cancellation cannot propagate through the handler, stop and fix
  the streaming adapter before switching credentials.
- If any fallback needs a real credential inside the sandbox, remove the
  fallback. Do not restore environment injection.
