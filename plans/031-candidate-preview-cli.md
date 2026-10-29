# Plan 031: `ditto-workspace preview command` and `preview ready` discover and waits for the candidate preview

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan
> in `plans/README.md`, unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat f554a6b..HEAD -- packages/sandbox-runner/src/workspace-cli.ts packages/sandbox-runner/src/workspace-cli.test.ts apps/web/src/lib/session-preview.ts`
> If any of these files changed, compare the "Current state" excerpts against the live code; on a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (new subcommands only; existing `status`, `commit` and `fetch` behavior unchanged)
- **Depends on**: none. Plan 032 calls these subcommands.
- **Category**: direction (build, from decision `plans/decisions/024-candidate-preview-delivery.md`)
- **Planned at**: commit `f554a6b`, 2026-10-29

## Why this matters

Candidate sessions (the new "Pi Durable" runtime) run the user's repository in a dedicated sandbox with the checkout at `/workspace`. The runtime must start a dev-server preview on fixed port 10000, but the spec says the command is discovered inside the image, never supplied by a caller. Today the image's `ditto-workspace` CLI has only Git subcommands, so there is nothing to call. This plan adds two subcommands: `preview command`, which prints the discovered dev-server command, and `preview ready`, which waits until port 10000 accepts TCP connections. The runtime (plan 032) starts the process through the Sandbox SDK and calls these subcommands around it.

## Current state

- `packages/sandbox-runner/src/workspace-cli.ts`: the image CLI, linked as `/usr/local/bin/ditto-workspace` (`Dockerfile:32`). It prints one JSON line and exits 0 when `ok`, 1 otherwise. `run` is synchronous today:

```ts
// packages/sandbox-runner/src/workspace-cli.ts:27-62
export function run(
	argv: string[],
	workspace: string = WORKSPACE_PATH,
): WorkspaceGitResult {
	const [action, ...rest] = argv;
	if (action === "status") { ... }
	if (action === "commit") { ... }
	if (action === "fetch") { ... }
	return { ok: false, error: "invalid_args" };
}

