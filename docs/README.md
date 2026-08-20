# Ditto documentation

Use this index to find the document that owns a claim. Current architecture, proposed work, research, and local planning have different authority.

## Current product and system

| Document | Purpose |
|---|---|
| [`PRODUCT.md`](../PRODUCT.md) | Current product, users, direction, and design principles |
| [`CONTEXT.md`](../CONTEXT.md) | Canonical domain terms and relationships |
| [System architecture](architecture/overview.md) | System units, primary flows, state ownership, and current limits |
| [Frontend architecture](architecture/frontend.md) | Routes, browser state, chat, settings, and UI composition |
| [Server and data architecture](architecture/server-and-data.md) | Worker entry points, tRPC, domain services, schema, and lifecycles |
| [Agent harness architecture](architecture/agent-harness.md) | Agent execution, controls, worktrees, Git export, preview, and backups |
| [Security boundaries](architecture/security.md) | Current trust model, credential paths, redaction, Git policy, and known gaps |
| [Repository map](architecture/repository-map.md) | Source ownership and change routing |

Current source code, tests, and `apps/web/src/db/schema.ts` define implemented behavior. When a current architecture page disagrees with code, update the page in the same change.

## Decisions, specifications, and research

| Location | Authority |
|---|---|
| `docs/adr/` | Decisions that remain in force. The directory stays empty until a decision meets the ADR threshold. |
| `docs/specs/` | Proposed or required behavior. Read the status block before treating a spec as implemented. |
| `docs/research/` | Historical evidence and platform investigation. Research does not define current behavior. |

The [platform credential broker spec](specs/platform-credential-broker.md) is gated and needs revision. Its implementation audit separates completed supporting work from the security guarantees that remain absent.

## Reading paths

For a chat or agent-runtime change, read the frontend, server, harness, and security pages.

For project lifecycle, persistence, or preview work, read the server, harness, and security pages.

For Git or GitHub work, read the Git export section in the harness page and the Git sections in the security page.

For a schema change, read the server page, edit `apps/web/src/db/schema.ts`, and generate the matching migration.

The maintainer's optional planning and review process lives in [Agent-assisted development](development/agent-workflow.md). Git ignores `.scratch/` and `plans/`; neither directory is project documentation.
