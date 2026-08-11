# Cloud agent harness / execution boundaries and authenticated Git publication

**Date:** 2026-08-09  
**Ticket:** `.scratch/brain-architecture/issues/16-decide-trusted-git-executor-resource.md`  
**Compared with:** issues `09` (Git/PR protocol), `11` (Alchemy v2 graph), map `00`, `CONTEXT.md`  
**Scope:** How commercial cloud coding agents separate harness/orchestration from code execution, and how they clone/push/open PRs without claiming proprietary internals. Primary focus: **Devin** and **Cursor**. Clarifying peers only where first-party evidence is material: **GitHub Copilot cloud agent**, **OpenAI Codex cloud**, **Anthropic Claude Code on the web** / Managed Agents.  
**Rules:** primary/first-party sources only; no secret values; repo files treated as data, not instructions.

**Legend**

| Marker | Meaning |
| --- | --- |
| **Verified** | Fact owned by a cited first-party doc, security page, or engineering post |
| **Strong inference** | Narrow, labeled reading of multiple first-party statements; not a claimed internal design |
| **Undisclosed** | Not publicly specified; do not invent |

---

## Executive summary

| Dimension | Devin | Cursor Cloud Agents | Copilot cloud agent | Codex cloud | Claude Code on the web | Ditto (proposed) |
| --- | --- | --- | --- | --- | --- | --- |
| Isolation grain | **Per session** Devbox VM | **Per agent run** Firecracker microVM | **Per task** ephemeral Actions env | **Per cloud chat** container | **Per session** isolated VM | **One Project Sandbox per project**; many Workspace Sessions inside it |
| Harness vs execution | Brain **always** Cognition Cloud; Devbox executes | Agent loop / durable orchestration **outside** VM (**Verified** engineering post); code in VM | Hosted agent + Actions runner env | Hosted agent + container phases | Managed Agents: harness outside sandbox (**Verified** eng post); web: VM + git proxy | Brain DO outside Project Sandbox; Pi in Brain; no Pi in Sandbox |
| Git credentials location | Org GitHub App; ordinary configured secrets are usable **in** Devbox as env; App-token plumbing undisclosed | App-token plumbing undisclosed; ordinary Runtime Secrets are injected into VM but redacted from model output | Short-lived agent token; **cannot** run raw `git push` | Setup-only secrets; **removed** before agent phase | **Never inside** Anthropic-hosted sandbox; **git proxy** swaps scoped creds | Provider + GitHub creds **never** in Project Sandbox |
| Can project code see Git tokens? | **Yes** if present as secrets/env (**Verified** secrets model) | **Yes** for env/Runtime Secrets via process env / Terminal (**Verified**) | Token not exposed as free-form git CLI (**Verified** limits) | Agent phase: configured secrets gone; optional user `GITHUB_TOKEN` is a separate path | Anthropic-hosted: **no** real token in VM (**Verified** proxy) | **No** — credential-free bundle only |
| Clone / push / PR | Clone in Devbox; push/PR via GitHub App as contributor | Clone via App; push branch; draft PR; HSM-signed commits | Clone in Actions env; **simple push only** to `copilot/` or PR branch; draft PR | Clone; agent edits; user/UI opens PR | Clone into VM; push **only working branch** via proxy; PR from product | Local secretless commit + bundle → Trusted Git Executor push → Brain opens/returns PR |
| Egress | Not fully public for cloud Devbox; CLI sandbox optional; OIDC/secrets common | Default internet; team allowlist / lock | Default **firewall** + recommended allowlist | Setup online; agent **off** by default | Default **Trusted** allowlist; separate GitHub proxy | Agent lanes secretless; Preview egress-denied; executor narrowly authorized |
| Lifecycle | Session from snapshot; session dirty state does not write back | Idle hibernate → delete; snapshots ~90d inactivity | Ephemeral Actions job; token revoked after session | Container cache ≤12h | VM reclaimed on inactivity/expiry | Shared Sandbox durable via R2; executor ephemeral destroy-after-use |