export async function main(
	argv: string[] = process.argv.slice(2),
): Promise<number> {
	const result = run(argv);
	process.stdout.write(`${JSON.stringify(result)}\n`);
	return result.ok ? 0 : 1;
}
```

- `packages/sandbox-runner/src/workspace-git.ts:4` exports `WORKSPACE_PATH = "/workspace"`. `:24-28` defines `WorkspaceGitResult` (a union of `{ ok: true, ... }` shapes and `{ ok: false; error: WorkspaceGitErrorCode }`).
- The legacy web app already discovers preview commands. Port that logic; do not import it, since the runner is a separate npm package.
- **Departure from decision 024, recorded:** the decision named `preview start|stop`. A command run through `sandbox.exec` must exit before it returns, so it cannot hold a dev server. The runtime therefore starts, kills and inspects the process through the SDK, and this CLI only discovers the command and waits for readiness. Readiness is TCP-only (decision 024 says "readiness on port 10000"). The legacy path also probes HTTP, so the first request after `ready` may still return 5xx while the dev server compiles. Source: `apps/web/src/lib/session-preview.ts`:
  - constants `:73-77`: `PACKAGE_JSON_MAX_BYTES = 64 * 1024`, `VITE_MIN_MAJOR = 6`, `VITE_MIN_MINOR = 1`, `ASTRO_MIN_MAJOR = 5`, `ASTRO_MIN_MINOR = 4`
  - `asStringMap` `:211-226`, `parseLeadingSemver` `:232-241`, `isMinVersion` `:243-260`, `isViteVersionSupported`/`isAstroVersionSupported` `:262-268`
  - `discoverPreviewCommand` `:270-430`. Port these rules exactly, in order:
    1. `package.json` exists, is at most 64 KiB, parses as JSON, and is a plain object.
    2. `scripts` passes `asStringMap`: a plain object whose keys are 1–256 characters and whose values are strings of at most 1024 characters. A failing `scripts` means unsupported. A failing `dependencies` or `devDependencies` falls back to `{}` (`:305-306`).
    3. `scripts.dev`, **trimmed**, is non-empty (`:310`). `predev`/`postdev` reject only when truthy (`:314`).
    4. The trimmed dev script is exactly one of `vite`/`vite dev`, `next`/`next dev`, `astro`/`astro dev`.
    5. The matching package is declared in `dependencies` or `devDependencies`.
    6. For Vite and Astro only, `node_modules/<pkg>/package.json` has a `version` that passes `parseLeadingSemver`: strict `x.y.z` with an optional `+build`; prereleases are rejected (`:236`). It must also meet the minimum (Vite ≥ 6.1, Astro ≥ 5.4). Next has no version check (`:409-414`).
    7. `node_modules/.bin/<tool>` exists (symlinks followed, as the legacy check does).

    The legacy return also has a `framework` field. Drop it: plan 032 does not read it. Commands and env:
    - vite: `./node_modules/.bin/vite --host 0.0.0.0 --port 10000 --strictPort`, env `{ HOST: "0.0.0.0", PORT: "10000", __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: ".ayn.wtf" }`
    - astro: `./node_modules/.bin/astro dev --host 0.0.0.0 --port 10000 --allowed-hosts=.ayn.wtf`, same env
    - next: `./node_modules/.bin/next dev --hostname 0.0.0.0 --port 10000`, env `{ HOST: "0.0.0.0", PORT: "10000" }`
- Test exemplar: `packages/sandbox-runner/src/workspace-git.test.ts` creates temp dirs with `fs.mkdtempSync(path.join(os.tmpdir(), ...))`, cleans them up in `afterEach`, and calls `run([...], workspace)` directly. Match it.
- Style: tabs, double quotes, no comments unless a constraint is non-obvious (repo `AGENTS.md`).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install (fresh worktree) | `npm ci --prefix packages/sandbox-runner` | exit 0 |
| Runner tests (focused) | `npm test --prefix packages/sandbox-runner -- src/workspace-preview.test.ts` | all pass |
| Runner verify | `pnpm runner:verify` | exit 0 (typecheck, all tests, build) |
| Lint/format | `pnpm check` (needs `pnpm install` in a fresh worktree; never symlink `node_modules` from another checkout) | exit 0 |

## Scope

**In scope:**
- `packages/sandbox-runner/src/workspace-preview.ts` (create)
- `packages/sandbox-runner/src/workspace-preview.test.ts` (create)
- `packages/sandbox-runner/src/workspace-cli.ts`

**Out of scope:**
- `apps/web/src/lib/session-preview.ts`: the legacy path stays as is; copy logic, don't refactor it.
- `Dockerfile`: the CLI link already exists, and port 10000 is already exposed.
- Starting, stopping or killing processes. The runtime does that through the SDK in plan 032. These subcommands must never spawn the dev server.
- Installing dependencies (`npm install` in `/workspace`). An unsupported or uninstalled project returns `unsupported_project`.

## Git workflow

- Commit on your current branch; do not push or open a PR.
- Message style (from `git log`): `feat(runner): add ditto-workspace preview discovery`.

## Steps

### Step 1: Discovery module

Create `packages/sandbox-runner/src/workspace-preview.ts` exporting:

```ts
export const PREVIEW_PORT = 10000;
export type PreviewResult =
	| { ok: true; command: string; cwd: string; env: Record<string, string> }
	| { ok: true; ready: true }
	| { ok: false; error: "unsupported_project" | "not_ready" | "invalid_args" | "preview_failed" };
