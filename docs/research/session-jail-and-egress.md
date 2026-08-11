# Same-sandbox session jail and egress research

**Date:** 2026-08-09  
**Ticket:** `.scratch/brain-architecture/issues/03-research-session-jail-and-egress.md`  
**Parent map:** one Brain + one Project Sandbox per project; concurrent Workspace Sessions require an *enforced* filesystem/process boundary; worktrees alone are not security isolation; one sandbox per session is out of scope.  
**Package line examined:** `@cloudflare/sandbox@next` (`0.13.0-next.724.1`), container image line `cloudflare/sandbox` `@next` / matching preview Dockerfile; installed repo still on stable `0.12.3` for runtime, used only as local contrast.  
**Rules:** primary sources and installed/`@next` types/source only; no product source edits; no secrets reproduced.

---

## Executive verdict

| Question | Answer |
| --- | --- |
| Does Sandbox `@next` provide concurrent **security** isolation between Workspace Sessions inside one Project Sandbox? | **No.** Isolation unit is **one sandbox ID → one container (Linux VM)**. Inside that container, processes share filesystem, PID space, IPC, and network. |
| Are stable SDK “sessions” a jail? | **No.** Official docs: sessions are shell tabs; they share FS and process space and are **not** a security boundary. `@next` removes session execution entirely. |
| Can worktrees / `cwd` enforce isolation? | **No.** Cooperative layout only. Same-UID peers can `read`/`write`/`kill` across trees. |
| Is there a supported per-exec UID/jail API on Sandbox `@next`? | **No.** `ExecOptions` = `cwd` / `env` / `timeout` only. Supervisor is plain `Bun.spawn` with full env inheritance. |
| Does low-level Containers `ctx.container.exec` expose `user`? | **Yes** (name or numeric UID from the image). That is a **Containers** API, not wired through Sandbox process/terminal APIs. Using it for session jails means bypassing or wrapping the Sandbox control plane. |
| What **is** enforceable today on deployed Cloudflare Containers? | **Per-container** isolation (other projects/sandboxes); **per-container** egress (`enableInternet`, `allowedHosts`/`deniedHosts`, outbound handlers, HTTPS intercept); reserved control-plane port **3000**; non-secret execution if credentials never enter the container. |
| What remains **cooperative** inside one Project Sandbox? | Session worktrees, preview port pools, shared `node_modules` symlinks, process lists, localhost sockets, kill/signal, env leakage via `/proc`, arbitrary `exec`/`createTerminal`. |
| Hard-isolation prototype status | **Unproven on deployed CF Containers.** Candidate Linux mechanisms (UID split, bubblewrap + user/mount/PID ns, pivot_root) may work **locally in Docker** and still fail under CF’s rootless/capability/userns constraints. Issue `04-prototype-session-isolation` must run the deployed matrix before architecture go. |
| If the jail fails | Ship **restricted path-validating tools + approved-command surface** from the Brain; **deny general interactive terminals** (or make terminal a non-goal). Keep secretless sandbox + container egress. |

**Bottom line for the map:** treat concurrent same-sandbox multi-session **hard isolation as currently unsupported by Sandbox SDK design**. Either (A) prove a custom in-container jail on **deployed** Containers without breaking coding tools, or (B) accept the fallback restricted command surface and drop free-form terminals, or (C) reopen “one sandbox per session” (explicitly out of scope today). Do not call worktree layout a security boundary.

---

## Sources

### Cloudflare Sandbox / Containers (docs)

