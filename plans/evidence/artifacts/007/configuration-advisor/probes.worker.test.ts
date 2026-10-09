import { expect, it } from "vitest";
import { bounded, configurationQuery, deferred, gate, piState, product, selectionIntent } from "./fixture-copy.ts";

for (const encrypted of [false, true]) {
 it(`advisor: equal current choice falsely completes an unapplied pending intent encrypted=${encrypted}`, async () => {
  let crashed = false;
  await gate(`advisor-equal-${encrypted}`, async (f) => {
   const intent = selectionIntent("never-applied", "faux-1", "off");
   const before = await piState(f.storage);
   await expect(f.host.configureOwned(intent)).rejects.toThrow("Advisor crash before configure");
   expect(await piState(f.storage)).toBe(before);
   expect(f.storage.sql.exec("SELECT state FROM host_configuration_intents").toArray()).toEqual([{state: "pending"}]);
   const reopened = await f.reopen();
   const ack = await reopened.configureOwned(intent);
   console.log("[advisor-equal]", JSON.stringify({encrypted, piUnchangedBeforeReopen: true, ack}));
   expect(ack.status).toBe("applied");
  }, {owned: true, encrypted, configurationFault: (point) => {
   if (!crashed && point === "configuration-intent") {crashed = true; throw new Error("Advisor crash before configure");}
  }});
 });
}

it("advisor: encrypted pending metadata can skip integrity validation on reopen", async () => {
 let crashed = false;
 await gate("advisor-pending-state", async (f) => {
  const first = selectionIntent("interrupted");
  await expect(f.host.configureOwned(first)).rejects.toThrow("Advisor crash before configure");
  f.storage.sql.exec("UPDATE host_configuration_intents SET state='complete' WHERE state='pending'");
  const reopened = await f.reopen();
  const next = selectionIntent("newer", "faux-1", "high");
  const ack = await reopened.configureOwned(next);
  console.log("[advisor-state]", JSON.stringify({ack, rows: f.storage.sql.exec("SELECT state FROM host_configuration_intents").toArray()}));
  expect(ack.status).toBe("applied");
  await expect(reopened.configureOwned(first)).rejects.toThrow("Configuration evidence integrity failure");
 }, {owned: true, encrypted: true, configurationFault: (point) => {
  if (!crashed && point === "configuration-intent") {crashed = true; throw new Error("Advisor crash before configure");}
 }});
});

it("advisor: stale local authority survives final awaited product check", async () => {
 let configured = false, selectionCalls = 0, localCurrent = true;
 const entered = deferred(), released = deferred();
 await gate("advisor-final-product", async (f) => {
  configured = true;
  const pending = f.host.configureOwned(selectionIntent());
  await bounded(entered.promise);
  localCurrent = false;
  released.resolve();
  const ack = await bounded(pending);
  console.log("[advisor-local]", JSON.stringify({localCurrent, ack}));
  expect(ack.status).toBe("applied");
  localCurrent = true;
  expect((await f.host.readOwnedConfiguration(configurationQuery))?.selection).toEqual(selectionIntent().selection);
 }, {owned: true,
  localAuthority: async (current, generation) => ({current: current && localCurrent, generation, executor: 1}),
  configurationAuthority: async (query, selection) => {
   const result = await product.readConfigurationAuthority(query, selection);
   if (configured && selection && ++selectionCalls === 6) {entered.resolve(); await released.promise;}
   return result;
  }
 });
});
