# Ditto documentation

## Sources of truth

| Document | Purpose |
|---|---|
| [`PRODUCT.md`](../PRODUCT.md) | Product intent and design principles |
| [`CONTEXT.md`](../CONTEXT.md) | Domain terms and relationships |
| [Pi Durable workspace-session runtime](specs/pi-durable-session-runtime.md) | Authoritative runtime target, module contracts, local feasibility gates, acceptance tests, and unresolved decisions |
| [Pi Durable architecture research](research/pi-durable-cloudflare-architecture.md) | Evidence behind the selected candidate, not implementation validation |
| [Agent-assisted development](development/agent-workflow.md) | Optional planning and review workflow |

Source code, tests, and `apps/web/src/db/schema.ts` define current behavior. The Pi Durable target is selected but not implemented or validated. Its open decisions and feasibility gates still apply.

New runtime plans derive from the specification, not the previous Node-container design. `plans/` has been cleared for the new track. Add implementation-facing architecture documentation as the replacement lands; do not describe target behavior as shipped.

## Historical work

The obsolete plans, reviews, evidence, architecture summaries, specifications, and research are preserved in Git at commit `52c9cef3ca2c471c69dfe4a0bdb3f507a8f45e13`, before cleanup. After that commit is pushed, the [historical docs](https://github.com/metaloozee/ditto/tree/52c9cef3ca2c471c69dfe4a0bdb3f507a8f45e13/docs) and [plan/evidence index](https://github.com/metaloozee/ditto/blob/52c9cef3ca2c471c69dfe4a0bdb3f507a8f45e13/plans/README.md) are available on GitHub. Until then, inspect them locally:

```bash
git show 52c9cef:plans/README.md
git show 52c9cef:docs/specs/trusted-session-runtime.md
```

Historical acceptance records apply only to their reviewed implementation. This documentation cleanup does not remove source, reset data, deploy infrastructure, or resolve the new target's open decisions.