| Topic | URL |
| --- | --- |
| Sandbox 1.0 preview overview | https://developers.cloudflare.com/sandbox/1-0-preview/ |
| Process execution (`@next`) | https://developers.cloudflare.com/sandbox/1-0-preview/processes/ |
| Processes API (`@next`) | https://developers.cloudflare.com/sandbox/1-0-preview/api/processes/ |
| Terminals (`@next`) | https://developers.cloudflare.com/sandbox/1-0-preview/terminals/ |
| Lifecycle (`@next`) | https://developers.cloudflare.com/sandbox/1-0-preview/lifecycle/ |
| Environment (`@next`) | https://developers.cloudflare.com/sandbox/1-0-preview/environment/ |
| Outbound traffic (Sandbox) | https://developers.cloudflare.com/sandbox/guides/outbound-traffic/ |
| Storage / mounts | https://developers.cloudflare.com/sandbox/api/storage/ |
| Ports / preview URLs | https://developers.cloudflare.com/sandbox/api/ports/ |
| Sandbox options (stable sessions note) | https://developers.cloudflare.com/sandbox/configuration/sandbox-options/ |
| Sessions concept (stable; security disclaimer) | https://developers.cloudflare.com/sandbox/concepts/sessions/ |
| Containers overview | https://developers.cloudflare.com/containers/ |
| Container architecture / VM isolation | https://developers.cloudflare.com/containers/platform-details/architecture/ |
| Container limits | https://developers.cloudflare.com/containers/platform-details/limits/ |
| Outbound traffic (Containers) | https://developers.cloudflare.com/containers/platform-details/outbound-traffic/ |
| Execute commands + `user` option | https://developers.cloudflare.com/containers/execute-commands/ |
| Durable Object `ctx.container` API | https://developers.cloudflare.com/durable-objects/api/container/ |
| Containers FAQ (rootless, DinD, disk) | https://developers.cloudflare.com/containers/faq/ |
| Local development (Docker) | https://developers.cloudflare.com/containers/local-dev/ |

### Linux primary docs

| Topic | URL |
| --- | --- |
| namespaces(7) | https://man7.org/linux/man-pages/man7/namespaces.7.html |
| user_namespaces(7) | https://man7.org/linux/man-pages/man7/user_namespaces.7.html |
| pid_namespaces(7) | https://man7.org/linux/man-pages/man7/pid_namespaces.7.html |
| kill(2) signal permission rules | https://man7.org/linux/man-pages/man2/kill.2.html |
| chroot(2) | https://man7.org/linux/man-pages/man2/chroot.2.html |
| pivot_root(2) | https://man7.org/linux/man-pages/man2/pivot_root.2.html |
| capabilities(7) | https://man7.org/linux/man-pages/man7/capabilities.7.html |
| seccomp filter (kernel docs) | https://www.kernel.org/doc/html/latest/userspace-api/seccomp_filter.html |
| bubblewrap README (userns-based sandbox constructor) | https://raw.githubusercontent.com/containers/bubblewrap/main/README.md |

### First-party source / types inspected

| Artifact | Role |
| --- | --- |
| npm `@cloudflare/sandbox@0.13.0-next.724.1` (`ExecOptions`, Dockerfile) | Public `@next` contract |
| `github.com/cloudflare/sandbox-sdk` branch `next`: `packages/sandbox-container/src/security/security-service.ts` | Explicit security model |
| `…/sandbox-execution/src/process/managed-process-supervisor.ts` | Spawn path: `Bun.spawn`, no UID/ns |
| `…/sandbox-execution/src/process/process-tree.ts` | Cross-process `ps` + `kill` in shared PID ns |
| `…/sandbox-execution/src/pty/pty-process.ts` | Terminals: same spawn/env model |
| `…/sandbox/src/security.ts` | Port policy; note on no privileged ports |
| `@cloudflare/containers@0.3.7` types | Class-level egress knobs |
| Ditto `CONTEXT.md`, `apps/web/src/lib/workspace-policy.ts`, `session-worktree.ts` | Product domain + current cooperative layout |

---

## 1. Platform model (what is actually isolated)

### 1.1 Sandbox ID vs container vs process

Official `@next` process docs distinguish three layers:

1. **Sandbox ID** — stable app key (`getSandbox(env.Sandbox, "project-…")`).
2. **Container** — current Cloudflare Containers instance for that ID (ephemeral; may stop/replace).
3. **Process / terminal** — lives only in the **current** container.