**Bottom line for issue 16:** Public products do **not** document a Cloudflare resource choice. What *is* public is a small set of patterns. Ditto’s “Brain outside + hostile shared sandbox + ephemeral credentialed Git only” is **stricter than Devin/Cursor’s published default secret model** (ordinary configured secrets live *inside* the coding VM; their exact App-token plumbing is undisclosed) and **closest to Claude Code on the web’s git proxy** plus Anthropic’s published brain/hands split. Issue 16 should pick the **smallest disposable Cloudflare compute** that can run git-only validation/push with Brain-minted short-lived tokens, **never** project code, and fit Alchemy v2 without becoming a second Pi runner—not try to clone Devin/Cursor’s “full dev VM holds the token” model.

---

## Ditto target (comparison baseline)

**Verified** from map, CONTEXT, and settled issues 09/11 (repo architecture intent, not shipped):

- One **Brain** and one **Project Sandbox** per Project. Brain is sole mutating coordinator; Pi Runtime lives in the Brain.
- Project Sandbox is untrusted: repo, worktrees, previews; **no** agent, provider, or GitHub credentials.
- **Git Publication** (issue 09): Brain-owned inspect/commit/bundle/validate/push/PR protocol. Sandbox emits a **credential-free** bundle; **Trusted Git Executor** validates in a bare repo with no project checkout, then non-force pushes exact SHA to `ditto/session-*`; Brain does PR create/return via GitHub App API.
- Issue 11: Alchemy v2 graph deliberately **omits** placeholder Brain/Workflow/Trusted Git Executor resources; issue 16 owns executor resource + lifecycle.
- Issue 16 question: which Cloudflare resource runs the ephemeral Trusted Git Executor, and exact create/auth/bound/observe/retry/destroy lifecycle—without a second Pi runner.

---

## 1. Devin (Cognition)

### Harness / execution boundary

