import { env, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import type { Bare } from "./bare-entry.ts";
declare module "cloudflare:test" { interface ProvidedEnv { Bare: DurableObjectNamespace<Bare>; } }
for (const reset of [false, true]) for (const rpc of [false, true]) {
 it(`bare reset=${reset} deniedRpc=${rpc}`, async () => {
  const name = `bare-${reset}-${rpc}`, old = env.Bare.getByName(name);
  expect(await old.seed()).toBe(true);
  if (reset) await expect(runInDurableObject(old, (_i, state) => state.abort("bare-reset"))).rejects.toThrow("bare-reset");
  const fresh = env.Bare.getByName(name);
  let message: unknown;
  try { await (rpc ? fresh.denied() : runInDurableObject(fresh, i => i.denied())); } catch (error) { message = (error as Error).message; }
  expect(message).toBe("bare-denied");
  expect(await runInDurableObject(fresh, i => i.read())).toBe("synthetic");
 });
}
