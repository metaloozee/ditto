import { env, fetchMock, runInDurableObject } from "cloudflare:test";
import { beforeEach, afterEach, expect, it } from "vitest";
import type { AContinuationCredential } from "../a-continuation-entry.ts";
import type { RpcQualificationSession as AContinuationSession } from "./rpc-entry.ts";
import type { CandidateFixtureProduct } from "../../../../../../apps/credential-tests/src/model-entry.ts";
declare module "cloudflare:test" {
 interface ProvidedEnv {
  DB: D1Database;
  CandidateProduct: Service<CandidateFixtureProduct>;
  CandidateSessions: DurableObjectNamespace<AContinuationSession>;
  CandidateCredential: DurableObjectNamespace<AContinuationCredential>;
 }
}
const migrations = import.meta.glob("../../../../../../apps/web/migrations/*.sql", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const account = { version: 1, status: "available", generation: 1, revision: 1, models: [{ id: "faux-1", thinking: ["off"] }] };
const prompt = { version: 2, kind: "prompt", projectId: "project", idempotencyKey: "a-continuation", text: "Synthetic qualification continuation" };
let calls = 0;
let trap = false;
beforeEach(async () => {
 calls = 0;
 fetchMock.activate(); fetchMock.disableNetConnect();
 if (!trap) {
  trap = true;
  fetchMock.get("https://codex-model-fixture.invalid").intercept({ path: "/v1/stream", method: "POST" }).reply(() => {
   calls++;
   return { statusCode: 200, data: '{"version":1,"type":"done","stopReason":"stop","inputTokens":1,"outputTokens":1}\n', responseOptions: { headers: { "content-type": "application/x-ndjson" } } };
  }).persist();
 }
 for (const path of Object.keys(migrations).sort())
  for (const statement of migrations[path].split("--> statement-breakpoint"))
   if (statement.trim()) await env.DB.exec(statement.replace(/^\s*--[^\n]*$/gm, "").replaceAll("\n", " "));
 await env.DB.batch([
  env.DB.prepare("INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('owner','Synthetic owner','owner@example.invalid',0,0)"),
  env.DB.prepare("INSERT INTO projects(id,name,userId,status) VALUES('project','Synthetic project','owner','ready')"),
  env.DB.prepare("INSERT INTO codex_connections VALUES('owner',1,0,'connected',0,0)"),
  env.DB.prepare("INSERT INTO codex_fixture_capabilities VALUES('owner',1,1,?)").bind(JSON.stringify(account)),
 ]);
});
afterEach(() => fetchMock.deactivate());
function session(id: string) { return env.CandidateSessions.getByName(id); }
function errorFields(error: unknown) {
 const e = error as Record<string, unknown>;
 return Object.fromEntries(["name", "message", "code", "remote", "retryable", "durableObjectReset"].map(k => [k, typeof e?.[k] === "string" || typeof e?.[k] === "boolean" || typeof e?.[k] === "number" ? e[k] : null]));
}
async function observation(p: Promise<unknown>) {
 try { await p; return { returned: true }; } catch (e) { return { returned: false, ...errorFields(e) }; }
}
async function passive(s: DurableObjectStub<AContinuationSession>) {
 return runInDurableObject(s, async (i, state) => {
  const encrypted = state.storage.sql.exec("SELECT p.payload,i.content FROM host_product_commands p LEFT JOIN host_inbox i ON i.id=p.id").toArray();
  expect(JSON.stringify(encrypted)).not.toContain("Synthetic qualification continuation");
  const encryptedDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(encrypted))).then(x => Array.from(new Uint8Array(x), b => b.toString(16).padStart(2, "0")).join(""));
  return {
   boot: i.qualificationBoot, doId: state.id.toString(),
   scope: await state.storage.get("candidate-scope-v2"),
   intent: await state.storage.get("008-a-continuation-reset-pending"),
   rpcExecuted: (await state.storage.get("008-rpc-executed")) ?? null,
   failedDeliveryExecuted: (await state.storage.get("008-a-continuation-failed-delivery-executed")) ?? null,
   invocation: state.storage.sql.exec("SELECT * FROM host_invocations ORDER BY started DESC LIMIT 1").one(),
   invocations: state.storage.sql.exec("SELECT count(*) AS n FROM host_invocations").one().n,
   roots: state.storage.sql.exec("SELECT count(*) AS n FROM conversations").one().n,
   submissions: state.storage.sql.exec("SELECT count(*) AS n FROM submissions").one().n,
   effects: state.storage.sql.exec("SELECT id,invocation,state,deadline FROM host_effects ORDER BY id").toArray(),
   claims: state.storage.sql.exec("SELECT effect,claimed FROM host_model_dispatch ORDER BY effect").toArray(),
   encryptedDigest,
  };
 });
}
async function active() {
 const credential = env.CandidateCredential.getByName("owner");
 expect((await credential.install("owner", 1, { access: "synthetic-product-access", refresh: "synthetic-product-refresh", expiresAt: 4102444800000 })).status).toBe("connected");
 await credential.holdModel("claim");
 const receipt = await env.CandidateProduct.admitOwned("owner", prompt);
 const s = session(receipt.workspaceSessionId);
 const boot = await runInDurableObject(s, i => i.qualificationBoot);
 await env.CandidateProduct.drain(); await credential.waitModel();
 const captured = await passive(s);
 expect(captured.boot).toBe(boot); expect(captured.invocation.state).toBe("active");
 expect(captured.invocation.generation).toBe(1);
 expect(captured.roots).toBe(1); expect(captured.submissions).toBe(1);
 expect(captured.effects).toHaveLength(1); expect(captured.claims[0].claimed).toBe(0);
 expect((await env.DB.prepare("SELECT decision FROM candidate_command_decisions WHERE commandId=?").bind(receipt.commandId).first())?.decision).toBe("started");
 expect((await env.DB.prepare("SELECT count(*) AS n FROM runtime_command_memberships").first())?.n).toBe(1);
 expect(calls).toBe(0);
 return { credential, receipt, s, captured };
}
async function prepare(work: Awaited<ReturnType<typeof active>>, label: string) {
 const intent = { resetId: crypto.randomUUID(), label, diagnosticOnly: true, owner: "owner", workspaceSessionId: work.receipt.workspaceSessionId, boot: work.captured.boot, doId: work.captured.doId, invocation: work.captured.invocation };
 await runInDurableObject(work.s, async (i, state) => {
  expect(i.qualificationBoot).toBe(work.captured.boot);
  expect(state.storage.sql.exec("SELECT * FROM host_invocations ORDER BY started DESC LIMIT 1").one()).toEqual(work.captured.invocation);
  await state.storage.put("008-a-continuation-reset-pending", intent);
  await state.storage.sync();
 });
 return intent;
}
function abort(work: Awaited<ReturnType<typeof active>>, _label: string) {
 return (async () => {
  const intent = await runInDurableObject(work.s, (_i, state) => state.storage.get<{ resetId: string }>("008-a-continuation-reset-pending"));
  expect(intent).toBeDefined();
  return work.s.diagnosticAbort(intent!.resetId);
 })();
}
async function assertRetained(work: Awaited<ReturnType<typeof active>>, fresh: DurableObjectStub<AContinuationSession>) {
 const replacement = await passive(fresh);
 expect(replacement.boot).not.toBe(work.captured.boot);
 expect(replacement.scope).toEqual(work.captured.scope);
 expect(replacement.doId).toBe(work.captured.doId);
 expect(replacement.invocation).toEqual(work.captured.invocation);
 expect(replacement.invocations).toBe(work.captured.invocations);
 expect(replacement.roots).toBe(work.captured.roots);
 expect(replacement.submissions).toBe(work.captured.submissions);
 expect(replacement.effects).toEqual(work.captured.effects);
 expect(replacement.encryptedDigest).toBe(work.captured.encryptedDigest);
 expect(calls).toBe(0);
 return replacement;
}
async function finish(work: Awaited<ReturnType<typeof active>>, fresh: DurableObjectStub<AContinuationSession>) {
 const denied = await observation(runInDurableObject(fresh, i => i.candidateSnapshot()));
 expect(denied).toMatchObject({ returned: false, message: "Prior host termination required" });
 await env.DB.prepare("UPDATE workspace_sessions SET runtimeFailureReasonCode='model_contract_review' WHERE id=?").bind(work.receipt.workspaceSessionId).run();
 expect((await env.DB.prepare("SELECT runtimeFailureReasonCode FROM workspace_sessions WHERE id=?").bind(work.receipt.workspaceSessionId).first())?.runtimeFailureReasonCode).toBe("model_contract_review");
 await runInDurableObject(fresh, async (_i, state) => { await state.storage.deleteAlarm(); await state.storage.sync(); expect(await state.storage.getAlarm()).toBeNull(); });
 await work.credential.releaseModel();
 const outcome = await work.credential.waitRequestOutcome();
 expect(outcome.status).toBe("denied");
 await runInDurableObject(fresh, async (_i, state) => { await state.storage.deleteAlarm(); await state.storage.sync(); expect(await state.storage.getAlarm()).toBeNull(); });
 const final = await assertRetained(work, fresh);
 expect(await env.CandidateProduct.admitOwned("owner", prompt)).toEqual(work.receipt);
 const authority = await env.CandidateProduct.readRuntimeAuthority(work.captured.scope as Parameters<CandidateFixtureProduct["readRuntimeAuthority"]>[0]);
 expect(authority.generation).toBe(1); expect(authority.priorTerminated).toBeUndefined();
 expect(calls).toBe(0);
 return { denied, outcome, final, authority, calls };
}
it("A continuation executes same-label and spoofed-error controls then exact admitted-work abort with clean cleanup", async () => {
 const work = await active(), label = "008-a-continuation-opaque";
 const ordinaryCallback = await observation(runInDurableObject(work.s, () => { throw new Error(label); }));
 const spoofedCallback = await observation(runInDurableObject(work.s, () => { throw Object.assign(new Error(label), { durableObjectReset: true, remote: true }); }));
 const ordinaryRpc = await observation(session(work.receipt.workspaceSessionId).throwOrdinary(label));
 const spoofedRpc = await observation(session(work.receipt.workspaceSessionId).throwSpoofed(label));
 for (const result of [ordinaryCallback, spoofedCallback, ordinaryRpc, spoofedRpc]) expect(result).toMatchObject({ returned: false, name: "Error", message: label });
 const before = await passive(session(work.receipt.workspaceSessionId));
 expect(before.boot).toBe(work.captured.boot); expect(before.invocation).toEqual(work.captured.invocation);
 const intent = await prepare(work, `${label}-${crypto.randomUUID()}`);
 const wrongRequest = await observation(work.s.diagnosticAbort("008-rpc-wrong-request"));
 expect(wrongRequest).toMatchObject({ returned: false, message: "008-rpc-request-mismatch" });
 await runInDurableObject(work.s, async (_i, state) => { await state.storage.put("008-a-continuation-reset-pending", { ...intent, boot: "008-rpc-wrong-origin" }); await state.storage.sync(); });
 const wrongOrigin = await observation(work.s.diagnosticAbort(intent.resetId));
 expect(wrongOrigin).toMatchObject({ returned: false, message: "008-rpc-origin-mismatch" });
 expect((await passive(work.s)).rpcExecuted).toBeNull();
 await runInDurableObject(work.s, async (_i, state) => { await state.storage.put("008-a-continuation-reset-pending", intent); await state.storage.sync(); });
 const observedAbort = await observation(abort(work, label));
 expect(observedAbort).toMatchObject({ returned: false, message: intent.label, remote: true, durableObjectReset: true });
 const failedDelivery = await observation(work.s.diagnosticAbort("008-rpc-second-uninvoked"));
 expect(failedDelivery).toMatchObject({ returned: false, message: intent.label, durableObjectReset: true });
 const oldStubReplay = await observation(work.s.diagnosticAbort(intent.resetId));
 expect(oldStubReplay).toMatchObject({ returned: false, message: intent.label, durableObjectReset: true });
 const fresh = session(work.receipt.workspaceSessionId), replacement = await assertRetained(work, fresh);
 expect(replacement.failedDeliveryExecuted).toBeNull(); expect(replacement.intent).toEqual(intent);
 expect(replacement.rpcExecuted).toEqual({ requestKey: intent.resetId, boot: work.captured.boot, doId: work.captured.doId, invocation: work.captured.invocation.id, label: intent.label });
 const cleanup = await finish(work, fresh);
 console.log("A_CONTINUATION_OBSERVED", JSON.stringify({ receipt: work.receipt, captured: work.captured, wrongRequest, wrongOrigin, ordinaryCallback, spoofedCallback, ordinaryRpc, spoofedRpc, observedAbort, failedDelivery, oldStubReplay, replacement, cleanup, classification: "NOT QUALIFIED pending independent RPC classifier review; no witness issued", witness: null }));
});
it("A continuation discards an actual admitted-work abort outcome and controller restart remains unqualified", async () => {
 const work = await active(), label = `008-rpc-discarded-${crypto.randomUUID()}`;
 const intent = await prepare(work, label);
 await env.DB.exec("CREATE TABLE qualification_outside_reset_observations(resetId TEXT PRIMARY KEY, observation TEXT)");
 let invocationSettled = false;
 try { await abort(work, label); throw new Error("Supported abort unexpectedly returned"); }
 catch (error) {
  expect(errorFields(error)).toMatchObject({ message: label, durableObjectReset: true });
  invocationSettled = true;
 }
 expect(invocationSettled).toBe(true);
 // The restarted controller receives only durable intent/proof, not the caught error.
 const restartedController = async (sessionId: string, resetId: string) => {
  const fresh = session(sessionId), replacement = await passive(fresh);
  const durableIntent = replacement.intent as typeof intent;
  expect(durableIntent.resetId).toBe(resetId);
  expect(durableIntent.workspaceSessionId).toBe(sessionId);
  expect(replacement.boot).not.toBe(durableIntent.boot);
  expect(replacement.doId).toBe(durableIntent.doId);
  expect(replacement.invocation).toEqual(durableIntent.invocation);
  const observationRow = await env.DB.prepare("SELECT observation FROM qualification_outside_reset_observations WHERE resetId=?").bind(resetId).first();
  expect(observationRow).toBeNull();
  return { fresh, replacement, disposition: "NOT QUALIFIED", recordedOutsideObservation: observationRow, witness: null };
 };
 const restart = await restartedController(work.receipt.workspaceSessionId, intent.resetId);
 expect(restart.disposition).toBe("NOT QUALIFIED"); expect(restart.witness).toBeNull();
 const cleanup = await finish(work, restart.fresh);
 console.log("A_CONTINUATION_DISCARDED", JSON.stringify({ receipt: work.receipt, captured: work.captured, intent, replacement: restart.replacement, recordedOutsideObservation: restart.recordedOutsideObservation, disposition: restart.disposition, witness: restart.witness, cleanup }));
});