Same sandbox ID does **not** mean same long-lived machine; after stop/replace, process IDs and in-container files are gone unless restored from backup/mount.

### 1.2 Isolation between sandboxes

Containers architecture: each container instance runs **inside its own VM**, providing strong isolation from other workloads on Cloudflare’s network. That is the **supported multi-tenant boundary**.

Sandbox README/feature list: “Secure Isolation — Each sandbox runs in its own container.”

**Implication:** isolation between Project A and Project B (different sandbox IDs) is a platform guarantee. Isolation between Workspace Session A and B **inside** one Project Sandbox is **not**.

### 1.3 Official guidance on multi-user / multi-session

| Source | Statement |
| --- | --- |
| `@next` overview | “Isolate end users with **separate sandboxes**, not sessions inside one sandbox.” |
| Stable sessions concept | Sessions = “terminal tabs in the same computer”; “**not a security boundary** between users because sessions share the same filesystem and process space.” |
| Stable sessions concept | Shared: filesystem + processes (`listProcesses` sees peers). Separate: shell env/cwd only. |
| `@next` | Session execution removed; each `exec` is independent `cwd`/`env`. Still one shared container FS/PID/net. |

### 1.4 Sandbox control-plane security philosophy (source)

`packages/sandbox-container/src/security/security-service.ts` (`next`):

> **Security Model**: Trust container isolation, only protect SDK control plane  
> - Users have full control over their sandbox  
> - Only protect port 3000  
> - Format validation only … **No** path blocking, **no** command blocking, **no** URL allowlists  
> - “users can run bash, sudo, rm -rf — it's their sandbox”

This is intentional product design, not an oversight. The SDK will not become a multi-session MAC layer without a deliberate product change.

---

## 2. Mechanism analysis (same container)

Legend: **Enforced** = platform/kernel enforces against hostile code in-session. **Cooperative** = works only if all sessions obey policy. **Unsupported / unproven** = no SDK support and/or depends on undeployed CF capability evidence.

### 2.1 Worktrees and `cwd`

| Aspect | Status |
| --- | --- |
| Git worktree per session under `/workspace/.ditto/worktrees/<id>` | **Cooperative layout** (Ditto today) |
| `exec`/`createTerminal` `cwd` | Launch convenience only |
| Security boundary? | **No** |

Any same-UID process can `cat`/`rm` another session’s tree, `git -C` foreign worktrees, or rewrite shared repo git dir objects depending on permissions. Map already forbids treating this as isolation.

### 2.2 Per-process UID/GID + filesystem permissions

**Linux fact:** `kill(2)` allows signaling when real/effective UIDs match the target’s real/saved UIDs (or `CAP_KILL`). Same UID ⇒ full mutual signal/inspect via `/proc`. Different UIDs + correct directory modes (`0700`, owned by session UID) can stop naive cross-read/write **if** no shared writable paths and no privilege escalation.

**Sandbox `@next`:**

- `ExecOptions`: `{ cwd?, env?, timeout? }` only — **no `user`**.
- Supervisor: `Bun.spawn(command, { cwd, env: fullInheritance+overlay, detached: true })` — **no uid/gid**.
- PTY path: same inheritance model.
- Image Dockerfile: no multi-user session accounts; control plane + workloads share one runtime identity.

**Containers low-level:**

- `ctx.container.exec(cmd, { cwd, env, user })` documents `user` as image user name or numeric UID.
- That API is the Durable Object container runtime hook. Sandbox’s supervised processes are **not** documented to pass `user` through.

**CF constraint:** FAQ recommends `docker:dind-rootless` “since **Containers run without root privileges**.” Sandbox port validator comment: privileged ports need root “which containers don’t have.” Even if the image process appears as UID 0 *inside* a userns, **host-level root and many capabilities are absent**. Creating durable multi-UID jails requires:

