# Clean-start operator checklist (dry run)

Status: dry-run template from plan 017. Nothing in it has been run against a real environment. It authorizes no reset, deletion or deployment. Each run needs its own named scope and Ayan's separate approval, as OD4 requires.

Fill every `<placeholder>` before the run. Stop if any one cannot be filled.

## 1. Scope

- Environment: `<environment name and Alchemy stage>`
- D1 database: `<database name>`
- R2 buckets: `<bucket names>`
- Durable Object namespaces: `<runtime session namespace>`, `<credential namespace>`, `<legacy runtime namespace>`
- Sandbox and container namespaces: `<executor namespace>`, `<builder namespace>`, `<legacy sandbox namespace>`
- Approval: `<link to the approval message naming this environment and these resources>`
- Operator and time window: `<name>`, `<start and end time>`

## 2. Preserve

Confirm each item is backed up or left untouched before any step below:

- Source code and Git history: `<repository and commit>`
- Deployment credentials and configuration: `<where the Alchemy and Cloudflare configuration lives>`
- GitHub App configuration and private key location: `<location, never the value>`
- Runtime and credential encryption key versions: `<key version identifiers, never the values>`
- Historical evidence and plans: `<paths>`
- Unrelated work in the same account: `<resources that must not be touched>`

## 3. Fence old authority first

Nothing new may act until every item here is committed.

- [ ] Product admission for the old runtime is closed: `<flag or route change that refuses new commands>`.
- [ ] Every old session is moved to a refusing owner state or fenced: `<D1 statement or tool, reviewed separately>`.
- [ ] Late deliveries are refused: queued and leased work for old sessions is cancelled or failed, and its pending assistants settle as failed.
- [ ] Projections from old runtimes cannot recreate a row. For candidate sessions this is `CandidateProductCommands.applyProjections` in `apps/web/src/lib/session-command-candidate.ts`, covered by the credential test "settles late follow-ups as failed ... and never recreates a deleted target". Legacy runtime projections need their own check: `<legacy projection path and its check>`.
- [ ] Old provider windows: no new model request is admitted for an old session; requests already admitted are recorded as admitted, not undone.

## 4. Account for live execution

- [ ] List every live executor, builder and preview: `<query or console view>`.
- [ ] Destroy each one and record termination or isolation evidence: `<evidence location>`.
- [ ] Any executor without evidence keeps its capacity claim and blocks the new owner for that workspace. Record it here: `<identities still unaccounted>`.

## 5. Separately requested reset

- [ ] The reset itself is a separate, named request: `<approval link>`.
- [ ] Resources it removes: `<exact list>`.
- [ ] Minimal non-secret deletion and retirement fences are kept.

## 6. Enable the new owner

- [ ] Only after sections 3 to 5 are complete: `<flag or composition that enables the candidate runtime>`.
- [ ] New sessions start with new identities, branches and recovery lineages. No command, task, inbox or run is imported.

## 7. Post-transition checks

- [ ] One owner per workspace session: `<query>`.
- [ ] No old work delivered after the fence: `<query on runtime work for old sessions>`.
- [ ] No resurrected rows for old targets: `<query against deletion fences>`.
- [ ] Capacity claims match live executors: `<query>`.
- [ ] A new session completes one synthetic command end to end.

## Failure

If any check fails, stop enabling the new owner. Do not re-enable the old engine without its fences. Record the failure and the state left behind at `<evidence location>`.
