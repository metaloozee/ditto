# 035 - Expose Flue Project-Coder HTTP Route

## Summary

- Priority: P1
- Effort: S
- Risk: Low
- Category: correctness / integration
- PRD phase: Phase 2 completion gate
- Depends on: 030, 031, 032, 033, 034
- Planned at: `c7cdcba`
- Status: TODO

Phase 2 routes read-only runs through `FlueRunBridge`, and the bridge dispatches to Flue with `POST /agents/project-coder/:id`. The installed Flue runtime docs say that direct HTTP agent routes are only exposed when the agent module exports a `route` handler. The current project-coder agent only default-exports `createAgent(...)`, so the build can pass while runtime dispatch still fails with a non-2xx route response.

## Evidence

- `.flue/agents/project-coder.ts:2` imports `createAgent` and `defineTool`, but not `AgentRouteHandler`.
- `.flue/agents/project-coder.ts:85` default-exports `createAgent(...)`; there is no `export const route`.
- `src/lib/flue-dispatch-adapter.ts` builds `POST /agents/:name/:id` and `GET /agents/:name/:id?offset=...&live=long-poll`.
- `node_modules/@flue/runtime/docs/guide/building-agents.md` says an agent with a `route` export accepts HTTP messages at `POST /agents/<name>/<id>`.
- `node_modules/@flue/runtime/docs/api/routing-api.md` documents `POST /agents/:name/:id` as the direct agent invocation route.

## Goal

Make the read-only Flue project-coder agent actually expose the direct HTTP route that Phase 2 dispatch uses, and add a small regression test so this cannot silently disappear again.

## Non-Goals

- Do not add authentication middleware to the agent route in this plan. The Flue worker is private behind the `FLUE_WORKER` service binding; app-level auth belongs at the website/tRPC layer.
- Do not add mutating tools.
- Do not change the dispatch adapter path shape.
- Do not commit generated `dist/` output.

## Implementation Steps

1. Update `.flue/agents/project-coder.ts`.
   - Import `type AgentRouteHandler` from `@flue/runtime`.
   - Add this export near the top of the module:

   ```ts
   export const route: AgentRouteHandler = async (_c, next) => next();
   ```

   Keep the handler intentionally pass-through. The point is to expose the built-in Flue direct agent route while preserving the current service-binding-only topology.

2. Add a focused route contract test.
   - Add `src/lib/flue-agent-route-contract.test.ts`.
   - Dynamically import `../../.flue/agents/project-coder`.
   - Assert `typeof module.route === "function"`.
   - Assert `module.default` exists. Avoid deep assertions on Flue's private agent shape unless the public runtime types expose a stable marker.

3. Run the Flue build and verify the generated worker still compiles.
   - Use `pnpm flue:build`.
   - The known generated-wrangler Durable Object migration warning is acceptable.
   - Do not commit generated artifacts.

4. If practical, add one assertion to the existing dispatch adapter test or a new smoke-style test that documents the route dependency in comments. Do not try to boot a full Flue worker inside Vitest unless this is already easy with local helpers.

## Tests

Run:

```sh
pnpm test -- src/lib/flue-agent-route-contract.test.ts
pnpm flue:build
pnpm exec tsc --noEmit --pretty false
pnpm lint
pnpm test
git diff --check
```

## STOP Conditions

- If the installed `@flue/runtime` no longer exports `AgentRouteHandler`, stop and inspect the installed Flue docs/types before guessing the new route API.
- If `pnpm flue:build` fails after adding the route export, stop and report the exact compiler error. Do not patch the dispatch adapter to use a different route without first proving that route exists in the installed Flue runtime.

## Acceptance Criteria

- `.flue/agents/project-coder.ts` exports `route`.
- A regression test fails if the export is removed.
- `pnpm flue:build`, typecheck, lint, test, and whitespace checks pass.
- No source behavior changes except exposing the existing read-only agent over Flue's direct HTTP route.
