import { CandidateFixtureCredential } from "../../../../../apps/credential-tests/src/entry.ts";
import { CandidateFixtureSession } from "../../../../../apps/credential-tests/src/model-entry.ts";
import type { ModelClaimRpc } from "../../../../../apps/web/src/lib/model-product-authority.ts";
export { FixtureProduct as default, FixtureProduct, CandidateFixtureProduct } from "../../../../../apps/credential-tests/src/model-entry.ts";
export { FixtureCredential, CodexCredential } from "../../../../../apps/credential-tests/src/entry.ts";
export { PiDurableHostFixture } from "../../../../../apps/runtime/src/pi-durable-host.ts";

export class AContinuationSession extends CandidateFixtureSession {
 readonly qualificationBoot = crypto.randomUUID();
 async alarm() {
  if (await this.ctx.storage.get("008-a-continuation-reset-pending")) return;
  await super.alarm();
 }
 throwOrdinary(label: string) { throw new Error(label); }
 throwSpoofed(label: string) {
  throw Object.assign(new Error(label), { durableObjectReset: true, remote: true });
 }
}

export class AContinuationCredential extends CandidateFixtureCredential {
 private outcomeResolve!: (value: { status: string }) => void;
 private outcome = new Promise<{ status: string }>(resolve => { this.outcomeResolve = resolve; });
 async requestModel(input: unknown, capability: ModelClaimRpc) {
  const result = await super.requestModel(input, capability);
  this.outcomeResolve({ status: result.status });
  return result;
 }
 waitRequestOutcome() { return this.outcome; }
}
