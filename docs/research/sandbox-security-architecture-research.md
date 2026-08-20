# Sandbox security architecture research

Research only. This document does not propose a migration plan, a sequence of
work, or a recommendation. It records what is true, what the platform actually
guarantees, and where the proposal holds or fails. A verdict on feasibility is
in scope; a call to act is not.

Every claim is labelled:

| Label | Meaning |
|---|---|
| **VERIFIED** | Stated by a primary source (vendor docs, shipped package source, Linux man-pages, the Ditto repo) and cited |
| **INFERRED** | Reasoned from verified facts; the reasoning is shown |
| **UNVERIFIED** | Could not confirm from a primary source; treat as an open question |

Companion document: `brain-architecture-research.md` (`brain@57a29d5`, verified
2026-08-14). Facts established there are reused by citation rather than
re-derived. Where this document's analysis load-bears on one of them, it was
re-verified on 2026-08-15 and is marked as such.

---

## 1. Scope and method

### Question asked

Evaluate a proposed three-layer sandbox security architecture, modelled on
Perplexity's SPACE platform, against what Cloudflare's platform actually
provides. The proposal, as stated:

> Control plane is stateless, manages the API, tracks sandbox state, issues
> short-lived tokens and access. Node-level services start/pause/resume/stop
> sandboxes, save snapshots for fast create and restore, control credentials and
> network access. Final layer is the sandbox: harness inside the sandbox, with an
> isolated VM created within the container for agent sessions; user has access to
> the isolated VM and not the container; the container holding the harness is
> trusted and performs git actions.

Mapped by the author onto Cloudflare as: Layer 1 = Worker + tRPC, Layer 2 =
Workflows, Layer 3 = a raw Cloudflare Container (dropping `@cloudflare/sandbox`)
holding a trusted harness plus an inner per-session VM.

### Sources

Primary only, fetched **2026-08-15** unless stated:

- `research.perplexity.ai` — the SPACE engineering article. First-party for what
  Perplexity built. **Not** treated as authority for anything Cloudflare or
  Firecracker can do.
- `developers.cloudflare.com` — Containers (all pages in `containers/llms.txt`),
  Sandbox SDK, Workflows, Durable Objects, Wrangler configuration.
- `gvisor.dev`, `firecracker-microvm` repo docs, `kata-containers` repo docs,
  `qemu.org`, `criu.org`, `man7.org`, `docs.wasmtime.dev`,
  `containers/bubblewrap` and `google/nsjail` READMEs.
- Shipped npm package source read from disk: `@cloudflare/containers@0.3.7`,
  `@cloudflare/sandbox@0.12.3`, `@cloudflare/workers-types@4.20260702.1` and
  `@5.20260811.1`, `@earendil-works/pi-coding-agent@0.80.10` (including its
  bundled `docs/` and `examples/`).
- Ditto's own source tree at `brain@57a29d5`.

No blog posts, Medium articles, or forum answers are cited as authority for any
platform capability. One web search was run to check for the *absence* of
Cloudflare KVM documentation; its results are used only as a pointer to
first-party pages, which were then read directly.

### What could not be verified — summary

Listed in full in §10. The load-bearing ones:

- Cloudflare has **no published statement** about `/dev/kvm`, nested
  virtualisation, `CAP_*`, seccomp profiles, or LSM policy inside Containers.
  §3 establishes the answer by other means and says so explicitly.
- Whether workerd's container runtime applies a seccomp filter that would block
  `runsc`'s systrap platform.
- The Node.js version, uid, and available kernel features inside
  `docker.io/cloudflare/sandbox:0.12.3`.
- Whether `container.snapshotDirectory` / `snapshotContainer` (present in shipped
  runtime types) are usable today.

---

## 2. What Perplexity actually documented

Source: **["Making SPACE: Secure and Efficient Runtimes for Long-Running
Agents"](https://research.perplexity.ai/articles/making-space-secure-and-efficient-runtimes-for-long-running-agents)**,
dated **Jul 15, 2026**, fetched 2026-08-15. Sibling articles were checked:
"Rethinking Search as Code Generation" says only *"We've made significant
investments in optimizing and hardening our sandboxes, and their overarching
system design merits an article of its own"* — no technical detail. "Designing,
Refining, and Maintaining Agent Skills at Perplexity" is not about runtimes.
**There is exactly one first-party SPACE architecture document.** VERIFIED.

### 2.1 Layer decomposition, verbatim

> "At a high level, the system is organized into three layers.
> The **control plane** is the brain of the system, deciding what should exist and
> where. It consists of the API gateway and cluster-level state management modules.
> **Node-local services** are the local machinery required to execute the control
> plane's plan. They own the sandbox lifecycle, storage, networking, and the
> privileged operations behind them.
> The **sandbox** is the isolated execution environment itself. It's implemented as
> a virtual machine paired with the `space`-daemon: an in-guest background process
> that brokers filesystem, process, and network access for the workload."

Control plane, verbatim:

> "The API gateway is the entrypoint. Incoming requests are authenticated and
> authorized, then translated into records of desired state."
> "The control plane is stateless by design, with all durable information offloaded
> to a shared database. It tracks cluster-level information on sandboxes, such as
> which node they are assigned to, where they're running, and whether they've been
> backed up to durable storage. It continually compares the desired state against
> the observed state and drives the two towards convergence. Operations are
> idempotent, so the control plane can recover automatically after any crash,
> restart, or partial failure."

Node-local services, verbatim:

> "The **sandbox manager** knows which sandboxes are running, paused, suspended, or
> stopped, along with their real resources. It runs unprivileged and delegates all
> privileged work to the **node manager**, the single root process that brokers the
> underlying primitives. Storage is handled locally and durably: snapshots of
> current sandbox states are saved on the node, and a **volume manager** moves
> snapshots and templates to and from object storage as needed to enable cross-node
> operations. Safety gates guard what a sandbox can reach: the **credential
> manager** governs credential injection under per-service authorization, and the
> **network gateway** enforces each sandbox's egress policy."

VERIFIED.

### 2.2 Isolation technology, precisely as stated

> "The sandbox itself is a virtual machine (VM) with its own guest kernel, running
> the user's workload behind a hardware isolation boundary. Because each sandbox
> has its own kernel, a compromised workload cannot fall back on a shared host
> kernel as a single point of failure; even if it successfully exploits its guest
> kernel, that compromise is confined to the sandbox's VM boundary rather than
> propagating across other workloads."

> "Sandbox isolation has two components, VM isolation and host OS process
> isolation. Both must be breached for cross-sandbox access."

And the motivating contrast, verbatim:

> "Traditional container-based sandbox approaches aren't designed for these tasks.
> They typically assume short-lived, stateless jobs and have the kernel as a single
> point of failure."

**What is named:** a VM with its own guest kernel; hardware isolation; host OS
process isolation as a second layer; `btrfs` as the on-node filesystem.

**What is never named:** Firecracker. Cloud Hypervisor. QEMU. gVisor. KVM. Any
VMM at all. Any container runtime. Any orchestration system, except the single
word "pods" in §2.3 below. **UNVERIFIED** which hypervisor SPACE uses. Anyone
citing this article as evidence that Perplexity uses Firecracker is over-reading
it.

### 2.3 Snapshot / restore mechanism and the numbers

> "Snapshots are the mechanism underneath most of these capabilities. A scheduler
> ticks on regular intervals and captures two types of snapshots: **disk snapshots**
> (point-in-time copies of the filesystem) and **full snapshots** (checkpoints of
> the entire paused VM). Disk snapshots are captured frequently, while full
> checkpoints are less frequent. Everything stays on the node, and retention decays
> by tier."

> "When a sandbox is suspended, the VM is paused, a full snapshot is taken, and the
> artifacts from the full snapshot are uploaded to object storage. A database row
> tracks the snapshot and only becomes restorable once every artifact has landed,
> so a partially uploaded snapshot can never be resumed into a corrupt state.
> Restore is the inverse of suspend. Because the snapshot lives in object storage
> rather than on the original node, any node can bring the sandbox back. The
> scheduler picks a node, that node downloads the artifacts, reapplies the
> filesystem delta on top of the template, and resumes the VM from its captured
> state."

Fast *creation* is a **separate** mechanism from snapshots:

> "Instead of creating a sandbox from scratch each time, we keep a **warm pool of
> pods** that already have common templates materialized on disk, and satisfy a
> request by binding it to a pod whose template already matches. Giving that
> sandbox its own writable root filesystem is then a copy-on-write clone rather
> than a full copy."

The published numbers, verbatim:

> "median create latency fell from 185 milliseconds to 60 milliseconds (3.1x
> improvement), and the 90th-percentile latency fell from 447 milliseconds to 89
> milliseconds (5.0x improvement)"

**These are create-latency numbers, not restore-latency numbers.** The article
publishes **no restore latency figure at all**. VERIFIED by exhaustive read of
the article text.

Scale claims, verbatim: *"it has securely supported millions of sandbox
creations and tens of millions of reconnects"*; *"As of today, 100% of Computer
sessions now run on SPACE."*

### 2.4 Credentials

> "Credentials never live where an agent can steal them. The credential store sits
> outside the sandbox boundary and is responsible for the credential lifecycle. It
> stores and retrieves secrets via a pluggable vault backend, resolves credentials
> using hierarchical scoping, manages metadata such as injection method and expiry,
> and enforces rate limits and audit logging on all access. **When needed,
> credentials are injected at the network layer or auto-filled by a browser agent,
> instead of entering the sandbox directly.**"

Note the placement: the credential store and credential manager are described
under **node-local services**, not the control plane. VERIFIED.

### 2.5 Network egress

> "Communication with the sandbox is strictly controlled; processes can only
> communicate through dedicated channels. **The network gateway forces all egress
> through it.** The `space` daemon is the only sanctioned channel between the
> (untrusted) sandbox and the (trusted) platform."

> "Crucially, the `space` daemon does not talk to clients directly but rather
> communicates with the host over a private in-VM channel. This keeps all guest
> interaction on a controlled path and **reserves the sandbox's own network purely
> for the workload's outbound traffic.**"

VERIFIED. This is a centralised egress proxy plus network-layer credential
injection — architecturally the same shape as Cloudflare's outbound handlers
(§4.4 of `brain-architecture-research.md`).

### 2.6 The user's paraphrase, checked against the article

