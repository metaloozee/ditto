import { expect, it } from "vitest";
import { bounded, deferred, gate, piState, product, selectionIntent } from "./fixture-copy.ts";

for (const encrypted of [false, true]) {
 for (const change of ["current", "executor"] as const) {
  it(`advisor acceptance: final product hold cannot reuse old local ${change}, encrypted=${encrypted}`, async () => {
   let configured = false, selectionCalls = 0, revoked = false;
   const entered = deferred(), released = deferred();
   await gate(`advisor-final-${change}-${encrypted}`, async (f) => {
    const before = await piState(f.storage);
    configured = true;
    const pending = f.host.configureOwned(selectionIntent());
    try {
     await bounded(entered.promise);
     revoked = true;
    } finally { released.resolve(); }
    const ack = await bounded(pending);
    const unchanged = (await piState(f.storage)) === before;
    console.log("[advisor-configuration-final-local]", JSON.stringify({change, encrypted, revoked, status: ack.status, piUnchanged: unchanged}));
    expect(ack.status).toBe("denied");
    expect(unchanged).toBe(true);
   }, {owned: true, encrypted,
    localAuthority: async (current, generation) => ({
     current: current && !(revoked && change === "current"), generation,
     executor: revoked && change === "executor" ? 2 : 1,
    }),
    configurationAuthority: async (query, selection) => {
     const result = await product.readConfigurationAuthority(query, selection);
     if (configured && selection && ++selectionCalls === 6) { entered.resolve(); await released.promise; }
     return result;
    },
   });
  });
 }
}

it("advisor acceptance: phase metadata cannot bypass pending accounting after encrypted reopen", async () => {
 let crashed = false;
 await gate("advisor-phase-acceptance", async (f) => {
  const first = selectionIntent("interrupted");
  await expect(f.host.configureOwned(first)).rejects.toThrow("Advisor crash before configure");
  const before = await piState(f.storage);
  f.storage.sql.exec("UPDATE host_configuration_intents SET state='complete' WHERE state='pending'");
  let nextStatus = "reopen_rejected";
  try {
   const reopened = await f.reopen();
   const ack = await reopened.configureOwned(selectionIntent("newer", "faux-1", "high"));
   nextStatus = ack.status;
  } catch (error) {
   expect(String(error)).toMatch(/integrity|seal|authentication/i);
  }
  const unchanged = (await piState(f.storage)) === before;
  console.log("[advisor-configuration-phase]", JSON.stringify({nextStatus, piUnchanged: unchanged}));
  expect(nextStatus).not.toBe("applied");
  expect(unchanged).toBe(true);
 }, {owned: true, encrypted: true, configurationFault: (point) => {
  if (!crashed && point === "configuration-intent") {crashed = true; throw new Error("Advisor crash before configure");}
 }});
});