export function discoverPreview(workspace: string): PreviewResult;
export function waitForPreview(port: number, timeoutMs: number, connect?: (port: number, attemptMs: number) => Promise<boolean>): Promise<PreviewResult>;
```

- `discoverPreview` ports the legacy rules above (numbered 1–7), using synchronous `fs` calls relative to `workspace`. Any failed check, unreadable file or bad JSON returns `{ ok: false, error: "unsupported_project" }`. On success, return the command and env exactly as listed above, with `cwd: workspace`.
- **The repository is untrusted.** Read each JSON file (`package.json` and `node_modules/<pkg>/package.json`) through one helper:
  - `fs.statSync(file)` must report `isFile()` and `size <= 64 * 1024`.
  - Only then call `readFileSync(file, "utf8")`.
  - Anything else counts as unsupported.
  - This stops a FIFO, a device, or a symlink to `/dev/zero` from hanging the command or exhausting memory.
- `waitForPreview(port, timeoutMs, connect)` sets `deadline = Date.now() + timeoutMs` and loops:
  - Each attempt calls `connect(port, Math.min(1000, deadline - Date.now()))`, so an attempt never overruns the deadline.
  - True → return `{ ok: true, ready: true }`.
  - False → sleep `min(250, remaining)` and try again until the deadline passes, then return `{ ok: false, error: "not_ready" }`.
  - The default `connect(port, attemptMs)` opens `net.createConnection({ host: "127.0.0.1", port })`. It resolves true on `connect` and false on `error` or after `attemptMs`, and destroys the socket in every case.
  - Update the signature to `connect?: (port: number, attemptMs: number) => Promise<boolean>`.

**Verify**: `npm run typecheck --prefix packages/sandbox-runner` → exit 0.

### Step 2: CLI subcommands

In `workspace-cli.ts`:
- **Leave `run` synchronous and unchanged.** `workspace-git.test.ts` calls it synchronously in many places, including through its `commit()` helper. Do not edit that file.
- Add `export async function runPreview(argv: string[], workspace: string = WORKSPACE_PATH): Promise<PreviewResult>`, where `argv` excludes the leading `preview`:
  - `["command"]` → `discoverPreview(workspace)`.
  - `["ready", "--timeout-ms", n]`: `n` must match `/^[1-9]\d*$/` and be `<= 120000`, else `invalid_args`. Calls `waitForPreview(PREVIEW_PORT, Number(n))`.
  - Anything else → `{ ok: false, error: "invalid_args" }`.
- `main`: if `argv[0] === "preview"`, use `await runPreview(argv.slice(1))`, otherwise `run(argv)`. Write the JSON line and exit code as today.
- The top-level `.catch` (`workspace-cli.ts:83-88`) prints `git_failed`. Make it print `{"ok":false,"error":"preview_failed"}` when `process.argv[2] === "preview"`, so a preview crash is never reported as a Git failure. Keep `git_failed` otherwise.

**Verify**: `npm test --prefix packages/sandbox-runner -- src/workspace-git.test.ts src/workspace-cli.test.ts` → all pass, with `workspace-git.test.ts` unmodified.

### Step 3: Tests

Create `workspace-preview.test.ts` (see Test plan).

**Verify**: `npm test --prefix packages/sandbox-runner -- src/workspace-preview.test.ts` → all pass.

### Step 4: Full gate

**Verify**: `pnpm runner:verify` → exit 0. `pnpm check` → exit 0.

## Test plan

In `packages/sandbox-runner/src/workspace-preview.test.ts`, temp-dir fixtures as in `workspace-git.test.ts`. Write `package.json`, `node_modules/<tool>/package.json` with a `version`, and an empty `node_modules/.bin/<tool>` file.

1. A Vite 6.1.0 project with `"dev": "vite"` → the exact vite command, `cwd`, and env including `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS`.
2. Vite 6.0.9 → `unsupported_project`.
3. Next with `"dev": "next dev"` → the exact next command.
4. Astro 5.4.0 → the exact astro command. Astro 5.3.0 → unsupported.
5. Unsupported cases:
   - `predev` present
   - `"dev": "vite --open"`
   - the dependency not declared
   - a missing `.bin` file
   - `package.json` over 64 KiB
   - invalid JSON
   - Vite version `6.2.0-beta.1` (prerelease)
   - `package.json` that is a directory instead of a file
6. Discovery edge cases:
   - `"dev": "  vite  "` (padded) is supported.
   - `predev: ""` (empty) does not reject.
   - Next with no `node_modules/next/package.json`, but with `.bin/next`, is supported (no version check).
   - A non-object `dependencies` with the package declared in `devDependencies` is supported.
7. `runPreview` rejects these with `invalid_args`:
   - `["ready","--timeout-ms","0"]`, `"abc"`, `"1e3"`, `"0x10"`, `" 5"` and `"120001"`
   - `["start"]`
   - `[]`
   - `["command","extra"]`
8. `waitForPreview` with an injected `connect`:
   - false twice, then true → `{ ok: true, ready: true }`
   - always false, with `timeoutMs` 300 → `not_ready`, and the call took less than 800 ms
   - every `attemptMs` it received was at most the remaining time
9. `waitForPreview` with the real connect against `net.createServer().listen(0, "127.0.0.1")` → ready.

## Done criteria

- [ ] `pnpm runner:verify` exits 0
- [ ] `pnpm check` exits 0
- [ ] After the build, `node packages/sandbox-runner/dist/workspace-cli.js preview start` prints `{"ok":false,"error":"invalid_args"}` and **exits 1**. Exit 1 is expected here.
- [ ] `git status` shows only the three in-scope files; `workspace-git.test.ts` is unchanged

## STOP conditions

- The legacy `discoverPreviewCommand` at `session-preview.ts:270-430` differs materially from the rules above (drift).
- Any existing test in `packages/sandbox-runner` needs an edit to keep passing.
- Any need to spawn or kill a process from the CLI.

## Maintenance notes

- The candidate discovery is a copy of the legacy one. When the legacy path is retired (plan 019), the copy becomes the only one; until then, a supported-framework change must be made in both places.
- `.ayn.wtf` in the env matches the production preview zone. Local `*.localhost` hosts are already allowed by Vite's defaults.