1. Multiple passwd users (or numeric UIDs) usable under the runtime identity model.  
2. Ability to start session processes as those UIDs (Sandbox doesn’t; custom launcher or raw `container.exec` might).  
3. Control plane remaining more privileged than session UIDs **without** session code being able to reach the control plane (port 3000 is reserved in API validation, not a full LSM).  
4. Deployed proof that `setuid`/`setgid`/file caps/`runuser` work as assumed.

**Verdict:** UID split is the **only classical Linux FS+signal isolation** that fits “one container, many sessions,” but it is **not a supported Sandbox mechanism** today and is **unproven** under CF rootless constraints. Local Docker rootful runs will **overstate** success.

### 2.3 chroot / pivot_root

| Mechanism | Needs | Isolation quality |
| --- | --- | --- |
| `chroot(2)` | Privilege to chroot; still same PID/net/IPC; easy escape if nested mounts/`..`/`/proc` mishandled | Weak alone |
| `pivot_root(2)` | Mount namespace + careful teardown | Better with full ns stack |

No Sandbox API. Control plane would have to wrap every `exec`/PTY. Capabilities may be insufficient on deployed Containers. **Unsupported / unproven.**

### 2.4 Mount / user / PID / network / IPC namespaces + bubblewrap

bubblewrap constructs a sandbox via **user namespaces** (setuid mode removed) plus mount/PID/IPC/net options and optional seccomp. It is a **constructor**, not a policy: security equals the flags the parent passes.

Nested userns inside an already-userns/rootless CF VM is the hard unknown:

- May be disabled (`user.max_user_namespaces`, seccomp on `clone`, AppArmor/LSM).  
- `--unshare-net` would break legitimate package downloads and preview networking unless carefully bridged.  
- `--unshare-pid` hides foreign PIDs **inside the bwrap child**, but the parent control plane and any process *not* entered via bwrap still share the outer ns.  
- FUSE (`s3fs`, fuse-overlayfs already in sandbox image) and nested mounts may conflict with bwrap mount trees.  
- Coding tools that need ptrace, overlay mounts, or docker.sock will fight tight seccomp/ns sets.

**Verdict:** best **engineering candidate** for a custom jail wrapper **if** deployed CF allows unprivileged user namespaces and the wrapper is mandatory for all agent/terminal lanes. Not provided by Sandbox SDK. Local Docker often enables userns features production may not. **Must prototype on deployed Containers.**

### 2.5 seccomp and capabilities

Kernel seccomp-BPF can limit syscalls; capabilities(7) split root powers. No Sandbox API to install per-session filters. A custom parent could `seccomp` children after spawn, but:

- Over-filtering breaks `npm`, `git`, compilers, test runners, debuggers.  
- Under-filtering fails open.  
- Hostile code that isn’t entered through the wrapper is unrestricted.

**Verdict:** possible defense-in-depth **inside** a custom launcher; not a standalone product boundary; high false-negative risk for “useful coding commands.”

### 2.6 Process visibility and signaling

Evidence:

- `listProcesses()` is sandbox-global for the current container.  
- Supervisor uses `ps -eo` and `process.kill` on process groups/PIDs.  
- Same UID ⇒ `kill(2)` permission granted between sessions.  
- `/proc` exposes cmdline, environ, fds of peers (environ often contains any secrets mistakenly injected into another lane).

**Verdict:** without PID ns **and** UID (or equivalent) separation, process isolation is **impossible**. SDK APIs actively expose cross-session process metadata to any caller of `listProcesses`.

### 2.7 Sockets and ports

| Surface | Behavior |
| --- | --- |
| Network namespace | One per container |
| Localhost TCP/UDP | Shared; session A can connect to session B’s dev server |
| `exposePort` / tunnels | Sandbox-scoped preview URLs; token auth is for **external** preview access, not cross-session localhost |
| Reserved port 3000 | Control plane; SDK rejects expose of 3000 |
| Preview pool (Ditto `10000–10031`) | Allocation policy only; not a kernel firewall between sessions |

**Verdict:** no per-session network isolation API. Optional custom `bwrap --unshare-net` would isolate too hard for normal package/registry use unless egress is re-injected (complex, unproven).

