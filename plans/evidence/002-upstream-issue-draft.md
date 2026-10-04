# Upstream issue draft

Status: historical draft only. Not published. The maintainer accepted the cooperative local-wait approach in [the host-yield decision](../decisions/002-cooperative-host-yield.md). This draft is no longer the recommended next action; do not publish it as a current compatibility finding without new evidence.
Target repository: https://github.com/earendil-works/pi
Package: `@earendil-works/pi-durable`, `packages/durable`.
Local draft validation: the exact standalone code below passed on Node.js 24 with the locked 1.0.1 packages. Log: `node_modules/002-advisor-upstream-repro.log`. This supplements the reviewed workerd/SQLite reproduction; it does not replace it.

The prose follows ASD-STE100 principles: short sentences, active voice, one topic per sentence, and consistent technical names. This is not a certified STE-conformance claim. Technical terms and code retain their original names.

## Proposed title

Support bounded host yield without canceling durable tasks

## Proposed issue body

### Request

Is there a supported method to yield a Harness within a finite host-invocation budget?

We need to preserve task continuation without recording user cancellation. We also need to prevent the previous invocation from acting after ownership changes.

We tested Pi Durable 1.0.1 in a local Cloudflare Durable Object. `Harness.close()` stops new scheduling and signals active task invocations. However, close waits for a task phase that ignores its AbortSignal.

Canceling the context of the close call rejects the caller's wait. It does not finish the task invocation or the underlying close operation.

This appears consistent with the current implementation. We are requesting a supported host-lifecycle contract, not reporting a regression in context cancellation.

### Why we need this

Our proposed integration gives each workspace one Harness in a SQLite-backed Durable Object. A separate execution sandbox runs repository commands.

We need finite host invocations and durable wakeups. A host interruption must not become a user cancellation. A replacement owner must not overlap an old owner that can still act.

A rejected close waiter does not establish that the old invocation has stopped. We therefore do not open a replacement Harness after that rejection.

We found no public pause operation or bounded scheduling pump in the tested version. Please identify an existing supported method if we missed one.

### Tested versions

| Component | Version |
|---|---|
| `@earendil-works/pi-durable` | 1.0.1 |
| `@earendil-works/pi-ai` | 1.0.1 |
| `@earendil-works/chord` | 1.0.1 |
| workerd | 1.20260310.1 |
| Effective Worker compatibility date | 2026-03-10 |
| Vitest | 3.2.7 |
| `@cloudflare/vitest-pool-workers` | 0.12.21 |

The Worker test configuration requests `2026-09-16`. Installed workerd falls back to `2026-03-10`. We make no claim about the requested date or hosted behavior.

### Reproduction

The local Worker test uses real Durable Object SQLite storage. It creates a task phase that waits for a controlled release.

1. Open the Harness without enabling scheduling.
2. Create the synthetic task and commit its checkpoint.
3. Confirm that passive reads and watches do not start the task.
4. Resume scheduling and wait for the phase to start.
5. Start close with an uncanceled context.
6. Call close again with a context that cancels after 50 ms.
7. Confirm that the second caller's wait rejects.
8. Confirm that the invocation signal is aborted, but the original close remains pending.
9. Release the phase and observe its late action.
10. Wait for the original close to finish before opening a replacement Harness.

The 50 ms interval is a test observation window. It is not a platform limit or a production performance requirement.

The following standalone reproduction uses MemoryStorage. It isolates the same lifecycle behavior without Cloudflare or a storage adapter.

Save this code as `repro.mjs` in a package with the three exact 1.0.1 dependencies above. Run `node repro.mjs` with Node.js 24.

```js
import assert from "node:assert/strict";
import {
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  createRegistry,
  defineExtension,
  defineTask,
  Harness,
} from "@earendil-works/pi-durable";
import { MemoryStorage } from "@earendil-works/pi-durable/storage/memory";

const entered = Promise.withResolvers();
const release = Promise.withResolvers();
let signal;
let lateActions = 0;
let joined = false;

const task = defineTask({
  name: "bounded-close-repro",
  version: 1,
  initial: () => ({ phase: "blocked" }),
  phases: {
    blocked: async (_task, runtime) => {
      signal = runtime.signal;
      entered.resolve();
      await release.promise;
      lateActions++;
    },
  },
  abort: async () => {
    throw new Error("User cancellation was not requested");
  },
});
const registry = createRegistry();
registry.install(defineExtension({ name: "close-repro", tasks: [task] }));
const models = createModels({
  authContext: { env: async () => undefined, fileExists: async () => false },
});
const harness = await Harness.open(
  new MemoryStorage(),
  { models, registry },
  BACKGROUND_CONTEXT,
);
let close;
try {
  const root = await harness.root(BACKGROUND_CONTEXT);
  await root.commit(
    (tx) => tx.createTask(task, null, { ownership: { kind: "conversation" } }),
    BACKGROUND_CONTEXT,
  );
  harness.resume();
  await entered.promise;
  close = harness.close(BACKGROUND_CONTEXT).then(() => { joined = true; });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50);
  try {
    await assert.rejects(harness.close(
      withAbortSignal(controller.signal, BACKGROUND_CONTEXT),
    ));
  } finally {
    clearTimeout(timer);
  }
  assert.equal(signal.aborted, true);
  assert.equal(joined, false);
  assert.equal(lateActions, 0);
  release.resolve();
  await close;
  assert.equal(lateActions, 1);
  assert.equal(joined, true);
  console.log("Confirmed: canceled close waiter did not stop the invocation.");
} finally {
  release.resolve();
  await (close ?? harness.close(BACKGROUND_CONTEXT));
}
```

This script exits successfully when it confirms the limitation. It does not demonstrate a successful bounded yield.

### Observed result

The Worker reproduction passes with these observations:

- Passive inspection, history reads, context reads, and watches do not start the task.
- Close aborts the invocation signal.
- The original close remains pending beyond the test interval.
- Canceling the second close waiter rejects only that wait.
- The phase performs its synthetic late action after the signal is aborted.
- The task has no `abortRequested` mark.
- After the original close finishes, reopen preserves the pending task and paused scheduling.

The late action increments a counter. It is not a remote shell operation or proof of an admission-control bypass.

We made no live model request. We did not test hosted eviction, remote process termination, or the full provider and tool interruption matrix.

### Relevant implementation

Paths below refer to the published 1.0.1 package:

- `pi-durable/dist/harness/harness.js:203–210`: close waits for task join before storage closes.
- `pi-durable/dist/harness/scheduler.js:111–114`: join waits for all invocation completion promises, without a deadline.
- `pi-durable/dist/harness/scheduler.js:549–557`: close signals AbortControllers, but does not force task phases to return.
- `pi-durable/dist/session/session.js:202–218`: cleanup excludes caller cancellation; the caller receives a context-bound wait.
- `chord/dist/context/index.d.ts:19–23`: cancellation rejects the waiter, not the underlying promise.

### Requested contract

Please document or provide a supported host protocol that defines:

1. How the host stops new scheduling within a finite invocation budget.
2. How task continuation survives host yield without a user-abort mark.
3. How the host determines when a replacement Harness can safely start.
4. How provider and tool adapters must handle cancellation, deadlines, and late results.
5. What the host must do when an invocation does not cooperate.
6. Which durable deadlines the host must use to schedule its next wakeup.

We do not expect JavaScript cancellation to terminate arbitrary code or undo remote effects. Please state whether this use requires cooperative adapters or process isolation.

If supported in-process yield cannot handle this case, an explicit limitation would help us choose a different host design. Returning from a canceled waiter alone is not sufficient for our ownership requirement.
