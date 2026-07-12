# Plan 016: Return 401 for every malformed agent callback JWT

> **Executor instructions**: Keep this a narrow defensive change. Do not replace
> the JWT scheme or alter claims/TTL. Run the route-level malformed-token tests.
>
> **Drift check (run first)**:
> `git diff --stat 5ad5e0c..HEAD -- src/lib/agent-git-jwt.ts src/lib/agent-git-jwt.test.ts src/routes/api.agent.git.ts src/routes/api.agent.git.test.ts`

## Status

- **Status**: DONE
- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/011-establish-verification-baseline.md`
- **Category**: bug, security
- **Planned at**: commit `5ad5e0c`, 2026-07-11
- **Implemented**: commit `48d8923` on branch `advisor/016-malformed-agent-jwt`
- **Worktree**: `/home/ayan/.grok/worktrees/ayan-ditto/subagent-019f5576-3a5a-7a41-bb54-88b40d70057e`

## Why this matters

A syntactically three-part bearer token with invalid Base64 can throw from
`atob` before verification reaches its malformed-payload catch. The route calls
verification outside its dispatch try/catch, so untrusted credentials can
produce an unhandled 500 instead of the intended 401 and generate avoidable
error noise.

## Current state

```ts
// src/lib/agent-git-jwt.ts:29-37
const decoded = atob(padded + "=".repeat(padLen));
```

Signature decoding and `crypto.subtle.verify` occur at lines 105-118, outside
the payload JSON catch. `api.agent.git.ts:30-39` awaits verification before the
route's action-dispatch try/catch. Existing JWT tests are the exemplar; create
a route test only if none exists.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Focused | `pnpm test -- src/lib/agent-git-jwt.test.ts src/routes/api.agent.git.test.ts` | all pass |
| Full | `pnpm verify` | exit 0 |

## Scope

**In scope**: `src/lib/agent-git-jwt.ts`, its test, `api.agent.git.ts`, a focused
route test, and plan index status.

**Out of scope**: new algorithms/keys, key separation, revocation, TTL changes,
rate limiting, or exposing verification reasons to callers.

## Git workflow

- Branch: `advisor/016-malformed-agent-jwt`
- Suggested commit: `fix(auth): reject malformed agent callback tokens`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Make verification total over arbitrary strings

Wrap header/payload/signature decoding, key import, and Web Crypto verification
so every parsing/decoding exception maps to `{ ok: false, reason: "malformed" }`.
A validly encoded but incorrect signature must remain `bad_signature`; expiry
and subject classifications remain unchanged. Do not include token fragments in
errors or logs.

**Verify**: JWT tests pass for invalid alphabet, bad padding/length, malformed
JSON, empty segments, valid bad signature, expired, and valid tokens.

### Step 2: Assert the HTTP boundary

Add a route-level test that sends each malformed bearer class and receives the
same generic 401 JSON response. Confirm dispatch/database helpers are not
called. Keep cookie auth irrelevant to this callback route.

**Verify**: focused command -> all tests pass with no unhandled rejection.

### Step 3: Run full verification

**Verify**: `pnpm verify` -> exit 0.

## Test plan

- Invalid Base64 alphabet and impossible padding/length in each JWT segment.
- Decodable non-JSON header/payload and missing required claims.
- Valid encoding with a bad signature remains `bad_signature` internally.
- Expired/invalid-sub classifications remain unchanged.
- HTTP route returns generic 401 and never calls dispatch/database helpers.
- Use `src/lib/agent-git-jwt.test.ts` as the unit-test style exemplar.

## Done criteria

- [x] `verifyAgentGitJwt` never throws for attacker-controlled token text.
- [x] Classification behavior for validly encoded tokens is unchanged.
- [x] Route returns generic 401 and performs no dispatch on malformed tokens.
- [x] Focused tests and full verification pass.

## STOP conditions

- Plan 011's byte normalization has not landed or conflicts with this code;
  reconcile it first.
- Better Auth or a standard JWT library has replaced this helper; do not keep
  two verification implementations.

## Maintenance notes

Future claim fields must be validated inside the same total verification
boundary. Client responses should remain generic even if internal reason codes
become more detailed.