### 2.8 Shared `node_modules` and other shared mutable state

Ditto `session-worktree.ts` symlinks each worktree’s `node_modules` to `/workspace/node_modules` when safe. That is a **performance/coop** choice:

- Cross-session dependency poisoning / `postinstall` attacks  
- Writable shared store defeats FS isolation even with different worktree roots  
- Hard isolation requires **per-session** module stores **or** read-only shared stores plus per-session overlays

Same class of problem: shared git objects directory, shared caches (`~/.npm`, `/tmp`), shared Bun/Node global prefixes.

### 2.9 Files API vs exec path

Sandbox file APIs validate path **format** (null bytes, length), not session prefix. Any Worker/Brain caller with sandbox RPC can read any path. Session isolation therefore also requires **trusted coordinator path policy** outside the container, not only in-container jails.

---

## 3. Egress and secretless lanes (enforced at container edge)

This part **is** real platform enforcement — but **per container / sandbox instance**, not per Workspace Session.

### 3.1 Policy knobs

From Sandbox + Containers outbound docs:

| Knob | Effect |
| --- | --- |
| `enableInternet = false` | Deny public internet except allowlisted hosts/handlers; non-80/443 denied; DNS only to Cloudflare DNS |
| `allowedHosts` | Deny-by-default allowlist (globs) |
| `deniedHosts` | Unconditional deny (checked first) |
| `outbound` / `outboundByHost` / `outboundHandlers` + `setOutboundByHost` | Workers-side proxy; can inject auth **without** putting secrets in the container |
| `interceptHttps` (Sandbox default true) | MITM HTTPS via ephemeral CA at `/etc/cloudflare/certs/cloudflare-containers-ca.crt` |
| Evaluation order | denied → allowed → instance host handlers → class host handlers → catch-all → default allow/deny |

Outbound handlers run **outside** the sandbox (Workers), with bindings and secrets. Docs explicitly pitch this for untrusted agentic workloads.

**Limits:**

- Only HTTP(S) on 80/443 is interceptable.  
- With `enableInternet = true`, non-intercepted channels may still exfiltrate. Prefer **deny-by-default**.  
- Policy is **not session-scoped**; all sessions in the Project Sandbox share one egress identity (`ctx.containerId` is container instance, not workspace session).  
- Dynamic `setOutboundByHost` during one session’s setup affects the whole sandbox.

### 3.2 Mounts and credential proxy

`mountBucket` can use R2 binding mounts and `credentialProxy: true` so S3 credentials never land on disk. Still container-global mount namespace visibility unless path permissions/UID jail apply.

### 3.3 Secretless execution (product rule)

Map rule: no long-lived project/provider/GitHub credentials in Project Sandbox processes, files, argv, backups, or env.

**Enforced only if Ditto never injects them.** Platform helps via outbound handlers. Current stable agent path still has short-lived runtime credential material patterns in Worker→sandbox env (repo evidence in `agent-run.ts`); Brain migration must keep provider secrets on the Brain/Worker side and treat sandbox as secretless. That is orthogonal to session-vs-session jail but required by issue `04`.

---

## 4. Local Docker vs deployed Cloudflare Containers

| Dimension | Local `wrangler dev` + Docker | Deployed Cloudflare Containers |
| --- | --- | --- |
| Orchestration | Local engine (Docker Desktop/Colima); full host kernel features often available | CF VM per instance; rootless-oriented; no iptables manipulation |
| Outbound intercept | Sidecar + TPROXY in container netns; docs claim parity | Production intercept path |
| Ports | Must `EXPOSE` in Dockerfile for local connect | Worker can reach container ports without Dockerfile EXPOSE |
| Privileges | Easy to accidentally test with privileged/rootful Docker | FAQ: no root privileges; DinD must be rootless; no iptables |
| User namespaces / bwrap | Often works | **Unknown until measured** |
| UID/`user` exec | May work like ordinary Linux | Must re-test; Sandbox SDK still won’t pass `user` |
| Disk | Local volumes possible | Ephemeral disk; sleep ⇒ fresh image FS; FUSE/R2 for persistence |
| Isolation proof value | **Insufficient** for go/no-go | **Authoritative** |