| # | Paraphrase claim | Verdict |
|---|---|---|
| 1 | "Control plane is stateless" | **Accurate.** "The control plane is stateless by design" |
| 2 | "manages the API" | **Accurate.** "The API gateway is the entrypoint" |
| 3 | "tracks sandbox state" | **Accurate.** "It tracks cluster-level information on sandboxes" |
| 4 | "issues short-lived tokens and access" | **Diverges.** The article never says the control plane issues tokens. The gateway *authenticates and authorizes* incoming requests. Credential lifecycle, expiry, and injection are owned by the **credential manager**, which the article places in **node-local services**. The user has moved credential authority up one layer |
| 5 | "Node-level services start/pause/resume/stop sandboxes" | **Accurate.** "operations like create, pause, resume, suspend, and restore" |
| 6 | "save snapshots for fast create and restore" | **Half accurate.** Snapshots power suspend/restore/rollback/crash-recovery. Fast **create** comes from a warm pod pool plus btrfs reflink copy-on-write off a *template* — explicitly a different mechanism. Conflating them is the difference between "restore a saved session" and "clone a base image" |
| 7 | "control credentials and network access" | **Accurate.** "the credential manager governs credential injection… the network gateway enforces each sandbox's egress policy" |
| 8 | "harness inside the sandbox" | **Not in the article.** The in-guest process is the `space` daemon, a *platform* broker for filesystem/process/network and idle reporting. It is not an agent harness. The article never mentions an agent harness, a coding agent, or a model loop |
| 9 | "an isolated VM created within the container for agent sessions" | **Not in the article, and contrary to it.** SPACE has no container-holding-a-VM. The sandbox **is** the VM. The article's opening argument is *against* container-based sandboxes. The single mention of "pods" is a warm pool of pods on the node — placement infrastructure, not a per-session nesting layer, and no harness is described as living in one |
| 10 | "user has access to the isolated VM and not the container" | **Not stated.** The stated boundary is guest (untrusted) vs. host/platform (trusted), mediated by the `space` daemon over a private in-VM channel |
| 11 | "the container holding the harness is trusted and performs git actions" | **Not in the article.** The words "git", "harness", "agent session", "commit", and "repository" do not appear in it. SPACE is substrate; the agent layer is out of its scope |

**Consequence.** Rows 8–11 are the entirety of the proposal's Layer 3, and none
of them come from Perplexity. The proposal's most novel and most expensive layer
is the author's own design, presented as if it were the vendor's. That does not
make it wrong, but it means the SPACE article provides **no evidence** for it,
and §3 must decide it on Cloudflare's facts alone.

**What the article *does* support, and support well:** stateless control plane
over a shared DB; node-local lifecycle + storage + safety gates; credentials
outside the sandbox injected at the network layer; forced egress through a
gateway; snapshot-backed suspend/restore. Four of those five are already
available to Ditto on Cloudflare today (§4, §7).

---

## 3. The load-bearing question: can you nest a VM inside a Cloudflare Container?

This section gets the most rigour because Layer 3 depends entirely on it.

### 3.1 What a Cloudflare Container actually is

