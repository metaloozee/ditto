import { env, fetchMock, runInDurableObject } from "cloudflare:test";
import { beforeEach, afterEach, expect, it } from "vitest";
import type { QualificationCredential, QualificationSession } from "./qualification-entry.ts";
const migrations = import.meta.glob("../../../../../apps/web/migrations/*.sql", { eager: true, query: "?raw", import: "default" }) as Record<string, string>;
const account = { version: 1, status: "available", generation: 1, revision: 1, models: [{ id: "faux-1", thinking: ["off"] }] };
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
function credential() { return env.CandidateCredential.getByName("owner") as unknown as DurableObjectStub<QualificationCredential>; }
function session(id: string) { return env.CandidateSessions.getByName(id) as unknown as DurableObjectStub<QualificationSession>; }
async function install() {
 const c = credential();
 expect((await c.install("owner", 1, { access: "synthetic-product-access", refresh: "synthetic-product-refresh", expiresAt: 4102444800000 })).status).toBe("connected");
 return c;
}
async function admit() {
 return env.CandidateProduct.admitOwned("owner", { version: 2, kind: "prompt", projectId: "project", idempotencyKey: "qualification", text: "Synthetic qualification input" });
}
async function revoke(id: string) {
 await env.DB.prepare("UPDATE workspace_sessions SET runtimeFailureReasonCode='model_contract_review' WHERE id=?").bind(id).run();
 expect((await env.DB.prepare("SELECT runtimeFailureReasonCode FROM workspace_sessions WHERE id=?").bind(id).first())?.runtimeFailureReasonCode).toBe("model_contract_review");
}
async function claimed(s: DurableObjectStub<QualificationSession>) {
 return runInDurableObject(s, (_i, state) => state.storage.sql.exec("SELECT effect,request_digest,claimed FROM host_model_dispatch").toArray());
}
function errorFields(error: unknown) {
 const e = error as Record<string, unknown>;
 return Object.fromEntries(["name", "message", "code", "remote", "retryable", "durableObjectReset"].map(k => [k, typeof e?.[k] === "string" || typeof e?.[k] === "boolean" || typeof e?.[k] === "number" ? e[k] : null]));
}
async function observation(p: Promise<unknown>) {
 try { await p; return { returned: true }; } catch (e) { return { returned: false, ...errorFields(e) }; }
}
it("A characterizes exact abort on admitted active candidate work without granting takeover", async () => {
 const c = await install(); await c.holdModel("claim");
 const receipt = await admit(), s = session(receipt.workspaceSessionId);
 const boot = await runInDurableObject(s, i => i.qualificationBoot);
 await env.CandidateProduct.drain(); await c.waitModel();
 const captured = await runInDurableObject(s, async (i, state) => {
  expect(i.qualificationBoot).toBe(boot);
  const invocation = state.storage.sql.exec("SELECT * FROM host_invocations ORDER BY started DESC LIMIT 1").one();
  expect(invocation.state).not.toBe("closed");
  const scope = await state.storage.get("candidate-scope-v2");
  const encrypted = state.storage.sql.exec("SELECT p.payload,i.content FROM host_product_commands p LEFT JOIN host_inbox i ON i.id=p.id").toArray();
  expect(JSON.stringify(encrypted)).not.toContain("Synthetic qualification input");
  return { boot: i.qualificationBoot, doId: state.id.toString(), invocation, scope, encryptedDigest: await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(encrypted))).then(x => Array.from(new Uint8Array(x), b => b.toString(16).padStart(2, "0")).join("")) };
 });
 expect((await env.DB.prepare("SELECT decision FROM candidate_command_decisions WHERE commandId=?").bind(receipt.commandId).first())?.decision).toBe("started");
 expect((await env.DB.prepare("SELECT count(*) AS n FROM runtime_command_memberships").first())?.n).toBe(1);
 const label = "008-qualification-opaque-abort";
 const ordinary = await observation(runInDurableObject(s, () => { throw new Error("008-qualification-opaque-abort"); }));
 const uninvoked = await observation(Promise.reject(new Error(label)));
 const aborted = await observation(runInDurableObject(s, (i, state) => {
  expect(i.qualificationBoot).toBe(captured.boot);
  expect(state.storage.sql.exec("SELECT * FROM host_invocations ORDER BY started DESC LIMIT 1").one()).toEqual(captured.invocation);
  state.abort("008-qualification-opaque-abort");
 }));
 const oldStub = await observation(runInDurableObject(s, i => i.qualificationBoot));
 const fresh = session(receipt.workspaceSessionId);
 const passive = await runInDurableObject(fresh, async (i, state) => ({ boot: i.qualificationBoot, scope: await state.storage.get("candidate-scope-v2"), invocation: state.storage.sql.exec("SELECT * FROM host_invocations ORDER BY started DESC LIMIT 1").one(), roots: state.storage.sql.exec("SELECT count(*) AS n FROM conversations").one().n }));
 expect(passive.boot).not.toBe(captured.boot); expect(passive.scope).toEqual(captured.scope); expect(passive.invocation).toEqual(captured.invocation);
 const denied = await observation(fresh.candidateSnapshot());
 expect(denied).toMatchObject({ returned: false, message: "Prior host termination required" });
 await revoke(receipt.workspaceSessionId); await c.releaseModel();
 expect(calls).toBe(0);
 console.log("QUALIFICATION_A", JSON.stringify({ receipt, captured, ordinary, uninvoked, aborted, oldStub, passive, activation: denied, lostObservation: "deliberately unrecorded outcome cannot qualify", calls, authorityGeneration: 1, witness: null }));
 await fresh.retireFixture();
});
it.each([1, 2])("B safety counterexample %s rejects dispatch after a held positive final policy result is revoked", async () => {
 const c = await install(); await c.armFinal("positive");
 const receipt = await admit(), s = session(receipt.workspaceSessionId);
 try {
  await env.CandidateProduct.drain(); await c.waitFinal();
  const observations = await c.finalObservations();
  expect(observations.map(x => x.call)).toEqual([1, 2, 3, 4]);
  expect(observations.every(x => x.positive)).toBe(true);
  const claims = await claimed(s); expect(claims).toHaveLength(1); expect(claims[0].claimed).toBe(1); expect(claims[0].effect).toBe(observations[3].effectId);
  expect(calls).toBe(0);
  await revoke(receipt.workspaceSessionId); await c.releaseFinal();
  await expect.poll(async () => (await s.candidateSnapshot()).members[0]?.state, { timeout: 3000 }).not.toBe("pending");
  const admissions = (await env.DB.prepare("SELECT effectId,state FROM model_request_admissions").all()).results;
  const windows = (await env.DB.prepare("SELECT consumedRequests,maxRequests,closeReason FROM privileged_operations").all()).results;
  console.log("QUALIFICATION_B", JSON.stringify({ receipt, observations, claims, admissions, windows, calls, safetyExpectedCalls: 0 }));
  expect(calls).toBe(0);
 } finally { await c.releaseFinal(); await s.retireFixture(); }
});
it("B non-held revoked final query denies after the real claim", async () => {
 const c = await install(); await c.armFinal("before-query");
 const receipt = await admit(), s = session(receipt.workspaceSessionId);
 try {
  await env.CandidateProduct.drain(); await c.waitFinal();
  expect((await claimed(s))[0].claimed).toBe(1);
  await revoke(receipt.workspaceSessionId); await c.releaseFinal();
  await expect.poll(async () => (await s.candidateSnapshot()).members[0]?.state, { timeout: 3000 }).not.toBe("pending");
  expect(await c.finalObservations()).toMatchObject([{call:1,positive:true},{call:2,positive:true},{call:3,positive:true},{call:4,positive:false}]);
  console.log("QUALIFICATION_B_CONTROL", JSON.stringify({ observations: await c.finalObservations(), calls }));
  expect(calls).toBe(0);
 } finally { await c.releaseFinal(); await s.retireFixture(); }
});
