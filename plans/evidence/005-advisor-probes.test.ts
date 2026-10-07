import { env, runInDurableObject } from "cloudflare:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ROOT_CONVERSATION_ID, type EntryId } from "@earendil-works/pi-durable";
import { expect, it } from "vitest";
import { cooperativeFixture } from "../../apps/runtime/src/pi-durable-cooperative-fixture.ts";
import { PiDurableHost, type HostFixtureDependencies } from "../../apps/runtime/src/pi-durable-host.ts";
import { EncryptedPiStorage } from "../../apps/runtime/src/pi-durable-storage.ts";
import { importRuntimeKeyringFromBytes } from "../../apps/runtime/src/runtime-crypto.ts";

async function binding() {
 return { ownerId: "advisor-005", workspaceSessionId: "advisor-session-005", keyring: await importRuntimeKeyringFromBytes("v1", { v1: new Uint8Array(32).fill(7) }) };
}

it.each(["record", "backing"] as const)("independent: initial %s size rejection does not leave unauthenticated persisted counters", async (limit) => {
 await runInDurableObject(env.PI_HOST_STORAGE.getByName(`005-advisor-initial-${limit}`), async (_instance, state) => {
  const retained = await binding();
  const options = limit === "record" ? { maxRecordBytes: 1 } : { maxBackingBytes: 4096 };
  await expect(EncryptedPiStorage.open(state.storage, retained, options)).rejects.toThrow(/size limit/);
  const rows = state.storage.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table'").toArray();
  console.log("INITIAL_SIZE_FACTS", JSON.stringify({ limit, tablesAfterRejection: rows }));
  const reopened = await EncryptedPiStorage.open(state.storage, retained);
  await reopened.commit([{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }], BACKGROUND_CONTEXT);
  await reopened.close(BACKGROUND_CONTEXT);
 });
});

it("independent: a rejected split commit preserves a usable reopened store and committed reachability", async () => {
 await runInDurableObject(env.PI_HOST_STORAGE.getByName("005-advisor-capacity"), async (_instance, state) => {
  const retained = await binding();
  const options = { maxBackingBytes: 50_000, inlineMaxBytes: 256, chunkBytes: 512 };
  const opened = await EncryptedPiStorage.open(state.storage, retained, options);
  await opened.commit([{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }], BACKGROUND_CONTEXT);
  const first = await opened.mintId<EntryId>();
  await opened.commit([{ type: "entry", value: { id: first, conversationId: ROOT_CONVERSATION_ID, kind: "note", data: { text: "preserve-exact" } } }], BACKGROUND_CONTEXT);
  const second = await opened.mintId<EntryId>();
  await expect(opened.commit([{ type: "entry", value: { id: second, conversationId: ROOT_CONVERSATION_ID, kind: "note", data: { text: "x".repeat(9000) } } }], BACKGROUND_CONTEXT)).rejects.toThrow(/size limit/);
  await opened.close(BACKGROUND_CONTEXT);
  const reopened = await EncryptedPiStorage.open(state.storage, retained, options);
  expect((await reopened.entry(first, BACKGROUND_CONTEXT))?.entry.data).toEqual({ text: "preserve-exact" });
  expect(await reopened.entry(second, BACKGROUND_CONTEXT)).toBeUndefined();
  expect(await reopened.enumerateCommittedReferences()).toEqual([]);
  await reopened.close(BACKGROUND_CONTEXT);
 });
});

it("independent: ordinary accepted prompts retain guarded progress as context exceeds the inline threshold", async () => {
 await runInDurableObject(env.PI_HOST_STORAGE.getByName("005-advisor-guarded-size"), async (_instance, state) => {
  const retained = await binding();
  const fixtures: ReturnType<typeof cooperativeFixture>[] = [];
  const dependencies: HostFixtureDependencies = {
   retained,
   now: () => Date.now() + 60_000,
   authority: async () => ({ current: true, generation: 1, executor: 1 }),
   budgets: { workMs: 60_000, drainMs: 1000 },
   wakeup: { getAlarm: async () => null, setAlarm: async () => {} },
   options: (guard) => {
    const fixture = cooperativeFixture("answer", (kind, id, context) => guard.admit(kind, id, context), (id, context, evidence) => guard.result(id, context, evidence), guard);
    fixtures.push(fixture);
    return { models: fixture.models, registry: fixture.registry, settings: { extensions: [fixture.extension], toolExecution: "sequential", retry: { enabled: false }, compaction: { enabled: false, backgroundTokens: 0 } } };
   },
  };
  const host = await PiDurableHost.open(state.storage, dependencies);
  try {
   for (let n = 1; n <= 6; n++) {
    const command = `accepted-${n}`;
    await host.accept(command, "synthetic bounded input ".repeat(330));
    await host.schedule(command);
    await host.waitIdle();
    await host.reconcile();
    const runs = state.storage.sql.exec("SELECT id, state FROM host_runs ORDER BY rowid").toArray();
    const effects = state.storage.sql.exec("SELECT id, state FROM host_effects ORDER BY rowid").toArray();
    console.log("GUARDED_SIZE_FACTS", JSON.stringify({ turn: n, runs, effects, providerCalls: fixtures.reduce((sum, fixture) => sum + fixture.providerCalls, 0) }));
    expect(runs.at(-1)?.state, `accepted turn ${n} should complete or size should have been denied before acceptance`).toBe("complete");
   }
  } finally {
   for (const fixture of fixtures) fixture.remote.resolve();
   await host.yield().catch(() => undefined);
   await state.storage.deleteAlarm();
   await state.storage.sync();
  }
 });
}, 30_000);