**Rule:** any green local jail test is only a candidate. Issue `04` must repeat the matrix on a **deployed** Worker+Container.

---

## 5. What remains useful if we stay one-sandbox-per-project

Even without hard session jails, the Project Sandbox remains the right place for:

- One checked-out project + session worktrees (UX / git topology)  
- Shared read-only toolchains in the image  
- Preview URLs and tunnels  
- Container-level egress lockup and secretless outbound  
- Backups/mounts of workspace state  

Concurrency without hard isolation is a **trust model** choice: all Workspace Sessions of a project are mutually trusting (same user/tenant abuse domain). That may be acceptable for single-owner projects and unacceptable for multi-user projects sharing one sandbox.

Map currently demands enforced boundaries for concurrent sessions — so either prove a jail or change the concurrency/terminal requirements via fallback.

---

## 6. Deployed prototype matrix (for issue `04`)

Run on **deployed** `@cloudflare/sandbox@next` + matching image. Record pass/fail, stderr, `/proc/self/status` CapEff, `ls -l /proc/self/ns`, and whether feature needed privileged Docker locally.

### 6.0 Baseline inventory (always)

| ID | Check | Expect |
| --- | --- | --- |
| B1 | `id`; `cat /proc/self/status` (Uid/Gid/Cap*) | Document runtime identity |
| B2 | `ls -l /proc/self/ns` | Document ns inodes |
| B3 | `sysctl user.max_user_namespaces` / `unshare --user --map-root-user echo ok` | Nested userns availability |
| B4 | `which bwrap`; if missing, install in **custom** image only for test | Tool presence |
| B5 | Two `exec`s: write secret files under two worktree paths; cross-`cat` | **Baseline fail open** without jail |

### 6.1 Candidate A — UID + directory modes (custom launcher or raw container.exec)

| ID | Attack / check | Pass criteria |
| --- | --- | --- |
| U1 | Create users `sess-a`/`sess-b` (or numeric UIDs); `chown 0700` trees | Setup succeeds without root host |
| U2 | Start processes as each UID (`user` on `container.exec` or `setpriv`/`runuser`) | `id` matches |
| U3 | A reads B’s `0700` file | **EACCES** |
| U4 | A `kill -0` B’s pid | **EPERM** |
| U5 | A reads B via `/proc/B/environ` or `cmdline` | Denied or empty |
| U6 | A binds port; B connects `127.0.0.1:port` | Document (likely **still open** — net ns shared) |
| U7 | Useful commands as non-root: `node`, `npm`, `git status`, `pnpm test` in worktree | Exit 0 |
| U8 | Sandbox `createTerminal` as session UID | If impossible via SDK, mark **terminal gap** |
| U9 | Control plane on :3000 still healthy; session cannot break RPC | Still responsive |
| U10 | After container sleep/replace, re-provision UIDs/trees | Document operational cost |

### 6.2 Candidate B — bubblewrap wrapper (mandatory for agent/terminal lanes)

| ID | Check | Pass criteria |
| --- | --- | --- |
| W1 | `bwrap --unshare-user --unshare-pid --ro-bind … --bind $TREE $TREE … --chdir … -- cmd` | Starts |
| W2 | Cross-tree read without bind | Fail |
| W3 | `ps` / kill outer peer PIDs | Fail |
| W4 | Outbound HTTPS with `enableInternet=false` + allowlist + intercept CA | Still works **inside** bwrap |
| W5 | npm install + node test + git | Useful subset works |
| W6 | Escape attempts: `/proc/1/root`, TIOCSTI, nested mounts | No escape (include `--new-session`) |
| W7 | Hostile `bwrap` bypass: raw `exec` without wrapper via Sandbox API | **Must be impossible** — if Sandbox `exec` remains open, wrapper is cooperative only |

