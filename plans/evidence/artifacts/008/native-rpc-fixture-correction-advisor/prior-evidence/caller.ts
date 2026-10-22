import { awaitWithContext, BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import type { NativeRpcFixtureReceiver } from "./receiver";
import type { CandidateRuntimeScope } from "../../../../../apps/runtime/src/pi-durable-product-session";
export type ProbeBindings = {
  ScratchCurrent008: Service<NativeRpcFixtureReceiver>;
  ScratchNative008: Service<NativeRpcFixtureReceiver>;
};
export type ProbeBinding = keyof ProbeBindings;
export async function boundedNativeRpcProbe(bindings: ProbeBindings, scope: CandidateRuntimeScope) {
  const samples = [];
  const controller = new AbortController();
  const context = withAbortSignal(controller.signal, BACKGROUND_CONTEXT);
  for (let sample = 0; sample < 3; sample++) {
    for (const binding of ["ScratchCurrent008", "ScratchNative008"] as const) {
      for (const kind of ["echo", "authority"] as const) {
        const before = Date.now();
        const pending = kind === "echo" ? bindings[binding].echo(sample) : bindings[binding].authority(scope);
        const created = Date.now();
        const result = await awaitWithContext(context, pending);
        const after = Date.now();
        samples.push({ binding, kind, sample, before, created, entry: result.entry, exit: result.exit, after,
          ok: kind === "echo" ? "value" in result && result.value === sample : "current" in result && result.current });
      }
    }
  }
  return samples;
}
