# Plan 021: Document process-injected project environment variables accurately

> **Executor instructions**: This is documentation alignment only. Do not
> reintroduce `.env` symlinks or change runtime environment handling.
>
> **Drift check (run first)**:
> `git diff --stat 6403dd3..HEAD -- docs/architecture/agent-harness.md plans/README.md README.md src/lib/session-worktree.ts src/lib/agent-run.ts`

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: existing plan 010 if it has landed, because both update the
  architecture document
- **Category**: docs
- **Planned at**: commit `6403dd3`, 2026-07-12
- **Reconciled from**: original draft at `5ad5e0c`; plan 010 and plans 011–020
  are now present on the current branch, and the documentation finding remains.

## Why this matters

The architecture document still says `.env` is symlinked into session
worktrees, although the reconciled locked-decision table no longer does. The
live implementation symlinks only `node_modules`; project configuration is
decrypted in the Worker and injected into the sandbox shell process. The stale
architecture claim sends maintainers toward a nonexistent file and could
encourage reintroducing persistent secret-bearing files.

## Current state

- `docs/architecture/agent-harness.md:56-57,92-94` still says `node_modules`
  and `.env` are symlinked.
- `plans/README.md` was corrected by this advisor run to record the intended
  process-injection decision; keep it as the index-side source of truth while
  bringing the architecture document into alignment.
- `src/lib/session-worktree.ts:97-109` creates only the shared `node_modules`
  symlink.
- `src/lib/agent-run.ts:56-65,91-101` converts project values to an environment
  record and injects them into
  `sandbox.createSession({ env })`; callback/provider secrets follow the same
  process-only boundary.
- The current `plans/README.md` context and locked-decision table already say
  that worktrees share only `node_modules` and project configuration is
  process-injected; preserve that reconciled wording.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Stale text audit | `rg -n "symlink.*\.env|\.env.*symlink" README.md docs plans/README.md` | no claim that runtime symlinks `.env` |
| Runtime evidence | `rg -n "node_modules|createSession|projectEnv" src/lib/session-worktree.ts src/lib/agent-run.ts` | matches documented paths |
| Docs/check gate | `pnpm check` | exit 0 |

## Scope

**In scope**:

- `docs/architecture/agent-harness.md`
- `plans/README.md` locked decision/context/dependency notes and this plan's
  status row
- `README.md` only if a nearby note needs one clarifying sentence

**Out of scope**:

- Any TypeScript, migration, runtime, secret, worktree, or backup change.
- Adding `.env` files, examples with values, or secret rotation instructions.
- Rewriting completed plan files 001-010 as historical artifacts.

## Git workflow

- Branch: `advisor/021-environment-docs`
- Suggested commit: `docs(agent): clarify process-only environment injection`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Correct the runtime and concurrency sections

State explicitly:

- worktrees symlink `/workspace/node_modules` only;
- project environment values are stored encrypted in D1, decrypted by the
  Worker for a run, and passed through the sandbox shell session's `env`;
- provider and callback credentials are also process environment values and
  must not be stored in worktree files, job JSON, SSE, or git remotes;
- the agent can still read its process environment through bash, so output
  redaction/pre-push policy (plans 012/013) remains necessary.

Do not overclaim that process environment is inaccessible to the agent.

**Verify**: stale text audit returns no incorrect symlink claim.

### Step 2: Verify the locked decision table remains aligned

Confirm the Dependencies cost row mentions only `node_modules` symlinking and
the Project environment row points to process injection. If those advisor-added
rows are present, do not rewrite them beyond updating this plan's status.
Preserve all other locked decisions and existing user modifications.

**Verify**: `git diff -- plans/README.md docs/architecture/agent-harness.md`
shows only the intended documentation/index additions.

### Step 3: Run the documentation gate

**Verify**: `pnpm check` exits 0; both grep commands match the live design.

## Test plan

No runtime test is required. Verification is the stale-claim grep, comparison
against the two canonical source files, and Biome check.

## Done criteria

- [ ] No current architecture/index text claims `.env` is symlinked.
- [ ] Docs accurately distinguish encrypted storage, Worker decryption, and
  process injection.
- [ ] Docs do not claim the agent cannot inspect its own process environment.
- [ ] No runtime or historical completed-plan file changed.
- [ ] `pnpm check` passes and index status is updated.

## STOP conditions

- Live `session-worktree.ts` has begun symlinking `.env` again; report the code
  regression/security decision instead of documenting it as intended.
- Plan 010 has an unmerged conflicting architecture-doc rewrite.

## Maintenance notes

Treat `session-worktree.ts` and `agent-run.ts` as the canonical runtime sources.
Future environment delivery changes must update the architecture security notes
in the same change.