**Critical:** if Brain/Worker can still call `sandbox.exec(['/bin/bash',…])` without the wrapper, the jail is not enforced. Enforcement requires either SDK support, replaced control plane, or **no arbitrary exec** from untrusted lanes (fallback model).

### 6.3 Candidate C — Containers `user` only via DO, no Sandbox supervisor

Measure whether ditching Sandbox process APIs for raw `ctx.container.exec` is viable (lose terminals/logs/supervisor semantics). Likely poor fit; document only if A/B fail.

### 6.4 Egress / secret matrix (independent of jail)

| ID | Check | Pass criteria |
| --- | --- | --- |
| E1 | `enableInternet=false`; `curl https://example.com` | Fail |
| E2 | allowlisted host via handler | Success without secret in container env/`ps` |
| E3 | Direct connect non-80/443 to external IP | Fail |
| E4 | DNS to non-CF resolver / raw DNS tunnel attempt | Fail or CF DNS only |
| E5 | `printenv` / `/proc/self/environ` contains no provider/GitHub tokens | Empty of secrets |
| E6 | Session A cannot change egress policy (policy only on DO/Worker) | No in-container API |

### 6.5 Shared dependency matrix

| ID | Check | Pass criteria |
| --- | --- | --- |
| D1 | Shared writable `node_modules` | Show poison: A writes module B imports |
| D2 | Per-session `node_modules` or ro+overlay | Poison fails |
| D3 | Disk/time cost of per-session installs on `lite`/`basic` instance sizes | Fit within limits |

### 6.6 Go / no-go gates for hard isolation

**Go (custom jail)** only if on **deployed** CF:

1. U3–U5 pass **or** W2–W3 pass.  
2. U7/W5 pass for the **declared** coding command set.  
3. W7 pass (no unwrapped arbitrary exec) **or** product accepts Brain-only wrapped exec.  
4. E1–E5 pass.  
5. Terminal story explicit: real PTY under jail **or** terminals deferred.  
6. Operational story for UID/wrapper provisioning across container replace.

**No-go for hard isolation** if any of: nested userns unavailable; cannot drop privilege below control plane; cannot close unwrapped `exec`; useful tool set broken; localhost cross-connect still considered blocker and net ns cannot be split safely.

On no-go → **fallback** below; map’s concurrent-session security claim becomes “same trust domain” or “no free-form multi-session shell.”

---

## 7. Fallback: restricted path-validating tools + approved commands

Use when hard isolation is unavailable or unfinished. This **is** enforceable if the Brain is the only mutator of the Project Sandbox (map rule).

### 7.1 Trust boundary

```
Browser → Worker auth → Brain DO (trusted)
                        ├─ D1 / R2 / provider APIs (secrets stay here)
                        ├─ Git policy + trusted git executor (no creds in sandbox)
                        └─ Project Sandbox RPC (untrusted)
                             only: allowlisted argv templates OR file tools with realpath jail
```

Hostile code in the sandbox is still hostile to **that project’s** files, but:

- cannot receive provider/GitHub secrets (egress handlers + no env secrets);  
- cannot be driven as a general shell by the model unless allowlisted;  
- cross-session damage is limited by **Brain-side path binding**, not by kernel jail.

### 7.2 File tools (minimum)

| Rule | Detail |
| --- | --- |
| Session root | `realpath` under `sessionWorktreePath(sessionId)` only |
| Reject | symlink escape, `..`, absolute paths outside root, NUL, paths > limit |
| Ops | read, write, edit, list, mkdir, delete, rename — all after canonicalize |
| Binary/size caps | hard max bytes; no unbounded `readFile` |
| No raw FS RPC to model | model never gets free `sandbox.readFile('/etc/…')` |

Implement in **Brain/Worker**, not in cooperative shell scripts.

### 7.3 Approved command surface (minimum)

Allow only argv templates, not shell strings:

| Template | Purpose |
| --- | --- |
| `git` subcommands allowlist (`status`, `diff`, `add`, `commit`, `switch`, …) with cwd=session root | VCS |
| `node` / `pnpm` / `npm` / `vitest` / `tsc` with fixed flags + cwd | JS toolchain |
| explicit test/build scripts from `package.json` names allowlist | project scripts |
| deny | `bash -lc`, `sh -c`, `curl`, `wget`, `ssh`, `python -c`, arbitrary binaries |

Timeouts + output byte caps + no stdin interactive assumption.

### 7.4 Terminal capability

| Mode | When |
| --- | --- |
| **No general terminal** | Default under fallback (matches map: don’t ship general terminal before isolation proof) |
| **Read-only log tail** | Attach to allowlisted process output only |
| **Full PTY** | Only after hard-isolation go **or** explicit product acceptance that sessions share a trust domain |

### 7.5 Loss function (honest)

Fallback **gives up**:

- free-form developer terminal in-sandbox  
- arbitrary agent `run_terminal_cmd`  
- multi-session hostile isolation theater  

Fallback **keeps**:

- useful structured coding loop (edit/test/build)  
- secretless sandbox + strong egress  
- one Project Sandbox economics  
- clear security story for review  

### 7.6 Hybrid (optional later)

Brain uses allowlisted tools by default; a “break glass” jail PTY exists only if Candidate A/B go green. Do not ship hybrid until W7 is solved.

---

## 8. Recommendations tied to wayfinder

| Decision | Recommendation |
| --- | --- |
| Concurrent sessions in one Project Sandbox | **Do not claim kernel isolation** until §6 go gates pass on deployed CF. |
| Issue `04` prototype | Run §6 matrix on `@next` deployed; prefer Candidate B only if unwrapped exec can be closed; else Candidate A; expect fallback. |
| Egress | `enableInternet = false` + explicit allowlists/handlers; secrets only in outbound handlers; never session-scoped policy fantasy. |
| Shared `node_modules` | Treat as **anti-isolation**; under any jail attempt use per-session trees or read-only shared + overlay. |
| Terminals | Gate on isolation proof; default off under fallback. |
| Architecture go/no-go (`06`, `13`) | Security gate = deployed cross-session deny tests **or** explicit acceptance of restricted tools + no general terminal. |
| Out of scope remains correct | One sandbox per session would buy real isolation immediately (platform VM boundary) but violates current map economics/scope. |

---

## 9. Concise answers to the ticket question

**Which supported mechanisms enforce concurrent per-Workspace-Session FS/process/socket/port isolation inside one Project Sandbox while retaining useful coding commands and terminals?**

- **Supported as security isolation today:** **none** inside one sandbox.  
- **Supported isolation:** whole-sandbox/container (VM) boundary; container egress policy; control-plane port reservation; optional secret injection outside the container.  
- **Supported concurrency primitives that are not security:** worktrees, `cwd`/`env`, stable sessions (shell state; removed in `@next`), preview port allocation, process handles.  
- **Possible but custom/unproven on CF:** UID separation, bubblewrap+namespaces, seccomp — all require mandatory wrapping and deployed proof; socket/port isolation remains weak without net ns tradeoffs.  
- **Local Docker success ≠ deployed guarantee.**  
- **Fallback if jail unavailable:** Brain-side realpath-jailed file tools + argv allowlist; no general terminal; secretless + egress deny-by-default.

---

## 10. Version pins for reproducibility

| Component | Observed |
| --- | --- |
| `@cloudflare/sandbox` `@next` tarball | `0.13.0-next.724.1` |
| `@cloudflare/containers` (dependency line) | `^0.3.7` (repo lock `0.3.7`) |
| Sandbox image Dockerfile in `@next` package | Ubuntu 22.04 runtime-base; FUSE/s3fs/fuse-overlayfs; no session-uid scaffolding; ENTRYPOINT tini + sandbox binary |
| Ditto current runtime image | `FROM docker.io/cloudflare/sandbox:0.12.3` (stable; migrate separately) |

Re-check `@next` changelog before implementation; process APIs are preview-stable in contract but still moving.