VERIFIED, [Lifecycle of a
Container](https://developers.cloudflare.com/containers/platform-details/architecture/)
(last updated 2026-08-13):

> "Each container instance **runs inside its own VM**, which provides strong
> isolation from other workloads running on Cloudflare's network. Containers should
> be built for the `linux/amd64` architecture."

And, from the [`containers_pid_namespace` compatibility
flag](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#use-an-isolated-pid-namespace-for-containers)
(default on for compat dates ≥ 2026-04-01; Ditto is on `2026-07-10`):

> "When `containers_pid_namespace` is set, containers will use an isolated PID
> namespace. The `ENTRYPOINT` of your container will have PID 1.
> When unset, **the container shares the PID namespace with the virtual machine
> (VM) containing the container**."

INFERRED, high confidence: the platform shape is **one VM per container
instance, running an OCI container inside it**. Cloudflare already gives you
exactly the outer boundary Perplexity's SPACE gives — a per-tenant VM with its
own kernel — and the `Sandbox` security page states the same properties
(filesystem, process, network, resource isolation; VERIFIED,
[Security model](https://developers.cloudflare.com/sandbox/concepts/security/),
re-fetched 2026-08-15, unchanged from the 2026-08-06 text quoted in
`brain-architecture-research.md` §3.3).

Cloudflare does **not** name the VMM. **UNVERIFIED** whether it is
Firecracker-class. What matters here is not the brand: it is that a per-instance
VM boundary already exists, which changes what an *inner* boundary can add
(§3.10).

### 3.2 Privilege inventory — what the docs actually permit

This is the decisive evidence. Three independent readings.

**(a) Cloudflare states it outright, twice.**

[Run Docker-in-Docker](https://developers.cloudflare.com/sandbox/guides/docker-in-docker/)
(last updated 2026-04-21), verbatim:

> "**Cloudflare Containers run without root privileges**, so you must use the
> rootless Docker image."

> "Limitations… **No iptables** — Network isolation features that rely on iptables
> are not available. **Rootless mode only** — You cannot use privileged containers
> or features requiring root. **Ephemeral storage** — Built images and containers
> are lost when the sandbox sleeps."

[Containers FAQ](https://developers.cloudflare.com/containers/faq/) (last
updated 2026-08-13), verbatim:

> "Can I run Docker inside a container (Docker-in-Docker)? Yes. Use the
> `docker:dind-rootless` base image since **Containers run without root
> privileges**."
> "Cloudflare Containers **do not support iptables manipulation**."

**(b) The configuration surface has no knob for it.** The complete list of
`containers[]` options in the [Wrangler configuration
reference](https://developers.cloudflare.com/workers/wrangler/configuration/#containers)
is: `image`, `class_name`, `instance_type`, `max_instances`, `name`,
`image_build_context`, `image_vars`, `rollout_active_grace_period`,
`rollout_step_percentage`, `ssh`, `wrangler_ssh`, `authorized_keys`,
`constraints.regions`, `constraints.jurisdiction`. VERIFIED by exhaustive read.
There is **no** `privileged`, `cap_add`, `devices`, `security_opt`, `seccomp`,
`apparmor`, or `sysctls`.

**(c) The runtime API has no knob for it either.** Shipped types,
`@cloudflare/workers-types@5.20260811.1/experimental/index.d.ts:4056-4079`:

```ts
type ContainerStartupOptions = {
  entrypoint?: string[];
  enableInternet: boolean;
  env?: Record<string, string>;
  hardTimeout?: number | bigint;
  instance?: "lite" | "standard-1" | … | ContainerStartResources;
  labels?: Record<string, string>;
  directorySnapshots?: ContainerDirectorySnapshotRestoreParams[];
} & ({ image: string; containerSnapshot?: never }
   | { image?: never; containerSnapshot?: ContainerSnapshot });
```

and `:3980-3987`:

```ts
interface ContainerExecOptions {
  cwd?: string; env?: Record<string,string>; user?: string;
  stdin?: ReadableStream | "pipe";
  stdout?: "pipe" | "ignore";
  stderr?: "pipe" | "ignore" | "combined";
}
```

VERIFIED. No capability, device, or security-context field anywhere.

**Verdict.** **INFERRED, very high confidence: you cannot run a hardware-assisted
VM inside a Cloudflare Container.** The reasoning chain:

1. Firecracker/Kata/QEMU-KVM all require `/dev/kvm` (§3.3).
2. No documented mechanism exists to request a device node, and none of the three
   configuration surfaces (Wrangler, `ContainerStartupOptions`,
   `ContainerExecOptions`) has a field for one.
3. The container itself already runs inside a VM. Exposing VMX/SVM to that guest
   is nested virtualisation, which Cloudflare documents nowhere.
4. Cloudflare's only statement about elevated privilege is a flat "you cannot use
   privileged containers or features requiring root."

**UNVERIFIED:** a *direct* Cloudflare statement of the form "`/dev/kvm` is not
available." Cloudflare never mentions KVM in the Containers or Sandbox
documentation at all. The conclusion above is inference from four converging
verified facts, not a quotation. State it that way; do not attribute it to
Cloudflare as a claim they made.

**One important thing the same evidence *establishes affirmatively*:** rootless
Docker-in-Docker is documented as working. Rootless `dockerd` fundamentally
depends on unprivileged user namespaces. **INFERRED, high confidence:
unprivileged user namespaces are usable inside a Cloudflare Container.** So is
FUSE — Cloudflare's own [R2 FUSE mount
example](https://developers.cloudflare.com/containers/examples/r2-fuse-mount/)
runs `tigrisfs` with no special configuration, and the Sandbox SDK's own
`restoreBackup` "mounts the squashfs archive with FUSE overlayfs" (VERIFIED,
[Backups API](https://developers.cloudflare.com/sandbox/api/backups/)). That
matters for §3.6.

### 3.3 Hardware-virtualisation options — closed quickly

| Option | Requirement | Primary source | Verdict |
|---|---|---|---|
| **Firecracker** | "Firecracker requires read/write access to **`/dev/kvm`** exposed by the KVM module." Also: "In production, Firecracker is designed to be run securely inside an execution jail, set up by the `jailer` binary" (the jailer needs root) | [firecracker `docs/getting-started.md`](https://raw.githubusercontent.com/firecracker-microvm/firecracker/main/docs/getting-started.md) | **Not buildable** |
| **Kata Containers** | Runs a guest VM via one of five VMMs: Cloud Hypervisor, Firecracker, QEMU, Dragonball, StratoVirt. All are KVM-based | [kata `docs/hypervisors.md`](https://raw.githubusercontent.com/kata-containers/kata-containers/main/docs/hypervisors.md), [`docs/design/architecture/README.md`](https://raw.githubusercontent.com/kata-containers/kata-containers/main/docs/design/architecture/README.md) | **Not buildable** |
| **QEMU + KVM accelerator** | KVM accelerator requires Linux + the KVM module | [QEMU System Emulation Introduction](https://www.qemu.org/docs/master/system/introduction.html) accelerator table | **Not buildable** |
| **QEMU + TCG accelerator** | "a JIT known as the **Tiny Code Generator (TCG)** capable of emulating many CPUs." Host OS: "Linux, other POSIX, Windows, MacOS". **No hardware requirement** | ibid. | **Technically possible; see below** |

QEMU-TCG is the only VM option not foreclosed. Two things about it:

- **UNVERIFIED: the performance cost.** QEMU's own documentation does not
  quantify TCG-vs-KVM slowdown, and no primary source giving a number was found.
  Do not repeat a folk figure.
- **The instance ceiling is the real constraint, and it is verifiable.** The
  largest Cloudflare Container is 4 vCPU / 12 GiB / 20 GB disk (custom instance
  types: min 1 vCPU, max 4 vCPU, max 12 GiB memory, max 20 GB disk, ≥3 GiB per
  vCPU, ≤2 GB disk per GiB memory — VERIFIED, [Limits and Instance
  Types](https://developers.cloudflare.com/containers/platform-details/limits/),
  updated 2026-07-03). Ditto is on `lite`: **1/16 vCPU, 256 MiB, 2 GB disk**.
  INFERRED: running a full software-emulated guest kernel plus a Node toolchain
  plus a dev server inside 1/16 of a vCPU is not a viable product. Even at
  `standard-4` you are paying full interpretation cost on 4 vCPU shared with
  everything else.

**Directly relevant:** Pi's own micro-VM example requires exactly this. The
shipped
`examples/extensions/gondolin/index.ts:17-20` header states its requirements
verbatim: *"Node.js >= 23.6.0 for @earendil-works/gondolin"* and *"QEMU installed
(for example, `brew install qemu` on macOS)"*. `docs/containerization.md:43`
repeats it. VERIFIED. The pattern the proposal wants is the pattern Pi ships,
and it needs a hypervisor.

### 3.4 gVisor (`runsc`) — the strongest non-hardware candidate

**Does it need KVM? No.** VERIFIED,
[Platform Guide](https://gvisor.dev/docs/architecture_guide/platforms/):

> "**KVM** — The KVM platform uses the kernel's KVM functionality to allow the
> Sentry to act as both guest OS and VMM."
> "**systrap** — The systrap platform relies on **seccomp's `SECCOMP_RET_TRAP`
> feature** in order to intercept system calls… systrap replaced ptrace as the
> default gVisor platform in mid-2023."
> "**ptrace** — The ptrace platform uses **`PTRACE_SYSEMU`** to execute user code
> without allowing it to execute host system calls. This platform can run anywhere
> that ptrace works (**even VMs without nested virtualization**), which is
> ubiquitous."
> "The `systrap` platform is a better choice when running **inside a VM**, or on a
> machine without virtualization support."

`SECCOMP_SET_MODE_FILTER` works unprivileged: VERIFIED,
[`seccomp(2)`](https://man7.org/linux/man-pages/man2/seccomp.2.html):

> "either the calling thread must have the `CAP_SYS_ADMIN` capability in its user
> namespace, **or the thread must already have the `no_new_privs` bit set**."

**Does it work unprivileged inside an already-containerised environment?**
gVisor has a documented page for exactly this. VERIFIED,
[Rootless](https://gvisor.dev/docs/user_guide/rootless/), section headed
*"Advanced: Running in Strict, Unprivileged Environments (No `setuid`)"*:

> "**If you are running `runsc` inside a nested container** or an environment where
> `setuid` binaries (like `newuidmap(1)`) are stripped or unavailable, then you are
> more restricted in what UID/GID mappings you can specify. To bypass `newuidmap`,
> the runtime must fall back to a strictly unprivileged **Single-UID Mapping**."

The kernel constraints it then lists match
[`user_namespaces(7)`](https://man7.org/linux/man-pages/man7/user_namespaces.7.html)
exactly: mapping size must be 1, host ID must equal the writer's effective
UID/GID, and `setgroups` must be denied first.

But the limitations are severe and are stated on the same page. VERIFIED:

| Mode | Documented limitation |
|---|---|
| `runsc --rootless` | "The **`create` command is not supported**. Using `runsc create` is the common case. The `--rootless` flag is mainly only suitable for `runsc do`." / "**Save/restore functionality is not supported.**" / "gVisor's **Netstack is not supported**, meaning you have to use the host network for external connectivity." / "Configuration errors related to cgroups are ignored." |
| Single-UID fallback | "Because you only have a single valid UID inside this flattened namespace, **you cannot extract standard Linux container images (like Ubuntu) that contain files owned by various system UIDs**… configure your higher-level engine to ignore `chown` errors during image extraction." |

INFERRED consequences for the proposal:

- **No Netstack under `--rootless` means no gVisor-enforced network boundary.**
  The inner jail would share the container's network stack. Combined with
  "Cloudflare Containers do not support iptables manipulation," there is **no
  mechanism to give the inner jail a different egress policy than the outer
  container**. The one thing that would have to differ — network isolation
  between the trusted harness and the untrusted session — is precisely what is
  unavailable.
- **No save/restore under `--rootless`** removes the snapshot story from the
  inner layer.
- `runsc do` only (no `create`) means no OCI lifecycle, so per-session
  create/pause/resume of inner jails is not the supported path.

**UNVERIFIED and decisive for a spike:** whether workerd's own container runtime
already applies a seccomp filter that denies the syscalls `runsc` systrap needs
(`seccomp`, `ptrace`, `clone` with `CLONE_NEWUSER`, `unshare`, `process_vm_*`,
`userfaultfd`). Cloudflare publishes no seccomp profile. Nothing in the docs
either confirms or denies it. This is a one-hour experiment (`unshare -Ur
true`, `runsc --rootless do true`) and would settle §3 empirically.

### 3.5 Everything else achievable in-container

Each row: what it isolates, what it needs, and whether it plausibly works
unprivileged inside a rootless, already-containerised environment.

| Mechanism | Isolates | Requires | Works unprivileged in-container? | Primary source |
|---|---|---|---|---|
| **User namespaces** (`unshare(2)` + `CLONE_NEWUSER`) | uid/gid view, and — combined in one call — mount/PID/net/IPC/UTS namespaces | "Since Linux 3.8, unprivileged processes can create user namespaces, and the other types of namespaces can be created with just the `CAP_SYS_ADMIN` capability in the caller's user namespace… it is possible for an **unprivileged caller** to specify this combination of flags." Nesting limit 32 levels | **Yes** — INFERRED from Cloudflare documenting rootless DinD as working | [`user_namespaces(7)`](https://man7.org/linux/man-pages/man7/user_namespaces.7.html) |
| **bubblewrap (`bwrap`)** | Filesystem view, namespaces, `no_new_privs` | "Bubblewrap uses these [user namespaces] to build the sandbox, allowing any user to use the tool." "Historically, bubblewrap also supported a setuid mode… However, this has been removed." "bubblewrap uses `PR_SET_NO_NEW_PRIVS` to turn off setuid binaries" | **Yes**, if unprivileged userns is available | [bubblewrap README](https://raw.githubusercontent.com/containers/bubblewrap/main/README.md) |
| **nsjail** | UTS/MOUNT/PID/IPC/NET/USER/CGROUP/TIME namespaces, `chroot`/`pivot_root`, rlimits, seccomp-bpf via Kafel | Same namespace machinery; its own Docker example uses `--privileged` for convenience, not necessity | **Probably**, same caveat | [nsjail README](https://raw.githubusercontent.com/google/nsjail/master/README.md) |
| **seccomp-bpf** | Syscall surface of a process and its children | `CAP_SYS_ADMIN` **or** `no_new_privs` | **Yes** | [`seccomp(2)`](https://man7.org/linux/man-pages/man2/seccomp.2.html) |
| **Landlock LSM** | Filesystem hierarchies; TCP bind/connect (ABI v4); abstract-UNIX-socket and signal scoping (ABI v6) | "Landlock — **unprivileged access-control**… enables any processes to securely restrict themselves and their future children." Needs kernel support **enabled at boot**, and `PR_SET_NO_NEW_PRIVS` before `landlock_restrict_self(2)`. Irreversible: "once a thread is landlocked, there is no way to remove its security policy; only adding more restrictions is allowed" | **Yes if the kernel has it enabled** — **UNVERIFIED** for Cloudflare's kernel | [`landlock(7)`](https://man7.org/linux/man-pages/man7/landlock.7.html) |
| **Rootless Docker / DinD** | Full inner OCI containers | Rootless image; `--iptables=false --ip6tables=false`; `--network=host` for connectivity | **Yes, documented by Cloudflare** — but "each inner container has access to your outer container's network stack. Ensure you understand the security implications" | [DinD guide](https://developers.cloudflare.com/sandbox/guides/docker-in-docker/) |
| **WASM/WASI (wasmtime)** | Memory, control flow, and imports of guest code | Nothing privileged; it is a userspace JIT | **Yes** | [Wasmtime Security](https://docs.wasmtime.dev/security.html): "The callstack is inaccessible… Pointers… are compiled to offsets into linear memory… All control transfers… are to known and type-checked destinations… There is no undefined behavior" |
| **V8 isolates** | JS heap between isolates | Nothing privileged | **Yes**, but only for JS. Not a boundary for `bash`, `pnpm`, native binaries, or a Vite dev server | — |
| **CRIU (checkpoint/restore)** | — (a snapshot tool, not a jail) | "Due to restrictions imposed by several kernel APIs CRIU uses, the tools **can only work with run with root privileges**." Kernel must be built with `CONFIG_CHECKPOINT_RESTORE`, `CONFIG_NAMESPACES`, `CONFIG_*_NS`, `CONFIG_FHANDLE`, `*_DIAG`, `CONFIG_TUN`, … | **No** | [criu.org/Security](https://criu.org/Security), [criu.org/Linux_kernel](https://criu.org/Linux_kernel) |

WASM/WASI deserves a specific note. It is a real, unprivileged, in-container
boundary with an excellent security story — but it isolates *WASM modules*. It
cannot contain a `pnpm install`, a `tsc`, a `vitest` run, or a dev server, which
is the entire workload Ditto's sandbox exists to run. INFERRED: not applicable
to the threat as posed.

### 3.6 What an inner boundary would actually buy — the most important finding

Take the threat at face value: **"agent-executed code reads the harness's
credentials from the same container."**

Cloudflare's own security page describes this exact scenario and names the fix
(VERIFIED, [Handle outbound
traffic](https://developers.cloudflare.com/sandbox/guides/outbound-traffic/) and
[Security model](https://developers.cloudflare.com/sandbox/concepts/security/),
quoted at length in `brain-architecture-research.md` §3.3 / §4.4, re-checked
2026-08-15):

> "Passing external API credentials directly to a sandbox — via environment
> variables or files — means the sandbox process holds a live credential that any
> code running inside it can read. **Outbound handlers remove that exposure by
> keeping credentials in the Worker** and injecting them into outbound requests…"
> "Because outbound handlers run in the Workers runtime — outside the sandbox —
> they can hold secrets that the sandbox itself never sees… This is especially
> useful for agentic workloads **where you cannot fully trust the code running
> inside the sandbox**. With this pattern: No token is exposed to the sandbox…"

Set the two designs side by side against that one threat:

| Property | Inner jail (Layer 3 as proposed) | Credential broker (outbound handlers) |
|---|---|---|
| Credential present in the container at all | **Yes** — it lives in the trusted zone, one boundary away | **No** — it lives in the Workers runtime, never in the container |
| Depends on the inner boundary holding | **Yes**. A gVisor/namespace escape reaches the credential | **No**. There is no credential to reach |
| Depends on unavailable platform features | Yes (§3.3, §3.4) | No — `Container` ships the API today (§4.2) |
| Cost to implement | New isolation layer, new lifecycle, new tool-routing layer, new failure modes | A static method on a class Ditto already deploys |
| Also gives egress allow/deny | No (no iptables; no Netstack under rootless runsc) | **Yes** — `enableInternet:false` + `allowedHosts`/`deniedHosts` |

INFERRED, and this is the sharpest finding in the document: **an inner jail is a
strictly weaker answer to the stated threat than removing the credential.** The
jail's security property is conditional on the jail not being escaped; the
broker's is unconditional, because absence beats containment. And the jail
cannot be built on this platform anyway.

The narrower version — **process/user separation plus file permissions** — is
partially available and worth stating precisely, because it has a real and
non-obvious cost:

- `ContainerExecOptions.user` (`string`, "image user for the process") lets the
  Worker launch a container process as a different image user. VERIFIED,
  [Durable Object container
  API](https://developers.cloudflare.com/durable-objects/api/container/#exec).
  So a second uid for agent tool processes is *mechanically* available.
- **But Cloudflare documents that this breaks Sandbox backups.** VERIFIED,
  [Backups API](https://developers.cloudflare.com/sandbox/api/backups/):
  > "The backup process uses `mksquashfs`, which must have read access to every
  > file and subdirectory in the target path. **If any file has restrictive
  > permissions (for example, directories owned by a different user), the backup
  > fails** with a `BackupCreateError: mksquashfs failed: Could not create
  > destination file: Permission denied` error."
- And Ditto's image runs everything as one uid today: `Dockerfile:3` uses
  `COPY --chown=0:0`. VERIFIED.

INFERRED: uid separation inside the container is available, cheap, and
**directly conflicts with the workspace-backup mechanism Ditto currently
depends on** (`sandbox-backup.ts`). That trade is real and is not mentioned
anywhere in the proposal.

---

## 4. Layer 3 alternative: is dropping the Sandbox SDK for a raw Container right?

### 4.1 `Sandbox` *is* a `Container`

VERIFIED from installed source,
`@cloudflare/sandbox@0.12.3/dist/sandbox-BhIQBik-.d.ts:2688`:

```ts
declare class Sandbox<Env = unknown> extends Container<Env> implements ISandbox {
```

Everything on the `Container` base class is already on the class Ditto deploys.

### 4.2 Do the security features live on `Container`? Yes — re-verified

The prior doc's §3.3 availability table asserted this. It was re-verified
directly against the installed
`@cloudflare/containers@0.3.7/dist/lib/container.d.ts` on 2026-08-15, and is
**confirmed and slightly larger than previously reported**:

| API | Line | Kind |
|---|---|---|
| `static outbound` / `outboundByHost` / `outboundHandlers` / `outboundProxy` / `outboundProxies` | `:50-59` | static getter/setter pairs |
| `enableInternet` | `:65` | instance field |
| `interceptHttps: boolean` | `:67` | instance field |
| `allowedHosts?: string[]` / `deniedHosts?: string[]` | `:68-69` | instance fields |
| `setOutboundHandler` / `setOutboundByHost` / `removeOutboundByHost` / `setOutboundByHosts` | `:87-113` | methods |
| `setAllowedHosts` / `setDeniedHosts` | `:120,128` | methods |
| **`allowHost` / `denyHost` / `removeAllowedHost` / `removeDeniedHost`** | `:134-152` | methods — *not listed in the prior doc* |
| `ContainerProxy` (WorkerEntrypoint) | `:46-48` | export |
| `sleepAfter`, `envVars`, `entrypoint`, `labels`, `pingEndpoint` | `:62-70` | instance fields |
| `start(startOptions?, waitOptions?)`, `startAndWaitForPorts`, `waitForPort`, `stop(signal)`, `destroy()` | `:173-209` | lifecycle |
| `onStart` / `onStop(params)` / `onActivityExpired` / `onError` | `:214-236` | hooks |
| `renewActivityTimeout`, `schedule(when, callback, payload)`, `alarm`, `listSchedules`, `getSchedule` | `:242-383` | scheduling |
| `containerFetch(...)`, `fetch(request)`, `getState()` | `:277-285`, `:78` | request path |

VERIFIED. **The entire egress/credential-broker surface the proposal wants is
available to Ditto today without changing packages, without `@next`, and
without dropping the Sandbox SDK.** The only change required is stopping the
bare re-export at `apps/web/src/server.ts:4` (`export { Sandbox } from
"@cloudflare/sandbox";`) and declaring a subclass, plus exporting
`ContainerProxy`.

INFERRED: **the "raw Container instead of Sandbox SDK" move buys zero security
capability.** Whatever else motivates it, it cannot be motivated on the
security axis.

### 4.3 What a raw Container would have to reimplement

Ditto's current use, re-counted from source on 2026-08-15 (`apps/web/src`,
excluding tests) — **119 `sandbox.*` / `shell.*` call expressions across 125
lines**, up from the 83 counted on 2026-08-14:

| API | Sites | Available on a raw `Container`? |
|---|---|---|
| `sandbox.exec` | 38 | Partly — `ctx.container.exec(argv, {cwd, env, user, stdin, stdout, stderr})` exists, but it is argv-only ("It does not start a shell or interpret pipes, redirects, expansion") and returns a handle, not a buffered result |
| `sandbox.exists` | 15 | **No.** Reimplement via `exec(["test","-e",p])` |
| `shell.deleteFile` / `mkdir` / `writeFile` / `readFile`, `sandbox.readFile` | 26 | **No.** Reimplement via `exec` + stdin/stdout streams, or an in-container HTTP service |
| `sandbox.createSession` / `deleteSession`, `shell.id` | 21 | **No.** Sessions (persistent cwd + env) do not exist on `Container`. Per-launch `cwd`/`env` on `exec` is the closest analogue |
| `shell.exec` | 8 | as above |
| `sandbox.getProcess` / `startProcess` / `killProcess` / `streamProcessLogs`, `shell.startProcess` | 7 | Partly. `ExecProcess` gives `pid`, `stdout`/`stderr` streams, `exitCode`, `kill(signal)`. But "**Process and terminal IDs belong to the current container**" and there is no server-side process registry or log buffer to re-attach to |
| `sandbox.exposePort` / `unexposePort` / `getExposedPorts` | 4 | **No.** Preview URLs are a Sandbox feature. `proxyToSandbox` is typed `<T extends Sandbox<any>>` (`dist/index.d.ts:240`). A raw container gets `getTcpPort(port)` returning a `Fetcher` and would need its own proxy, its own token scheme, and its own wildcard-route handling |
| `sandbox.createBackup` / `restoreBackup` | 2 | **No.** squashfs→R2 + presigned URLs + FUSE overlayfs restore is Sandbox-only. See §7 for the raw alternative |
| `sandbox.gitCheckout` | 1 | **No.** `exec(["git","clone",…])` |
| `shell.execStream` | 1 | Partly — `process.stdout` is a `ReadableStream`; the NDJSON→SSE bridge would need rewriting against a different handle shape |
| `sandbox.getState` / `destroy` | 3 | Yes (`getState()`, `destroy()` on `Container`) |

INFERRED: a raw-Container port is roughly the same size as the `@next`
migration priced in `brain-architecture-research.md` §4.2, **plus** hand-written
implementations of the file API, the session abstraction, the process registry,
the preview-URL proxy, and the backup mechanism — none of which the migration
required. It is the more expensive of the two, for a security benefit of zero
(§4.2).

### 4.4 Can a raw Container host a long-lived process? Yes

VERIFIED, [Containers
FAQ](https://developers.cloudflare.com/containers/faq/) and [Lifecycle of a
Container](https://developers.cloudflare.com/containers/platform-details/architecture/):

- "Cloudflare does not stop a container instance after a fixed maximum runtime."
- `sleepAfter` default `"10m"`; `onActivityExpired()` default implementation
  calls `stop()`; you may override it to keep the instance alive.
- "Even if your hook keeps the instance running, **another platform event can
  stop it**. One of those cases is a host server restart, which happens on an
  irregular cadence. **Cloudflare does not guarantee that any container instance
  will run for any set period of time.**"
- Shutdown sequence: `SIGTERM` → wait up to **15 minutes** → `SIGKILL`. The same
  sequence runs on a rollout.
- Addressing: `env.MY_CONTAINER.get(id)` → DO stub → `containerFetch`, or
  `ctx.container.getTcpPort(port)` for raw TCP/HTTP/WebSocket, or
  `ctx.container.exec()`. "Durable Objects and their associated Container
  instances are **not guaranteed to run in the same location**."
- Cold start: "often in the 1-3 second range, but this is dependent on image size
  and code execution time."
- `max_instances` defaults to **20**; Ditto sets **1** (`alchemy.run.ts:22`).

INFERRED: a long-lived trusted harness process in a raw container is
mechanically supported, with the caveat that it can be stopped at any time and
that the 15-minute `SIGTERM` grace is the only cleanup window.

---

## 5. Layer 2: can Cloudflare Workflows be a node-level supervisor?

### 5.1 Verified limits (re-checked 2026-08-15)

From [Workflows
limits](https://developers.cloudflare.com/workflows/reference/limits/) and
[pricing](https://developers.cloudflare.com/workflows/reference/pricing/):

| Fact | Free | Paid |
|---|---|---|
| CPU per step | 10 ms | 30 s default, configurable to 5 min |
| Wall clock per step | Unlimited | Unlimited |
| Max steps per workflow | 1,024 | 10,000 default → 25,000 |
| Non-stream step result | 1 MiB | 1 MiB |
| **Event payload size** | 1 MiB | 1 MiB |
| State per instance | 100 MB | 1 GB |
| Concurrent running instances | 100 | 50,000 |
| Instance creation rate | 100/s | 300/s account, **100/s per workflow** |
| Queued instances | 100,000 | 2,000,000 |
| Retention (completed) | 3 days | 30 days |
| Max instance ID length | 100 chars | 100 chars |
| Subrequests per instance | 50 | 10,000 → 10M |
| Steps billing | 3,000/day | 500,000/mo included, then **$0.80 / 100k** |

Plus, verbatim:

> "Instances that are in a `waiting` state — either sleeping via `step.sleep`,
> waiting for a retry, or waiting for an event via `step.waitForEvent` — do **not**
> count towards concurrency limits."

`waitForEvent` specifics, VERIFIED, [Events and
parameters](https://developers.cloudflare.com/workflows/build/events-and-parameters/):

- Type string up to 100 characters; **"only supports letters, digits, `-`, and
  `_`. Currently including `.` is not supported and will result in a
  `workflow.invalid_event_type` error."**
- **"The default timeout for a `waitForEvent` call is 24 hours"**, overridable.
- Delivery via `instance.sendEvent({type, payload})` from a Worker binding, or
  the REST Events endpoint.

### 5.2 Can a Workflow hold a live handle to a Container/DO across a step boundary?

**No.** VERIFIED, [Rules of
Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/):

> "**Do not rely on state outside of a step.** Workflows may hibernate and lose
> all in-memory state. This will happen when engine detects that there is no
> pending work and can hibernate until it needs to wake-up (because of a sleep,
> retry, or event)."

> "A `WorkflowEvent` and its associated `payload` property are effectively
> _immutable_: any changes to an event are not persisted across the steps of a
> Workflow."

INFERRED, direct: a `DurableObjectStub` is a live capability, not a
JSON-serialisable step result. Nothing survives a step boundary except a step's
returned value (≤1 MiB non-stream) and the immutable event payload. A supervisor
Workflow can therefore only carry **identifiers**, and must re-derive
`env.Sandbox.get(id)` inside every step. That is fine mechanically — and it is
also exactly what a Worker or a DO would do, so the Workflow adds nothing here.

### 5.3 Is a supervisor a Workflow-shaped problem?

**No, and Cloudflare has already built the thing being proposed.**

The `Container` class **is** a Durable Object (VERIFIED,
`container.d.ts:49`: `class Container<Env> extends DurableObject<Env>`;
and [Durable Object container
API](https://developers.cloudflare.com/durable-objects/api/container/): "the
container process runs your image inside a Linux VM… Because the `Container`
class extends `DurableObject`, you also have access to SQLite storage via
`this.ctx.storage`, alarms, and all other Durable Object APIs").

Map the proposal's Layer 2 responsibilities onto what already ships:

| SPACE node-local responsibility | Proposal says | Already on `Container` |
|---|---|---|
| "knows which sandboxes are running, paused, suspended, or stopped" | Workflow tracks it | `getState()`, `ctx.container.running`, `ctx.container.inspect()` |
| start / stop | Workflow does it | `start(startOptions, waitOptions)`, `startAndWaitForPorts`, `stop(signal)`, `destroy()` |
| idle detection and reclaim | Workflow polls | `sleepAfter` + `onActivityExpired()` + `renewActivityTimeout()` |
| lifecycle reactions | Workflow branches | `onStart` / `onStop({exitCode, reason})` / `onError` |
| periodic work | Workflow loop | `schedule(when, callback, payload)` + `alarm()` |
| durable per-sandbox state | Workflow state | DO SQLite (`this.ctx.storage.sql`) |
| egress policy per sandbox | "node-level services control network access" | `enableInternet`, `allowedHosts`, `deniedHosts`, `setAllowedHosts`, `denyHost`, … |
| credential injection outside the guest | "node-level services control credentials" | `static outbound` / `outboundByHost` running in the Workers runtime |

VERIFIED, every right-hand cell, from `container.d.ts` and the container-class
docs.

**INFERRED, and stated plainly: Layer 2 as proposed is not a missing layer. It
is a re-implementation of the Container Durable Object.** SPACE's node-local
service is node-local because Perplexity runs its own fleet and has to write
that code. On Cloudflare, that code is the platform. Proposing a Workflow to
supervise a Container is proposing a supervisor for a supervisor.

Two further mismatches:

- **Shape.** Workflows are step-oriented with cached step results and
  deterministic step names as the cache key. A supervisor is a *reactive state
  machine* responding to external events at unpredictable times. Expressing it as
  a step sequence means either a polling loop (§5.4) or a `waitForEvent` chain
  whose step names must stay deterministic across an unbounded number of
  pause/resume cycles — and step names are the cache key.
- **One instance per live sandbox.** 50,000 concurrent running instances, 100/s
  per workflow creation rate, 30-day retention, 100-char instance IDs. VERIFIED
  these all fit Ditto's scale comfortably. Instance creation is *not* the
  constraint. The constraint is that `create()` throws if the ID is still within
  its retention window (`brain-architecture-research.md` §3.2), so a
  sandbox-ID-derived instance ID cannot be reused for 30 days without
  `createBatch()` or an explicit shorter `retention`.

### 5.4 Billing a polling supervisor

VERIFIED: steps are billed at **500,000 included/month, then $0.80 per
additional 100,000**. Cloudflare's changelog gates the start date; the pricing
page says "Cloudflare will not bill step and storage usage before the start date
announced in the Workflows billing changelog."

INFERRED arithmetic for a supervisor that polls container state:

| Poll interval | Steps per 1-hour session | Sessions covered by the 500k monthly allowance |
|---|---|---|
| 10 s | 360 | ~1,390 |
| 30 s | 120 | ~4,160 |
| 60 s | 60 | ~8,330 |
| Event-driven only (`waitForEvent`) | ~1 per state change | effectively unbounded |

**UNVERIFIED:** whether a `step.sleep` is itself billed as a step. The docs state
only that `step.sleep` does not count toward the *max-steps limit*; they do not
address billing. If sleeps are billed, the polling numbers above roughly double.

INFERRED: polling is affordable at Ditto's current scale but is pure waste —
`onActivityExpired`, `onStop`, and `schedule()` already deliver the same signals
for free, from inside the object that owns the container.

### 5.5 What Workflows *are* good for here

Unchanged from `brain-architecture-research.md` §8.3: **run durability** — a run
that survives Worker eviction and container replacement, with per-turn and
per-tool checkpointing and deterministic retry. That is a reliability property,
argued on reliability grounds. It is not a security layer, and it is not a
sandbox supervisor.

---

## 6. Layer 1: control plane

Short, because the answer is mostly "this already exists."

### 6.1 Is Ditto's Worker stateless?

**Yes, per-request.** VERIFIED from `apps/web/src/server.ts`: module scope holds
only string constants and pure functions; the default export is
`{ async fetch(request, env) }`; all durable state is in D1 (`DB` binding),
R2 (`BACKUP_BUCKET`), and the Sandbox DO. `alchemy.run.ts:37-63` binds
`DB`, `Sandbox`, `BACKUP_BUCKET`, and secrets; no in-Worker persistence.

This matches SPACE's control-plane property exactly: *"stateless by design, with
all durable information offloaded to a shared database."* INFERRED: Layer 1 as
described is **already implemented**, with D1 in the role of SPACE's shared
database. No work is implied by this layer.

One divergence worth noting: SPACE's control plane is a **reconciler** —
*"continually compares the desired state against the observed state and drives
the two towards convergence."* Ditto's Worker is **imperative** — it performs
sandbox operations inline on the request path. INFERRED: that is a real
architectural difference, and it is the difference that produces the failure mode
`brain-architecture-research.md` §8.3 describes (a run that dies with the Worker
invocation). It is a *durability* gap, not a *security* gap, and it is the same
gap Workflows address.

### 6.2 Short-lived token issuance today

VERIFIED from `apps/web/src/lib/agent-git-jwt.ts`:

- `AGENT_GIT_JWT_TTL_SECONDS = 600` (`:5`), commented "Align with
  `AGENT_COMMAND_TIMEOUT_MS` (600_000) in agent-run — 10 minutes."
- HS256 via `crypto.subtle` (`:47-55, 67-72`), header `{alg:"HS256",typ:"JWT"}`.
- Claims `{sub:"agent-git", projectId, sessionId, userId, sandboxId, exp}` (`:84-91`).
- Verification checks signature, `sub`, `exp`, and that all four ID fields are
  non-empty strings (`:119-165`).
- The signing secret is passed in by the caller. `apps/web/src/lib/agent-run.ts:91-97`
  passes `secret: options.env.BETTER_AUTH_SECRET`. VERIFIED — the prior doc's
  claim is confirmed at the call site, not just at the definition.

INFERRED: the "issues short-lived tokens" capability exists and works. What the
proposal would *add* is a second token class for sandbox control-plane
operations. Nothing about that requires a new layer; it requires one more mint
function. And per §3.6, the better move for the git credential specifically is
`outboundByHost` + `ctx.containerId`, which removes the bearer token from the
container entirely (`brain-architecture-research.md` §4.4).

### 6.3 Is D1 adequate for "tracks sandbox state" at per-session concurrency?

VERIFIED, [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
(established 2026-08-14, `brain-architecture-research.md` §3.4): *"Each
individual D1 database is inherently single-threaded, and processes queries one
at a time."* ~1,000 q/s at 1 ms/query; ~10 q/s at 100 ms/query; hard 10 GB
ceiling that "cannot be further increased."

INFERRED: **yes, comfortably.** Sandbox-lifecycle state changes are
low-frequency events — created, started, slept, stopped, backed up. Even at 1,000
concurrent sessions each transitioning a few times an hour, that is single-digit
writes per second. The D1 concurrency risk in `brain-architecture-research.md`
§3.4 was about *agent event* volume, not lifecycle volume. Layer 1's tracking job
is not the problem.

---

## 7. Snapshots

### 7.1 What Cloudflare offers today, at the Sandbox layer

VERIFIED, [Backups API](https://developers.cloudflare.com/sandbox/api/backups/),
last updated 2026-04-24, re-fetched 2026-08-15. The load-bearing lines,
verbatim:

> **Copy-on-write** — "In production, restore uses copy-on-write semantics. The
> backup is mounted as a read-only lower layer, and new writes go to a writable
> upper layer. The backup can be restored into a different directory than the
> original. In local development, the directory is replaced on restore."

> **Ephemeral mount** — "In production, **the FUSE mount is lost when the sandbox
> sleeps or restarts. Re-restore from the backup handle to recover.** Stop
> processes writing to the target directory before restoring."

> **Partial writes** — "Partially-written files may not be captured consistently.
> Only completed writes are guaranteed to be included in the backup."

> **Path permissions** — "The backup process uses `mksquashfs`, which must have
> read access to every file and subdirectory in the target path. If any file has
> restrictive permissions (for example, directories owned by a different user),
> the backup fails."

Mechanism: create → squashfs archive → direct container-to-R2 upload via
presigned URL → metadata in R2. Restore → metadata + TTL check (60 s buffer) →
download → FUSE overlayfs mount. Errors: `BackupExpiredError`,
`BackupNotFoundError`, `InvalidBackupConfigError`, `BackupCreateError`,
`BackupRestoreError`.

**Re-confirmed** (the mount-lifetime line was flagged load-bearing): the
"Ephemeral mount" text is present and unchanged as of 2026-08-15.

`mountBucket()` — a live R2/S3/GCS mount with `prefix` and `readOnly` — remains
the unexplored alternative (`brain-architecture-research.md` §3.3).

### 7.2 What Cloudflare offers at the raw Container layer

Two contradictory signals, and both need stating.

**The docs say it does not exist yet.** VERIFIED, [Containers
FAQ](https://developers.cloudflare.com/containers/faq/) and [Lifecycle of a
Container](https://developers.cloudflare.com/containers/platform-details/architecture/),
both updated 2026-08-13:

> "All disk is ephemeral. When a Container instance goes to sleep, the next time
> it is started, it will have a fresh disk as defined by its container image.
> **Snapshots are coming soon**, which allow the user to quickly persist and
> restore the disk from an entire container or a directory."

**The shipped runtime types say the primitive already exists.** VERIFIED,
`@cloudflare/workers-types@4.20260702.1/experimental/index.d.ts:4007-4016` and
`@5.20260811.1:4022-4031`:

```ts
interface Container {
  snapshotDirectory(options: ContainerDirectorySnapshotOptions): Promise<ContainerDirectorySnapshot>;
  snapshotContainer(options: ContainerSnapshotOptions): Promise<ContainerSnapshot>;
  exec(cmd: string[], options?: ContainerExecOptions): Promise<ExecProcess>;
  interceptOutboundTcp(addr: string, binding: Fetcher): Promise<void>;
  inspect(): Promise<ContainerInfo | null>;
  …
}
```

with restore wired into startup (`:4056-4079` in v5):

```ts
directorySnapshots?: ContainerDirectorySnapshotRestoreParams[];
// and, mutually exclusive with `image`:
containerSnapshot?: ContainerSnapshot;
```

`ContainerDirectorySnapshotRestoreParams = { snapshot, mountPoint? }`.
`ContainerSnapshot = { id, size, name? }`.

Note the version delta: v4.20260702.1 has `containerSnapshot` and
`directorySnapshots` but **not** `instance` or the `image` override; v5.20260811.1
adds per-start `instance` sizing and a per-start `image`. Ditto depends on
`@cloudflare/workers-types: ^4.20260605.1` (`apps/web/package.json:72`).

**Verdict.** VERIFIED that the type surface ships. **UNVERIFIED** whether these
methods are callable in production today, what they cost, how long snapshots
live, or whether `snapshotContainer` captures memory (a true VM checkpoint,
SPACE's "full snapshot") or only disk. There is no documentation page for them.
Anyone designing around them is designing around an undocumented API.

This is the closest Cloudflare primitive to SPACE's two-tier snapshot model —
`snapshotDirectory` ↔ disk snapshot, `snapshotContainer` ↔ full snapshot,
`containerSnapshot` on start ↔ restore-onto-a-node. INFERRED: the platform is
converging on exactly the design the proposal wants, without needing an inner VM.

### 7.3 Container images as a pre-warm mechanism

VERIFIED, [Lifecycle of a
Container](https://developers.cloudflare.com/containers/platform-details/architecture/):

> "your image is uploaded to Cloudflare's Registry and distributed globally to
> Cloudflare's Network. Cloudflare will pre-schedule instances and **pre-fetch
> images** across the globe to ensure quick start times… **You are only charged for
> actively running instances and not for any unused pre-warmed images.**"

Constraints: image size ≤ instance disk space; 50 GB total image storage per
account; cold start "often in the 1-3 second range, but this is dependent on
image size"; container instances update via a gradual rollout by default
(`[10, 100]` when `max_instances ≥ 2`).

INFERRED: this is Cloudflare's version of SPACE's "warm pool of pods that already
have common templates materialized on disk." It is *not* per-session state — it
is a shared template. Which is exactly the right analogy, and exactly the
distinction the user's paraphrase collapsed (§2.6 row 6).

### 7.4 CRIU and Firecracker snapshots — both closed

- **CRIU:** requires root (criu.org/Security: *"the tools can only work with run
  with root privileges"*) and a kernel built with `CONFIG_CHECKPOINT_RESTORE` and
  a long list of `*_NS` / `*_DIAG` options. Cloudflare Containers "run without
  root privileges" and publish no kernel config. **Not available.** VERIFIED for
  the requirements; INFERRED for the conclusion.
- **Firecracker snapshot/restore:** the entire VMM requires `/dev/kvm` (§3.3),
  so its snapshot facility is unreachable for the same reason the VMM is.
  **Not available.**

This is the precise gap between SPACE and Cloudflare: SPACE's suspend/restore is
a *paused-VM checkpoint*, which requires owning the hypervisor. Cloudflare owns
the hypervisor and is exposing the equivalent as `snapshotContainer`. You cannot
build it yourself inside the guest.

### 7.5 Does the snapshot layer address Ditto's actual bottleneck?

`brain-architecture-research.md` §3.3 argued: *"The real cost of per-session
sandboxes is not the container — it is the **repeated clone + dependency
install** on every cold session, which is CPU, egress, and latency."*

Re-examined against the snapshot primitives:

| Bottleneck | Addressed by container image pre-bake? | By `createBackup`/`restoreBackup`? | By `snapshotDirectory` (when GA)? |
|---|---|---|---|
| Base toolchain (node, pnpm, git, ripgrep) | **Yes** — already in Ditto's `Dockerfile` | n/a | n/a |
| `git clone` of the user's repo | No | **Yes** — `/workspace` archive restores the tree | Yes |
| `pnpm install` for the user's lockfile | No (lockfiles are per-repo) | **Yes** — `node_modules` is in the archive, subject to `useGitignore` | Yes |
| Warm process state (dev server already running) | No | **No** — processes are lost on stop; only files persist | Only if `snapshotContainer` captures memory — **UNVERIFIED** |

INFERRED: **yes, a snapshot layer addresses the real bottleneck** — but Ditto
*already has* the mechanism that does so (`sandbox-backup.ts` +
`persistProjectSandboxBackup`), and the residual gap is warm process state,
which only a true VM checkpoint would close, and which only Cloudflare can
provide. The proposal's inner VM would not help: an inner VM's snapshot still
lives on an ephemeral container disk that is wiped on sleep.

---

## 8. Does the trusted/untrusted split hold?

This is the sharpest architectural question and the answer is **no, not as
stated** — for reasons that have nothing to do with whether the inner VM is
buildable.

### 8.1 The harness must read what the untrusted layer writes

The proposal's shape: trusted container holds the harness, the credentials, and
git; untrusted inner VM executes agent code; both operate on the same workspace,
because the harness's `read`/`write`/`edit`/`grep`/`find`/`ls` tools have to see
the files the code produced.

Pi's own documentation says exactly what that costs. VERIFIED,
`@earendil-works/pi-coding-agent@0.80.10/docs/security.md`, verbatim:

> "Project trust is only an input-loading guard… It does not make untrusted code,
> untrusted prompts, or untrusted model output safe. **Prompt injection from
> repository files, comments, documentation, context files, or build output is
> expected local-agent risk and cannot be reliably prevented by pi.**"

And, on the exact bind-mount topology the proposal uses:

> "**If you bind-mount a host workspace read/write, writes from inside the
> container or VM can still modify host files.** Use read-only mounts or copy files
> into and out of the sandbox when you need stronger protection from unintended
> writes."

The Gondolin example implements precisely that topology. VERIFIED,
`examples/extensions/gondolin/index.ts:1-8, 383-388`:

```ts
// File changes under /workspace write through to the host; other guest
// filesystem changes are isolated to the VM.
const created = await VM.create({
  sessionLabel: `pi ${path.basename(localCwd)}`,
  vfs: { mounts: { [GUEST_WORKSPACE]: new RealFSProvider(localCwd) } },
});
```

INFERRED, and unavoidable: **the inner VM boundary is deliberately porous on the
one channel that carries the injection.** Everything the untrusted layer writes
under `/workspace` lands in the trusted container's filesystem, is read back by
the trusted harness, and is fed to the model.

### 8.2 Worse: repository content executes *in the trusted zone*

This is the finding that breaks the proposal as stated. It was asserted in
`brain-architecture-research.md` §5.5 and has been **re-verified from installed
source on 2026-08-15**.

1. `SettingsManager` defaults project trust to **true**.
   `dist/core/settings-manager.js:136` — constructor default parameter
   `projectTrusted = true`; `:153` — `const projectTrusted = options.projectTrusted ?? true`.
   `SettingsManager.inMemory()` reaches `fromStorage(storage, options)` without
   setting it. VERIFIED.
2. Trust is only *lowered* when `resolveProjectTrust` is supplied.
   `dist/core/resource-loader.js:209-226` — `loadProjectTrustExtensions()` is the
   only caller of `setProjectTrusted(false)`, and `reload(options)` only invokes it
   `if (options?.resolveProjectTrust)`. VERIFIED.
3. `createAgentSession()` with no `resourceLoader` constructs a
   `DefaultResourceLoader` and calls **`await resourceLoader.reload()` with no
   options**. `dist/core/sdk.js:71-74`. VERIFIED.
4. **Ditto passes no `resourceLoader`.** `packages/sandbox-runner/src/run-agent.ts:87-108`
   passes `cwd, agentDir, model, modelRuntime, thinkingLevel, sessionManager,
   settingsManager, tools, customTools` — and nothing else. `options.cwd` is the
   session worktree, i.e. repository content. VERIFIED.

And Pi's `docs/extensions.md:111` states the consequence, verbatim:

> "**Security:** Extensions run with your full system permissions and can execute
> arbitrary code. Only install from sources you trust."

**Therefore, INFERRED with high confidence:** a repository containing
`.pi/extensions/*.ts` (or `.pi/settings.json`, `.pi/skills`, `.pi/prompts`,
`.pi/SYSTEM.md`, `.pi/APPEND_SYSTEM.md`) gets those files loaded and executed at
session-creation time, **inside the harness process**, before the first token is
generated, with no prompt, no tool call, and no model involvement.

Today that is contained by the sandbox VM — bad, but the harness is already in
the untrusted zone, so the extension gains nothing it did not already have.

**Under the proposal it is fatal.** The proposal's whole premise is that the
harness process lives in the *trusted* container holding the model credential,
the git credential, and git write access. Pointing that process at repository
content with default resource discovery hands zero-click arbitrary code execution
to any repository, **in the trusted zone**, bypassing the inner VM entirely. The
inner VM never sees the code; the harness executes it directly.

Pi ships the mitigation: `DefaultResourceLoaderOptions` exposes `noExtensions`,
`noSkills`, `noPromptTemplates`, `noThemes`, `noContextFiles`
(`dist/core/resource-loader.d.ts`), and Ditto already uses them correctly in its
git-metadata runner (`docs/architecture/security.md`: "no disk resource
discovery"). VERIFIED.

INFERRED, and this is the point: **the proposal's trusted/untrusted split is
enforced by a Pi configuration flag, not by the VM boundary.** With the flags,
you get most of the property without the VM. Without the flags, the VM does not
save you.

### 8.3 Can the harness be pointed at a remote executor? Yes — three ways, re-verified

All three claims from `brain-architecture-research.md` §5.3 were re-checked
against installed source on 2026-08-15 and hold:

1. **`ExecutionEnv`** — `@earendil-works/pi-agent-core@0.80.10/dist/harness/types.d.ts:228`:
   `export interface ExecutionEnv extends FileSystem, Shell {}`. `AgentHarness`
   holds `readonly env: ExecutionEnv`. The package's root `index.js` imports no
   node builtins; the only `node:*` importer under `dist/` is
   `harness/env/nodejs.js`, behind the separate `"./node"` export. VERIFIED.
2. **`streamProxy`** — `dist/proxy.d.ts`, header comment verbatim: *"Proxy stream
   function for apps that route LLM calls through a server. The server manages auth
   and proxies requests to LLM providers."* VERIFIED.
3. **Per-tool `operations` overrides + the Gondolin example** — VERIFIED, read in
   full (531 lines) and summarised below.

**The Gondolin example, in full.** `examples/extensions/gondolin/index.ts`:

- Starts one `VM` per Pi session on `session_start`, closes it on
  `session_shutdown` (`:410-425`). The host cwd is mounted at `/workspace` via
  `RealFSProvider(localCwd)` with write-through (`:383-388`).
- Path translation: `toGuestPath()` rewrites host paths under `localCwd` into
  `/workspace/...`, and leaves paths outside it as absolute guest paths
  (`:68-82`). Note: it does **not** deny access outside the workspace; it maps
  those paths into the guest's own filesystem.
- Overrides all seven built-in tools by calling `pi.registerTool({...localTool,
  execute})`, where `execute` rebuilds the tool with `{operations: …}` backed by
  `vm.fs.*` (`:443-515`). `read`/`write`/`edit`/`ls`/`find` use
  `ReadOperations`/`WriteOperations`/`EditOperations`/`LsOperations`/`FindOperations`;
  `grep` is reimplemented wholesale as `executeGondolinGrep` walking the guest
  filesystem (`:239-313`).
- `bash` routes through `vm.exec([shellPath, "-lc", command], {cwd, env, signal,
  stdout:"pipe", stderr:"pipe"})` and streams chunks back via `onData`
  (`:324-363`).
- User `!` commands are routed the same way via `pi.on("user_bash", …)` (`:517-520`).
- `before_agent_start` rewrites the system prompt's cwd line to say
  `/workspace (Gondolin VM; host workspace mounted from …)` (`:522-530`).

**This is exactly the pattern the proposal describes**, shipped, by the harness
vendor, as a working example. INFERRED, and it is the crux: it is *not* a
security boundary between the harness and the repository. It routes tool
*execution* into the VM while keeping the harness, its auth, its extensions, its
resource loading, and its session file on the host — and it write-throughs the
workspace. Pi's own containerization doc frames it accordingly:
*"Local micro-VM isolation while **keeping auth on host**"* (`docs/containerization.md:13`).
Its purpose is to stop a runaway `rm -rf` from touching the host filesystem
outside the workspace. It is not designed to defend the harness against the
repository, and it does not.

`docs/containerization.md` also names the credential-broker pattern as the
alternative, verbatim (`:109-111`):

> "OpenShell providers can keep raw model API keys outside the sandbox. When
> inference routing is configured, **code inside the sandbox can call
> `https://inference.local`, and the gateway injects the configured provider
> credentials upstream.**"

That is Cloudflare's `outboundByHost`, described by a different vendor, and Pi
documents it as a first-class option.

Finally, a shipped example the prior doc did not cover:
`examples/extensions/sandbox/index.ts` overrides only the `bash` tool with
`@anthropic-ai/sandbox-runtime` (`sandbox-exec` on macOS, **bubblewrap on
Linux**), enforcing `network.allowedDomains`/`deniedDomains` and
`filesystem.denyRead`/`allowWrite`/`denyWrite` — with defaults that deny reading
`~/.ssh`, `~/.aws`, `~/.gnupg` and deny writing `.env`, `*.pem`, `*.key`
(`:55-77`). VERIFIED. This is the OS-level, hypervisor-free version of the same
idea, and it is the one whose requirements (§3.5) are compatible with a
Cloudflare Container.

### 8.4 Git in the trusted zone: what is actually being protected?

The proposal has the trusted container perform git actions on a diff authored by
untrusted code.

INFERRED, from the verified facts above:

- **The credential is protected.** If the GitHub token lives only in the trusted
  container (or better, only in the Worker via `outboundByHost`), untrusted code
  cannot read it or mint pushes to arbitrary repos. That is a real, meaningful
  win.
- **The content is not protected, and cannot be.** The commit contains whatever
  the untrusted layer wrote. Git in the trusted zone signs off on untrusted
  bytes. The trust boundary controls *who may push*, not *what is pushed*.
- Ditto's existing controls are already the right ones for the second problem
  and do not depend on the split: `agent-git-handler.ts` accepts only
  `action ∈ {push, openPullRequest, status}`, the JWT is bound to
  `{projectId, sessionId, userId, sandboxId}` with a 600 s TTL, and **a PR still
  needs a human to merge** (`brain-architecture-research.md` §6.2 row 3).

So the honest statement of the proposal's git property is: *"the credential does
not enter the zone where untrusted code runs."* Which is true — and is achieved
more completely, and more cheaply, by not putting the credential in any container
at all (§3.6).

---

## 9. Synthesis

### 9.1 Per-layer verdict

| Layer | Proposal | What the platform supports | Verdict | Deciding source |
|---|---|---|---|---|
| **1. Control plane** | Stateless Worker + tRPC; tracks sandbox state; issues short-lived tokens | Already built. Worker is stateless per-request; D1 is the shared DB; `agent-git-jwt.ts` mints HS256 tokens with a 600 s TTL | **Buildable as stated — because it already is.** The only real delta vs. SPACE is reconciler-vs-imperative, which is a durability property, not a security one | `apps/web/src/server.ts`, `alchemy.run.ts:37-63`, `agent-git-jwt.ts:5,84-91`; SPACE §"Control Plane" |
| **2. Node-level supervisor (Workflows)** | Workflow starts/pauses/resumes/stops sandboxes, owns snapshots, credentials, and network | The `Container` class **is** a Durable Object and already owns every one of those: `start`/`stop`/`destroy`, `sleepAfter` + `onActivityExpired`, `onStart`/`onStop`/`onError`, `schedule`+`alarm`, DO SQLite, `allowedHosts`/`deniedHosts`, `static outbound`. Workflows hibernate and lose all in-memory state, so they cannot hold a container handle across a step | **Not buildable as stated — because it is a re-implementation.** Workflows remain the right tool for *run durability*, a different problem | `@cloudflare/containers@0.3.7/dist/lib/container.d.ts:49,120-236,260`; [Rules of Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/) |
| **3a. Raw Container instead of Sandbox SDK** | Drop `@cloudflare/sandbox` for a bare `Container` subclass | `Sandbox extends Container`, so every egress/credential-broker API is already inherited. Dropping the SDK costs ~119 call sites plus hand-built file API, sessions, process registry, preview-URL proxy, and backups | **Buildable, but buys nothing on the security axis** | `sandbox-BhIQBik-.d.ts:2688`; `container.d.ts:50-152`; call-site count from `apps/web/src` |
| **3b. Inner VM per agent session** | A microVM inside the container; user reaches the VM, not the container | Firecracker/Kata/QEMU-KVM all need `/dev/kvm`. Containers "run without root privileges"; "you cannot use privileged containers or features requiring root"; no device/capability knob exists in Wrangler config, `ContainerStartupOptions`, or `ContainerExecOptions` | **Not buildable** | [firecracker getting-started](https://raw.githubusercontent.com/firecracker-microvm/firecracker/main/docs/getting-started.md); [DinD guide](https://developers.cloudflare.com/sandbox/guides/docker-in-docker/); [Wrangler config](https://developers.cloudflare.com/workers/wrangler/configuration/#containers) |
| **3c. Inner jail without a hypervisor** | (implied fallback) gVisor / bwrap / nsjail / seccomp / Landlock | Unprivileged user namespaces, seccomp-bpf, bwrap, nsjail, and Landlock are all plausible. But `runsc --rootless` has **no Netstack** and no save/restore, and Containers **do not support iptables** — so the inner jail cannot have a different egress policy than the outer container, which is the one property that mattered | **Buildable differently, with the key property missing** | [gVisor Rootless](https://gvisor.dev/docs/user_guide/rootless/); [Containers FAQ](https://developers.cloudflare.com/containers/faq/) |
| **3d. Trusted harness + untrusted session** | Harness in the trusted container, git in the trusted container | The harness must read repo content, and Pi loads and **executes** `.pi/extensions` from `cwd` by default (`projectTrusted` defaults `true`; Ditto passes no `resourceLoader`). That is zero-click RCE **in the trusted zone**, bypassing the inner boundary entirely | **Not buildable as stated.** Becomes coherent only with `noExtensions`/`noSkills`/`noContextFiles` — at which point the VM is no longer what is providing the property | `settings-manager.js:136,153`; `resource-loader.js:209-226`; `sdk.js:71-74`; `run-agent.ts:87-108`; `docs/extensions.md:111` |
| **Snapshots** | Snapshots for fast create and restore | `createBackup`/`restoreBackup` exist (squashfs→R2, CoW, **ephemeral FUSE mount**). Container-level `snapshotDirectory`/`snapshotContainer` ship in the runtime types but are documented as "coming soon". CRIU needs root; Firecracker snapshots need KVM | **Buildable differently, and mostly already built.** Warm-create and state-restore are two mechanisms, not one | [Backups API](https://developers.cloudflare.com/sandbox/api/backups/); `workers-types@4.20260702.1:4007-4047`; [Containers FAQ](https://developers.cloudflare.com/containers/faq/) |

### 9.2 Where the proposal is right, even where the mechanism is wrong

Four instincts in the proposal are correct and are worth separating from the
mechanism that fails:

1. **Credentials should not live where untrusted code runs.** Correct, and it is
   the same conclusion Cloudflare, Perplexity, and Pi's own docs all reach
   independently. The proposal's error is *how*: it moves the credential one
   boundary away instead of removing it from the container entirely.
2. **Egress should be forced through a policy point.** Correct, and directly
   supported: `enableInternet:false` + `allowedHosts`/`deniedHosts` + `static
   outboundByHost`, all on the `Container` base class Ditto already inherits.
   This is SPACE's network gateway, provided by the platform.
3. **The lifecycle deserves an explicit state machine.** Correct. SPACE says
   *"It models the full sandbox lifecycle as an explicit state machine."* Ditto's
   lifecycle is scattered across `sandbox-bootstrap.ts`, a D1 `previewLockToken`
   lease, a `/tmp` directory lock, and a backup generation fence
   (`brain-architecture-research.md` §8.1 row 4). Consolidating that is a real
   improvement — it just belongs in the Container DO, not in a Workflow.
4. **Per-session isolation is the right unit.** Correct, and Cloudflare says so
   directly: *"For complete isolation, use separate sandboxes per user"* and
   *"Isolate end users with separate sandboxes, not sessions inside one sandbox."*
   The proposal reaches for an inner VM to get this; a distinct **sandbox ID per
   session** gets the same property using the outer VM boundary that already
   exists. Blocked today only by `max_instances: 1` (`alchemy.run.ts:23`), where
   the platform default is 20.

### 9.3 Versus the credential-broker approach from `brain-architecture-research.md` §4.4 / §8

| Threat / property | Layer-3 proposal (if it were buildable) | Credential broker + per-session sandbox IDs |
|---|---|---|
| Operator `OPENCODE_API_KEY` reachable by agent code | Mitigated — one boundary away, still in the container | **Removed** — never enters any container |
| Account provider credential | Mitigated | **Removed** (API-key providers; OAuth needs per-provider work) |
| Git callback JWT | Mitigated | **Removed** via `outboundByHost` + `ctx.containerId` |
| `/proc/<pid>/environ` scrub bypass (`brain` §6.3) | Moot for the inner VM; **still live for the trusted harness** | Moot for platform credentials |
| Egress allowlist / deny-by-default | **Not achievable** — no iptables, no Netstack under rootless runsc | **Yes** — `enableInternet:false` + `allowedHosts` |
| Cross-session filesystem access | Yes, if the inner VM is per session | **Yes**, via per-session sandbox IDs |
| Repo-supplied `.pi/extensions` RCE | **Made worse** — moves into the trusted zone | Unchanged — needs `noExtensions`/`noSkills`/`noContextFiles` either way |
| Buildable on Cloudflare today | **No** (§3) | **Yes** — `Container` API is installed at `0.3.7` |
| Implementation cost | New isolation layer + tool routing + lifecycle + ~119 rewritten call sites | A Sandbox subclass, an egress policy, per-session ID plumbing |

INFERRED: the credential broker closes **strictly more** of the enumerated
threats, at a fraction of the cost, using APIs already resolved in Ditto's
`node_modules`. The proposal's only unique contribution — an isolation boundary
*between the harness and the code it supervises* — is the one thing the platform
cannot provide, and §8.2 shows it would not survive contact with repository
content even if it could.

---

## 10. Open questions

Each needs a spike or a decision. None is answered by this document.

1. **Does workerd's container runtime apply a seccomp filter?** This decides
   whether `unshare -Ur`, `bwrap`, `nsjail`, and `runsc --rootless` work at all
   inside a Cloudflare Container. Cheap experiment: `unshare -Ur true`,
   `bwrap --dev-bind / / true`, `runsc --rootless do true` in the deployed image.
   UNVERIFIED.
2. **Is Landlock enabled in Cloudflare's kernel?** `landlock(7)` requires the
   kernel to support it **and** for it to be enabled at boot. Check via
   `landlock_create_ruleset(NULL, 0, LANDLOCK_CREATE_RULESET_VERSION)`. If yes,
   an unprivileged, in-process, irreversible filesystem+TCP restriction on the
   harness's own tool children becomes available with no VM.
3. **Are `container.snapshotDirectory` / `snapshotContainer` callable today?**
   They ship in `@cloudflare/workers-types@4.20260702.1` and `@5.20260811.1` but
   the Containers docs say "Snapshots are coming soon." Does `snapshotContainer`
   capture memory (a true checkpoint) or only disk? What is the retention and
   cost? Undocumented.
4. **What uid does Ditto's runner execute as inside the container?** Decides
   whether `ContainerExecOptions.user` separation is even meaningful, and how the
   `/proc/<pid>/environ` bypass (`brain` §6.3) behaves. `Dockerfile:3` uses
   `--chown=0:0` but the platform runs "without root privileges." UNVERIFIED.
5. **Does uid separation break `createBackup`?** Cloudflare documents that
   `mksquashfs` fails on "directories owned by a different user." If Ditto adopts
   a second uid for agent tool processes, does `sandbox-backup.ts` still work, and
   does `chmod -R a+rX` defeat the point of the separation?
6. **Does Pi's undici stack accept the Cloudflare interception CA?** Carried
   forward unchanged from `brain-architecture-research.md` §9.1. Still the single
   experiment that decides whether the credential-broker path is real.
7. **QEMU-TCG performance.** No primary source quantifies the slowdown. If
   anyone wants to argue for a software-emulated inner VM, this needs a measured
   number on a `standard-4` instance, not a folk figure.
8. **Which hypervisor does Cloudflare use for the per-instance VM?** Unnamed in
   all Containers and Sandbox documentation. Does not change any conclusion here,
   but it is the one fact that would let anyone compare Cloudflare's isolation
   directly to SPACE's.
9. **Which VMM does SPACE use?** Also unnamed. Do not assume Firecracker.
10. **Is `step.sleep` billed as a step?** The docs address only the max-steps
    limit, not billing. Changes the §5.4 arithmetic by roughly 2×.
11. **`max_instances: 1`.** Per-session sandbox IDs — the cheap way to get the
    isolation the inner VM was proposed for — are currently *impossible*:
    `alchemy.run.ts:23` caps the deployment at one running container. The platform
    default is 20. Carried forward from `brain` §9.5.
12. **DNS exfiltration under `enableInternet:false`.** Unchanged from `brain`
    §9.7: DNS remains available and Cloudflare does not document inspecting it.
    A shared limitation of every design considered, including SPACE's, whose
    article does not mention DNS either.

---

## 11. Sources

All fetched **2026-08-15** unless noted.

**Perplexity (first-party engineering write-up)**
- https://research.perplexity.ai/articles/making-space-secure-and-efficient-runtimes-for-long-running-agents (article dated 2026-07-15)
- https://research.perplexity.ai/articles/rethinking-search-as-code-generation (checked; defers sandbox detail to a future article)
- https://research.perplexity.ai/articles/designing-refining-and-maintaining-agent-skills-at-perplexity (checked; not about runtimes)

**Cloudflare — Containers**
- https://developers.cloudflare.com/containers/llms.txt
- https://developers.cloudflare.com/containers/
- https://developers.cloudflare.com/containers/platform-details/architecture/ (updated 2026-08-13)
- https://developers.cloudflare.com/containers/platform-details/limits/ (updated 2026-07-03)
- https://developers.cloudflare.com/containers/platform-details/image-management/ (updated 2026-07-01)
- https://developers.cloudflare.com/containers/platform-details/environment-variables/
- https://developers.cloudflare.com/containers/platform-details/outbound-traffic/
- https://developers.cloudflare.com/containers/platform-details/workers-connections/
- https://developers.cloudflare.com/containers/container-class/
- https://developers.cloudflare.com/containers/execute-commands/
- https://developers.cloudflare.com/containers/faq/ (updated 2026-08-13)
- https://developers.cloudflare.com/containers/local-dev/
- https://developers.cloudflare.com/containers/ssh/ (updated 2026-05-29)
- https://developers.cloudflare.com/containers/examples/r2-fuse-mount/
- https://developers.cloudflare.com/containers/examples/status-hooks/

**Cloudflare — Durable Objects, Workers, Wrangler**
- https://developers.cloudflare.com/durable-objects/api/container/
- https://developers.cloudflare.com/workers/configuration/compatibility-flags/ (`containers_pid_namespace`)
- https://developers.cloudflare.com/workers/wrangler/configuration/#containers

**Cloudflare — Sandbox SDK**
- https://developers.cloudflare.com/sandbox/llms.txt
- https://developers.cloudflare.com/sandbox/concepts/security/ (updated 2026-08-06)
- https://developers.cloudflare.com/sandbox/api/backups/ (updated 2026-04-24)
- https://developers.cloudflare.com/sandbox/guides/docker-in-docker/ (updated 2026-04-21)
- https://developers.cloudflare.com/sandbox/guides/outbound-traffic/

**Cloudflare — Workflows**
- https://developers.cloudflare.com/workflows/reference/limits/
- https://developers.cloudflare.com/workflows/reference/pricing/
- https://developers.cloudflare.com/workflows/build/rules-of-workflows/
- https://developers.cloudflare.com/workflows/build/events-and-parameters/
- https://developers.cloudflare.com/workflows/build/workers-api/

**Cloudflare — D1** (established 2026-08-14, reused)
- https://developers.cloudflare.com/d1/platform/limits/

**gVisor**
- https://gvisor.dev/docs/architecture_guide/platforms/
- https://gvisor.dev/docs/architecture_guide/security/
- https://gvisor.dev/docs/user_guide/rootless/
- https://gvisor.dev/docs/user_guide/install/
- https://gvisor.dev/docs/user_guide/faq/
- https://gvisor.dev/docs/user_guide/checkpoint_restore/

**Firecracker / Kata / QEMU / CRIU**
- https://raw.githubusercontent.com/firecracker-microvm/firecracker/main/docs/getting-started.md
- https://raw.githubusercontent.com/firecracker-microvm/firecracker/main/docs/design.md
- https://raw.githubusercontent.com/firecracker-microvm/firecracker/main/docs/snapshotting/snapshot-support.md
- https://raw.githubusercontent.com/kata-containers/kata-containers/main/docs/hypervisors.md
- https://raw.githubusercontent.com/kata-containers/kata-containers/main/docs/design/architecture/README.md
- https://www.qemu.org/docs/master/system/introduction.html
- https://criu.org/Security
- https://criu.org/Linux_kernel
- https://criu.org/Installation

**Linux man-pages and kernel docs**
- https://man7.org/linux/man-pages/man7/user_namespaces.7.html
- https://man7.org/linux/man-pages/man2/unshare.2.html
- https://man7.org/linux/man-pages/man2/seccomp.2.html
- https://man7.org/linux/man-pages/man7/landlock.7.html
- https://man7.org/linux/man-pages/man5/proc_pid_environ.5.html (fetched 2026-08-14)

**Sandboxing tools**
- https://raw.githubusercontent.com/containers/bubblewrap/main/README.md
- https://raw.githubusercontent.com/google/nsjail/master/README.md
- https://docs.wasmtime.dev/security.html

**Installed package source, read from disk**
- `@cloudflare/containers@0.3.7` — `dist/lib/container.d.ts` (full read)
- `@cloudflare/sandbox@0.12.3` — `dist/sandbox-BhIQBik-.d.ts:2688`, `dist/index.d.ts:240,303`
- `@cloudflare/workers-types@4.20260702.1` — `experimental/index.d.ts:3975-4052`
- `@cloudflare/workers-types@5.20260811.1` — `experimental/index.d.ts:3975-4088`
- `@earendil-works/pi-coding-agent@0.80.10` — `dist/core/sdk.js:62-74`,
  `dist/core/settings-manager.js:127-163`, `dist/core/resource-loader.js:200-235`,
  `docs/security.md`, `docs/containerization.md`, `docs/extensions.md`,
  `examples/extensions/gondolin/index.ts` (full read, 531 lines),
  `examples/extensions/gondolin/package.json`,
  `examples/extensions/sandbox/index.ts` (full read, 321 lines),
  `examples/extensions/sandbox/package.json`
- `@earendil-works/pi-agent-core@0.80.10` — `dist/harness/types.d.ts:228`,
  `dist/proxy.d.ts`, `dist/harness/agent-harness.d.ts`

**Ditto source at `brain@57a29d5`**
- `alchemy.run.ts`, `Dockerfile`, `apps/web/package.json`,
  `packages/sandbox-runner/package.json`
- `apps/web/src/server.ts`
- `apps/web/src/lib/agent-git-jwt.ts` (full read), `agent-run.ts:80-140`,
  `agent-run-service.ts`, `agent-git-handler.ts`, `sandbox-bootstrap.ts`,
  `sandbox-backup.ts`
- `packages/sandbox-runner/src/run-agent.ts:44-110`, `runner-model.ts`
- `docs/architecture/overview.md`, `security.md`, `agent-harness.md`
- `docs/research/brain-architecture-research.md` (companion, verified 2026-08-14)
