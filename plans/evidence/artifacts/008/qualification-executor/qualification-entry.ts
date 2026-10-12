import { CandidateFixtureCredential } from "../../../../../apps/credential-tests/src/entry.ts";
import { CandidateFixtureSession } from "../../../../../apps/credential-tests/src/model-entry.ts";
import { CANDIDATE_MODEL_POLICY, ModelProductAuthority } from "../../../../../apps/web/src/lib/model-product-authority.ts";
export { FixtureProduct as default, FixtureProduct, CandidateFixtureProduct } from "../../../../../apps/credential-tests/src/model-entry.ts";
export { FixtureCredential, CodexCredential } from "../../../../../apps/credential-tests/src/entry.ts";
export { PiDurableHostFixture } from "../../../../../apps/runtime/src/pi-durable-host.ts";

export class QualificationSession extends CandidateFixtureSession {
 readonly qualificationBoot = crypto.randomUUID();
}

export class QualificationCredential extends CandidateFixtureCredential {
 private gate: { mode: "positive" | "before-query"; entered: Promise<void>; mark(): void; released: Promise<void>; release(): void } | undefined;
 private observations: { call: number; positive: boolean; effectId: string; generation: number; deadlineAt: number }[] = [];
 armFinal(mode: "positive" | "before-query") {
  let mark!: () => void, release!: () => void;
  this.observations = [];
  this.gate = { mode, entered: new Promise<void>(r => { mark = r; }), mark: () => mark(), released: new Promise<void>(r => { release = r; }), release: () => release() };
 }
 waitFinal() { return this.gate?.entered; }
 releaseFinal() { this.gate?.release(); }
 finalObservations() { return this.observations; }
 protected modelProductAuthority() {
  const fixture = this;
  let call = 0;
  return new class extends ModelProductAuthority {
   async permit(...args: Parameters<ModelProductAuthority["permit"]>) {
    const current = ++call;
    const gate = fixture.gate;
    if (current === 4 && gate?.mode === "before-query") { gate.mark(); await gate.released; }
    const positive = await super.permit(...args);
    fixture.observations.push({ call: current, positive, effectId: args[0].attempt.effectId, generation: args[0].attempt.generation, deadlineAt: args[0].attempt.deadlineAt });
    if (current === 4 && positive && gate?.mode === "positive") { gate.mark(); await gate.released; }
    return positive;
   }
  }(this.env.DB, Date.now, CANDIDATE_MODEL_POLICY);
 }
}
