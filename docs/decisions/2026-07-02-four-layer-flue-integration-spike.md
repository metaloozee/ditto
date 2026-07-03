# Four-Layer Flue Integration Spike

## Decision Table

| Question | Decision | Evidence | Follow-up plan |
|---|---|---|---|
| Same Worker or split Worker? | Split Worker. `website` remains the public TanStack Start Worker; `flueWorker` is a private Worker behind the `FLUE_WORKER` service binding. | `npx flue docs read guide/targets/cloudflare` says Flue owns generated Worker routes and Durable Object bindings; `npx flue build --target cloudflare` generated a separate Cloudflare artifact under `dist/ditto_plan_025`. | 026 |
| How is Flue build invoked by Alchemy without dashboard drift? | Alchemy declares a sibling `Worker` with `entrypoint: "./dist/ditto_plan_025/index.js"`; the build step remains `npx flue build --target cloudflare` before Alchemy deploy/dev. | `npx flue docs read cli/build` says Cloudflare output writes Workers-compatible application output to `dist`; `pnpm exec tsc --noEmit --pretty false` accepted the Alchemy `Worker` resource and bindings. | 026 |
| Which Flue DO classes and migrations are required? | Initial Flue worker migration needs `FlueProjectCoderAgent` and `FlueRegistry` as SQLite classes. | `npx flue build --target cloudflare` warning printed `new_sqlite_classes: ["FlueProjectCoderAgent", "FlueRegistry"]`. | 026 |
| How does a product session select a Flue session? | Use server-owned dispatch to the project-coder agent instance and carry the product session ID in the dispatch input. The installed public agent API proves named sessions exist on `harness.session(name)`, but public `dispatch(...)` only accepts `{ id, input }`, so the app-owned Flue handler must open `harness.session(sessionId)` in Phase 2. | `npx flue docs read api/agent-api` documents `dispatch(...)` and `harness.session(name?: string)`. | 027 |
| How is the project sandbox ID passed to Flue? | The spike agent treats the agent instance id as `projectId:sandboxId` and passes only `sandboxId` to `getSandbox(env.Sandbox, sandboxId)`. Product session and run IDs never become the sandbox ID. | `.flue/agents/project-coder.ts` compiles and `npx flue build --target cloudflare` exits 0. | 027 |
| First model/provider for the spike | Anthropic model string, supplied by Flue runtime/provider configuration later; only binding names may be referenced in app infrastructure. | `.flue/agents/project-coder.ts` uses `anthropic/claude-sonnet-4-6`; no provider secret values are committed. | 027 |

## Notes

Plans 021-024 are not the path forward for future runner work. They target the superseded Pi runner architecture, while `docs/four-layer-flue-workflow-rewrite-prd.md` makes Flue the future agent orchestration layer.

## Installed Versions

- `@flue/runtime`: `1.0.0-beta.1`
- `@flue/cli`: `1.0.0-beta.1`
- `agents`: `^0.14.5` in `package.json`; installed by `pnpm add 'agents@^0.14.2'`
- `hono`: `^4.12.27`

## Flue Docs Used

- `guide/targets/cloudflare`
- `ecosystem/sandboxes/cloudflare`
- `guide/project-layout`
- `api/agent-api`
- `guide/routing`
- `cli/build`

## Flue Build Result

`npx flue build --target cloudflare` exited 0. The build output reported:

- source: `.flue`
- agent: `project-coder`
- generated Cloudflare worker output: `dist/ditto_plan_025/index.js`
- generated wrangler input: `.flue-vite.wrangler.jsonc`
- generated Durable Object bindings: `FLUE_PROJECT_CODER_AGENT` -> `FlueProjectCoderAgent`, `FLUE_REGISTRY` -> `FlueRegistry`
- required initial SQLite migration classes: `FlueProjectCoderAgent`, `FlueRegistry`
- required compatibility flag: `nodejs_compat`

The CLI still prints a migration warning because `.flue-vite.wrangler.jsonc` is generated before Alchemy resources are applied. In Alchemy, the proof declares `DurableObjectNamespace("flue-project-coder-agent", { className: "FlueProjectCoderAgent", sqlite: true })` and `DurableObjectNamespace("flue-registry", { className: "FlueRegistry", sqlite: true })`, then binds them to the private `flueWorker` under the generated names.

## Topology

The selected topology is split Worker:

- `website` is the only public Worker and keeps TanStack Start, Better Auth, tRPC, D1 metadata, R2 backup binding, project/session/run rows, and browser routes.
- `flueWorker` is a sibling Worker declared by Alchemy with no `url: true`, so it is not intentionally exposed as a public unauthenticated Flue surface.
- `website` receives `FLUE_WORKER: flueWorker` as a service binding for future server-owned dispatch.
- `flueWorker` receives the existing project `Sandbox` namespace plus Flue's generated Durable Object namespaces.
- The project coordinator is a separate application-owned Durable Object namespace bound into `website` as `ProjectCoordinator`.

## Phase 1 Build Path Stabilization

- The `pnpm flue:build` script exists and is used by `dev`, `build`, and `deploy` before Alchemy or Vite reads the generated Flue Worker entrypoint.
- `.flue-vite/` and `.flue-vite.wrangler.jsonc` are generated Flue build intermediates and are ignored.
- `flueWorker` remains private with no `url: true`; the public `website` Worker reaches it through the `FLUE_WORKER` service binding.
- Alchemy computes the generated Flue Worker entrypoint from the current checkout root basename, matching Flue's generated `dist/<checkout_basename_with_underscores>/index.js` path instead of committing a root `wrangler.jsonc`.
- The Flue CLI warning about generated Wrangler migrations remains expected because Alchemy owns the deployable resource declaration.

## Session And Sandbox Mapping

The safe mapping for the spike is:

- Flue agent instance ID: `projectId:sandboxId`
- product session ID: carried in the server-owned dispatch payload and opened as a named Flue session in a later app-owned Flue route
- product run ID: carried in the dispatch payload
- Cloudflare Sandbox ID: only the stable project `sandboxId`

This avoids using a product session ID or run ID as a sandbox ID. The installed docs prove named Flue sessions via `harness.session(name?: string)`, while the public `dispatch(...)` API only accepts `{ agent, id, input }`; Phase 2 must add the application-owned route that opens the named session before prompting.

## Coordinator Proof

This plan proves the minimal coordinator API:

- `POST /admit` with `{ projectId, runId, sessionId, userId, mode }`
- `POST /terminal` with `{ projectId, runId, status }`
- `GET /status`

The proof uses Durable Object storage `get/put` for the spike. Phase 1 should move coordination state to explicit SQLite tables before queueing, lease renewal, or reconnect history.

## Next Plans

1. Plan 026: infrastructure/data foundation for Alchemy resources, generated Flue build integration, D1 projections, R2 layout, and local dev workflow.
2. Plan 027: Flue project agent foundation with an app-owned authenticated route that maps product sessions to named Flue sessions and dispatches only after coordinator admission.
3. Plan 028: read-only tool/event projection path against the project sandbox.
4. Plan 029: mutating lease fencing and write-capable tools.
5. Plan 030: snapshot/checkpoint integration after successful mutating runs.