| Claim | Grade | Evidence |
| --- | --- | --- |
| Architecture is **Brain** (intelligence) + **Devbox** (execution) | **Verified** | [Enterprise deployment overview](https://docs.devin.ai/enterprise/deployment/overview) |
| Brain **always** resides in Cognition’s Cloud; stateless cloud service | **Verified** | Same |
| Devbox is the secure VM where code runs, resources connect, systems are touched | **Verified** | Same |
| Enterprise Cloud: Brain + Devbox both in Cognition multi-tenant cloud; **each session on its own isolated machine** | **Verified** | Same |
| Customer Dedicated: Brain still Cognition Cloud; Devbox in customer-isolated single-tenant VPC | **Verified** | Same |
| **Outposts:** agent loop (inference/planning) stays in Devin cloud; command execution, file edits, repository access on customer workers | **Verified** | [Outposts overview](https://docs.devin.ai/cloud/outposts/overview) |
| Whether model weights / tool-router process memory share a host with the Devbox kernel | **Undisclosed** | Not specified beyond Brain-vs-Devbox and Outposts split |

**Strong inference:** Devin’s public “Brain outside Devbox” matches Ditto’s vocabulary at the product level (orchestration/intelligence ≠ coding machine). Outposts make the split operational: cloud loop sends tool calls; worker executes locally.

### Isolation granularity

| Claim | Grade | Evidence |
| --- | --- | --- |
| Isolation unit is the **session machine** (Devbox), not a long-lived shared multi-session project box | **Verified** | “Each Devin session runs on its own isolated machine” — [deployment overview](https://docs.devin.ai/enterprise/deployment/overview) |
| Org environment is a **snapshot** image; every session boots a fresh copy; session changes do not persist into the snapshot | **Verified** | [Environment configuration](https://docs.devin.ai/onboard-devin/environment) |
| Parallel managed Devins = parallel isolated VMs | **Verified** | [Advanced capabilities](https://docs.devin.ai/work-with-devin/advanced-capabilities) |
| Same-machine multi-tenant session jail | **Undisclosed** / N/A | Docs describe per-session machines, not shared multi-session sandboxes |

### Credentials and Git publication

| Claim | Grade | Evidence |
| --- | --- | --- |
| GitHub via GitHub App (or PAT for GHES); Contents + Pull requests read/write among other perms | **Verified** | [GitHub integration](https://docs.devin.ai/integrations/gh) |
| Org-level install permissions; “not the permissions of the individual user running a session” | **Verified** | Same, Security Considerations |
| Devin creates PRs, responds to PR comments, pushes as a contributor; subject to branch protection | **Verified** | [GitHub](https://docs.devin.ai/integrations/gh), [SDLC integration](https://docs.devin.ai/essential-guidelines/sdlc-integration) |
| Secrets (API keys, tokens, passwords, cookies, TOTP) become **ENV variables** available to the application in the session | **Verified** | [Secrets](https://docs.devin.ai/product-guides/secrets) |
| Repo-scoped secrets via environment config / `.env` on the snapshot | **Verified** | Same |
| GPG signing key material stored as secrets and imported on session start for signed commits | **Verified** | [GitHub – Commit Signing](https://docs.devin.ai/integrations/gh) |
| Whether GitHub App installation tokens are injected into the Devbox git credential helper vs only used by a Cognition-side proxy | **Undisclosed** | Docs show App permissions and in-Devbox git/PR behavior; no public “git proxy keeps token out of VM” claim like Claude’s |
| Separate ephemeral trusted git executor that never runs project code | **Undisclosed** — no public product of that name | — |

**Strong inference:** Devin’s default trust model is **developer laptop equivalent**: the coding VM is expected to hold credentials needed for tools, registries, and git. That is the opposite of Ditto’s “credentials never enter Project Sandbox.”

### Egress / lifecycle

| Claim | Grade | Evidence |
| --- | --- | --- |
| Dedicated deployment uses PrivateLink/IPSec; cross-tenant WebSocket to Cognition | **Verified** | [Deployment overview](https://docs.devin.ai/enterprise/deployment/overview) |
| OIDC short-lived identity tokens per session for cloud roles | **Verified** | [OIDC](https://docs.devin.ai/product-guides/oidc) |
| Cloud Devbox default egress allowlist policy | **Undisclosed** at same depth as Cursor/Claude | Trust center exists ([trust.cognition.ai](https://trust.cognition.ai)) but detailed egress matrix is not in the public docs cited above |
| CLI OS sandbox (bubblewrap/Seatbelt) is a **local CLI** feature, not the cloud Devbox model | **Verified** | [CLI sandbox](https://docs.devin.ai/cli/sandbox) |
| Session ends → worker returns to queue (Outposts); snapshot not dirtied by session | **Verified** | Outposts + environment docs |

---

## 2. Cursor Cloud Agents

### Harness / execution boundary

| Claim | Grade | Evidence |
| --- | --- | --- |
| Cloud Agent = coding agent in a **VM in Cursor’s cloud** with full dev environment | **Verified** | [Cloud Agents](https://cursor.com/docs/cloud-agent), [Security overview](https://cursor.com/docs/cloud-agent/security) |
| Run stages: start → provision isolated VM + clone → run tools in VM → persist conversation → hand off branch/PR → recycle | **Verified** | [Security overview](https://cursor.com/docs/cloud-agent/security) |
| **Per-agent** VMs; Firecracker-based microVMs; separate AWS account from other Cursor prod | **Verified** | Same |
| Durable agent loop kept **off** the VM (Temporal); machine state and conversation state decoupled | **Verified** | [What we’ve learned building cloud agents](https://cursor.com/blog/cloud-agent-lessons) |
| Whether inference GPUs share tenancy details with the microVM host | **Undisclosed** | — |

**Strong inference:** Cursor’s published lesson (“agent loop lives in Temporal rather than on the VM”) is the same structural move Anthropic describes for Managed Agents and that Ditto wants for Brain-vs-Sandbox: **orchestration is not the coding filesystem**.

### Isolation granularity

| Claim | Grade | Evidence |
| --- | --- | --- |
| One agent ↔ one dedicated VM boundary | **Verified** | [Security overview](https://cursor.com/docs/cloud-agent/security) |
| Access never wider than triggering user’s Git access (App install + per-user connect) | **Verified** | Same |
| Saved **environments** (setup, secrets, network) reused across runs; not one shared multi-user disk | **Verified** | [Secrets & Network](https://cursor.com/docs/cloud-agent/security-network), setup docs |

### Credentials and Git publication

| Claim | Grade | Evidence |
| --- | --- | --- |
| Code via Cursor GitHub/GitLab App, not a single person’s long-lived PAT as the sole path | **Verified** | [Security overview](https://cursor.com/docs/cloud-agent/security) |
| Grant read-write to App to clone and make changes | **Verified** | [Secrets & Network – What you should know](https://cursor.com/docs/cloud-agent/security-network) |
| Agent pushes branch and opens **draft PR**; human merges | **Verified** | [Security overview](https://cursor.com/docs/cloud-agent/security) |
| Commits signed with HSM-backed Ed25519; Verified badge | **Verified** | [Signed commits](https://cursor.com/docs/cloud-agent/security-network#signed-commits) |
| Secrets encrypted; types: Environment Variable (visible to agent), **Runtime Secret** (env but redacted from tool results/transcript/commits), Build Secret (Docker build only) | **Verified** | [Secrets & Network](https://cursor.com/docs/cloud-agent/security-network) |
| Runtime Secrets still visible to humans via agent **Terminal** | **Verified** | Same |
| OIDC JWT mintable from VM local socket for cloud roles | **Verified** | [OIDC](https://cursor.com/docs/cloud-agent/identity) (linked from security docs) |
| Exact mechanism of git auth inside VM (credential helper vs embedded header vs proxy) | **Undisclosed** | Docs say App clones/pushes and publish git egress proxy IPs; not a Claude-style “token never in VM” claim |
| Whether prompt-injected project code can read Runtime Secret env vars | **Strong inference: yes** | Official: still loaded as environment variables; Terminal can see them |

### Egress / lifecycle

| Claim | Grade | Evidence |
| --- | --- | --- |
| Internet **on by default**; modes Allow all / Default+allowlist / Allowlist only; Enterprise lock | **Verified** | [Network access](https://cursor.com/docs/cloud-agent/security-network#network-access) |
| Auto-runs terminal commands (more autonomous than local foreground agent) | **Verified** | Security overview + Secrets & Network |
| VM recycled after idle; snapshots max **90 days** inactivity; conversation retention configurable | **Verified** | [Security overview](https://cursor.com/docs/cloud-agent/security), [Data retention](https://cursor.com/docs/cloud-agent/security-network#data-retention) |
| Git egress proxy for IP allow lists | **Verified** | [Secrets & Network](https://cursor.com/docs/cloud-agent/security-network#git-egress-proxy-and-ip-allow-list) |

---

## 3. Clarifying peers (first-party only where material)

### GitHub Copilot cloud agent

Material because it is the clearest **public** statement that authenticated git mutation can be a **narrow platform capability**, not a shell with a token.

| Claim | Grade | Evidence |
| --- | --- | --- |
| Work in **ephemeral** GitHub Actions-powered environment | **Verified** | [Customize environment](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-environment) |
| Push limited to **one branch** (`copilot/…` or existing PR branch) | **Verified** | [Risks and mitigations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations) |
| “Can only perform **simple push** operations. It **cannot directly run `git push`** or other Git commands.” | **Verified** | Same |
| Draft PRs; cannot mark ready, approve, or merge; Actions workflows gated | **Verified** | Same |
| Internet restricted by **firewall**; token revoked after session; minimize sensitive inputs | **Verified** | Risks doc + [agentic security principles](https://github.blog/ai-and-ml/github-copilot/how-githubs-agentic-security-principles-make-our-ai-agents-as-secure-as-possible/) |
| Setup steps run as Actions job before agent; separate from agent token permissions guidance | **Verified** | Environment docs (“Copilot will be given its own token”) |
| How push is implemented internally (Git Data API vs mediated git) | **Undisclosed** | Only the capability limit is public |

**Why it matters for Ditto:** Copilot’s public posture is “**credentialed mutation is not a general shell**.” Ditto issue 09 goes further (hostile bundle validation, expected-remote fencing) but shares the instinct: do not hand the coding environment a normal git remote with write credentials.

### OpenAI Codex cloud

Material for **phased secret availability** and default-deny agent egress.

| Claim | Grade | Evidence |
| --- | --- | --- |
| Per prompt: create container → checkout → setup script → apply internet policy → agent loop → diff / open PR | **Verified** | [Cloud environments](https://developers.openai.com/codex/cloud/environments) |
| **Secrets only in setup**; removed before agent phase | **Verified** | Same |
| Agent internet **off by default**; optional allowlist / methods | **Verified** | [Agent internet access](https://developers.openai.com/codex/cloud/internet-access) |
| Container cache up to 12 hours; shared cache for Business/Enterprise env users | **Verified** | Environments doc |
| Whether GitHub App tokens for “Create PR” UI ever enter agent phase | **Undisclosed** in first-party pages cited; community posts are **out of scope** for verified claims |

**Why it matters:** Codex’s setup-vs-agent split is a weaker cousin of Ditto’s sandbox-vs-executor split: high-privilege install network/secrets first, then strip before the model-driven phase. Codex still runs the agent **in** the same container filesystem after strip; Ditto keeps the durable project filesystem permanently secretless.

### Anthropic Claude Code on the web (+ Managed Agents eng)

Material because it is the closest **published** match to Ditto’s credential boundary.

| Claim | Grade | Evidence |
| --- | --- | --- |
| Each web task/session in isolated Anthropic-managed VM (or customer self-hosted env) | **Verified** | [Claude Code on the web product](https://www.anthropic.com/news/claude-code-on-the-web), [docs](https://docs.claude.com/en/docs/claude-code/claude-code-on-the-web) |
| “Git interactions handled through a **secure proxy**” so Claude only reaches authorized repos | **Verified** | Product post |
| Anthropic-hosted: “sensitive credentials such as **git credentials or signing keys are never inside the sandbox**”; auth via **secure proxy** with scoped credentials | **Verified** | [Security and isolation](https://docs.claude.com/en/docs/claude-code/claude-code-on-the-web#security-and-isolation) |
| Dedicated **GitHub proxy**: VM sees scoped credential; proxy swaps real token; **`git push` only to session’s current working branch**; API scoped to attached repos | **Verified** | [Cloud environments – GitHub proxy](https://docs.claude.com/en/docs/claude-code/cloud-environments#github-proxy) |
| `GH_TOKEN`/`GITHUB_TOKEN` may show placeholder `proxy-injected`; real token not in container when proxy handles auth | **Verified** | Same doc, GitHub tools section |
| Network levels None/Trusted/Full/Custom; GitHub proxy **independent** of general egress level | **Verified** | [Network access](https://docs.claude.com/en/docs/claude-code/cloud-environments#network-access) |
| Managed Agents: decouple **harness** (brain), **session log**, and **sandbox** (hands); tokens must not be reachable from sandbox where generated code runs; git clone wires remote so push/pull work **without agent handling token** | **Verified** | [Scaling Managed Agents](https://www.anthropic.com/engineering/managed-agents) |
| Exact proxy host implementation / CF mapping | **Undisclosed** | — |

**Why it matters:** Claude’s public design is **credentials outside the coding VM + branch-limited push**. Ditto differs by (1) **shared** project sandbox across sessions, (2) **hostile bundle** validation before any write token, (3) Brain-owned PR API rather than in-sandbox `gh`, (4) no general terminal in the shared sandbox. The *credential topology* is aligned; the *isolation grain* and *artifact boundary* are Ditto-specific.

---

## 4. Cross-cutting pattern table

| Pattern | Who publishes it | Relation to Ditto |
| --- | --- | --- |
| **A. Brain/harness outside coding VM** | Devin, Cursor (Temporal), Anthropic Managed Agents, Claude Cowork host-mode | **Aligned** with Brain outside Project Sandbox |
| **B. Per-task/session disposable full dev VM** | Devin, Cursor, Claude web, Codex, Copilot Actions | Ditto **rejects** one sandbox per Workspace Session (map out of scope); keeps **one** Project Sandbox |
| **C. Credentials inside coding env** (env secrets, git as normal developer) | Devin (clear), Cursor (clear, with redaction tiers) | Ditto **rejects** for Project Sandbox |
| **D. Credentials outside coding env; mediated git** | Claude web git proxy; Managed Agents git wiring | **Closest** commercial analog to Trusted Git Executor |
| **E. No raw git; platform push only** | Copilot cloud agent | Different mechanism, same spirit of minimizing git capability |
| **F. Phase secrets: setup yes / agent no** | Codex cloud | Partial analog; still same container |
| **G. Branch-limited non-default push + human merge** | All of the above in some form | **Aligned** with session branch + no merge |
| **H. Ephemeral trusted validator that never runs project code** | **Not named as a product surface** in Devin/Cursor public docs | Ditto **explicit** design (issues 05/09/16) |

---

## 5. What is publicly known vs not

### Known with first-party citations

1. Multiple vendors **split intelligence/orchestration from the coding machine** (Devin Brain/Devbox; Cursor Temporal-vs-VM; Anthropic harness-vs-sandbox).
2. Default commercial cloud agents give the coding environment a **real checkout** and usually a path to **authenticated git from that environment** (Devin, Cursor) or a **mediated** path that still looks like git to the agent (Claude proxy).
3. **Egress lockdown** and **secret redaction** are the common mitigations when tokens sit near the model (Cursor Runtime Secrets, Copilot firewall, Codex agent offline default, Claude Trusted network).
4. **PR + protected default branch + human merge** is universal product policy language.
5. **Lifecycle** is disposable compute: hibernate/delete (Cursor), Actions job (Copilot), cache then expire (Codex), VM reclaim (Claude), session-from-snapshot (Devin).

### Not publicly known (do not pretend)

- Exact process layout of model serving vs tool runner vs git credential minting for Devin or Cursor.
- Whether any vendor runs a Ditto-like **offline bundle quarantine + `git fsck` + expected-remote CAS** before push.
- Cloudflare resource graphs (Worker vs Workflow vs Container vs DO) for any of these products.
- Token formats, TTLs, or storage internals.
- Whether Cursor/Devin git traffic is a side proxy that strips tokens from the filesystem or classic `GIT_ASKPASS`/header injection into the VM.

---

## 6. Implications for issue 16 (Trusted Git Executor resource)

Issue 16 asks: **which Cloudflare resource** runs the ephemeral Trusted Git Executor, and what lifecycle creates, authenticates, bounds, observes, retries, and destroys it—while keeping credentials out of the Project Sandbox, treating bundles as hostile, preserving issue 09 fencing, and fitting Alchemy v2 **without a second Pi runner**.

### What peer research supports

1. **Do not put the executor in the Project Sandbox.** Every vendor that talks carefully about prompt injection treats “token next to untrusted code/tools” as the failure mode (Claude Managed Agents eng post; Copilot exfil concern; Cursor prompt-injection + egress notes). Ditto’s map already forbids this; peers reinforce it.
2. **Do not make the executor a Pi/harness host.** Cursor and Anthropic both moved **orchestration off** the coding VM for reliability and security. Issue 16’s “not a second Pi runner” matches that lesson: executor is **git cattle**, not an agent pet.
3. **Closest public analog is Claude’s git proxy + branch push cap**, not Devin’s secretful Devbox. If Ditto copied Devin/Cursor defaults, issue 16 would collapse into “inject installation token into Sandbox”—which issue 09 already rejected.
4. **Ephemerality is normal.** Peers destroy or recycle execution environments per session/run. Ditto’s executor should be **create → one fenced job → destroy tokens and storage**, matching issue 09 cleanup language.
5. **PR API stays on the Brain/control plane.** Copilot and Claude keep higher-level GitHub policy on the platform side; Devin/Cursor agents often drive `gh`/PR from the VM. Issue 09 already assigned PR create/return to Brain—keep executor **push/fetch only**.

### What peer research does **not** decide

- Worker `step` vs Workflow step vs Container vs isolated DO vs hyperdrive-adjacent git: **no vendor discloses a CF mapping**.
- Whether push uses native `git push` in a bare repo (Ditto issue 09) vs Git Data API (Copilot’s “simple push” might; **Undisclosed**). Issue 09 already preferred real git for exact history.

### Decision pressure for issue 16 (research → grilling, not a resolution)

| Option class | Peer echo | Fit to Ditto constraints |
| --- | --- | --- |
| Short-lived **Container** / sandbox image that only has git + policy scanner, no project mount | Cursor/Devin/Claude “machine for work” but **empty of app code** | Strong fit if image is fixed and non-interactive; must not bind Project Sandbox filesystem |
| **Workflow step** calling git in a constrained runner | Copilot Actions-shaped ephemeral job | Good lifecycle/retry story; ensure no second agent loop |
| Brain/Worker inline git via isomorphic-git / REST only | None of the “exact multi-commit history” peers rely on this as primary | Already weak for issue 05/09 exact-history goal |
| GitHub App token injected into Project Sandbox (current Ditto today per prior research) | Devin/Cursor-like | **Fails** map and issue 09 |

**Recommended research takeaway (not issue 16 resolution):** implement the executor as **disposable git-only compute owned by the Brain/Workflow control plane**, with Brain-minted **stage-scoped** tokens (read then write), **no** project checkout, artifact in from R2, destroy on every terminal path—i.e. operationalize Claude-like credential topology on Cloudflare cattle, not Devin-like secretful devboxes.

Concrete lifecycle checklist implied by peers + issue 09 (for the decision doc to fill in resource IDs):

1. **Create** empty trusted environment after Brain accepts Git Publication stage `pushing` (or `validating`).
2. **Admit** only bundle bytes + manifest hash + job params (branch, expected remote SHA, tip SHA).
3. **Auth read:** mint repo-scoped read token → fetch prerequisites → destroy read token.
4. **Validate** offline (hash, fsck, ancestry, limits, secret scan)—still no write token.
5. **Auth write:** mint push-only token → non-force `<sha>:refs/heads/ditto/session-*` → verify remote SHA → destroy write token.
6. **Observe** bounded exit codes/stderr redacted into Git Publication record; never log credentials.
7. **Retry** only under issue 09 fencing (same operation if no mutation; new publication otherwise).
8. **Destroy** environment storage and any residual credentials unconditionally.

Alchemy v2 (issue 11): add the real binding only when this contract is fixed—no placeholder resource now.

---

## Sources

### Devin / Cognition

- https://docs.devin.ai/enterprise/deployment/overview  
- https://docs.devin.ai/product-guides/secrets  
- https://docs.devin.ai/integrations/gh  
- https://docs.devin.ai/cloud/outposts/overview  
- https://docs.devin.ai/onboard-devin/environment  
- https://docs.devin.ai/product-guides/oidc  
- https://docs.devin.ai/work-with-devin/advanced-capabilities  
- https://docs.devin.ai/cli/sandbox  
- https://trust.cognition.ai  

### Cursor

- https://cursor.com/docs/cloud-agent  
- https://cursor.com/docs/cloud-agent/security  
- https://cursor.com/docs/cloud-agent/security-network  
- https://cursor.com/blog/cloud-agent-lessons  

### GitHub Copilot

- https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations  
- https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-environment  
- https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-firewall  
- https://github.blog/ai-and-ml/github-copilot/how-githubs-agentic-security-principles-make-our-ai-agents-as-secure-as-possible/  

### OpenAI Codex

- https://developers.openai.com/codex/cloud/environments  
- https://developers.openai.com/codex/cloud/internet-access  

### Anthropic

- https://www.anthropic.com/news/claude-code-on-the-web  
- https://docs.claude.com/en/docs/claude-code/claude-code-on-the-web  
- https://docs.claude.com/en/docs/claude-code/cloud-environments  
- https://www.anthropic.com/engineering/managed-agents  
- https://www.anthropic.com/engineering/how-we-contain-claude  

### Ditto (local)

- `CONTEXT.md`  
- `.scratch/brain-architecture/issues/00-map.md`  
- `.scratch/brain-architecture/issues/09-decide-git-and-pr-protocol.md`  
- `.scratch/brain-architecture/issues/11-decide-alchemy-v2-graph.md`  
- `.scratch/brain-architecture/issues/16-decide-trusted-git-executor-resource.md`  
- `docs/research/zero-trust-git-export.md`  

---

## Document control

- No proprietary internals claimed beyond cited public pages.  
- No secret values reproduced.  
- Does **not** resolve issue 16; supplies comparative constraints for the grilling decision.
