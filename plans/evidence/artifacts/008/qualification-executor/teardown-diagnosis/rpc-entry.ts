import { AContinuationSession } from "../a-continuation-entry.ts";
export { FixtureProduct as default, FixtureProduct, CandidateFixtureProduct, FixtureCredential, CodexCredential, PiDurableHostFixture, AContinuationCredential } from "../a-continuation-entry.ts";
function record(value: unknown): Record<string, unknown> {
 if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("008-rpc-invalid-retained-intent");
 return value as Record<string, unknown>;
}
export class RpcQualificationSession extends AContinuationSession {
 async diagnosticAbort(requestKey: string) {
  const intent = record(await this.ctx.storage.get("008-a-continuation-reset-pending"));
  if (intent.resetId !== requestKey) throw new Error("008-rpc-request-mismatch");
  const scope = record(await this.ctx.storage.get("candidate-scope-v2"));
  const invocation = this.ctx.storage.sql.exec("SELECT * FROM host_invocations ORDER BY started DESC LIMIT 1").one();
  if (intent.boot !== this.qualificationBoot) throw new Error("008-rpc-origin-mismatch");
  if (intent.diagnosticOnly !== true || intent.owner !== scope.userId || scope.version !== 2 || scope.ownerVersion !== 1 || intent.workspaceSessionId !== scope.workspaceSessionId || intent.doId !== this.ctx.id.toString() || this.env.CandidateSessions.idFromName(String(scope.workspaceSessionId)).toString() !== this.ctx.id.toString() || JSON.stringify(intent.invocation) !== JSON.stringify(invocation) || invocation.state !== "active" || invocation.generation !== 1 || typeof intent.label !== "string") throw new Error("008-rpc-binding-mismatch");
  await this.ctx.storage.put("008-rpc-executed", { requestKey, boot: this.qualificationBoot, doId: this.ctx.id.toString(), invocation: invocation.id, label: intent.label });
  await this.ctx.storage.sync();
  this.ctx.abort(intent.label);
 }
}
