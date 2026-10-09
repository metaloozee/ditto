import "/home/ayan/ditto-execution/plan-007-recovery/apps/credential-tests/src/codex-request-contract.worker.test.ts";
import { env, SELF, runInDurableObject } from "cloudflare:test";
import { PiDurableHost } from "/home/ayan/ditto-execution/plan-007-recovery/apps/runtime/src/pi-durable-host.ts";
import { createPrivateModelAdapter } from "/home/ayan/ditto-execution/plan-007-recovery/apps/runtime/src/pi-durable-models.ts";
import { ModelProductAuthority } from "/home/ayan/ditto-execution/plan-007-recovery/apps/web/src/lib/model-product-authority.ts";
import { expect, it } from "vitest";
import type { FixtureProduct } from "/home/ayan/ditto-execution/plan-007-recovery/apps/credential-tests/src/model-entry.ts";
const product = SELF as Service<FixtureProduct>;
const query = { version: 1, projectId: "project", workspaceSessionId: "session", ownerVersion: 1 };
const selection = { model: "faux-2", thinking: "low" };
for (const [name, sql] of [
  ["session identity reference", "UPDATE workspace_sessions SET sandboxIdentityId=NULL"],
  ["runtime owner", "UPDATE workspace_sessions SET runtimeOwner='legacy'"],
  ["failure reason", "UPDATE workspace_sessions SET runtimeFailureReasonCode='model_contract_review'"],
  ["identity user", "UPDATE sandbox_identities SET userId='foreign'"],
  ["identity project", "UPDATE sandbox_identities SET projectId='foreign'"],
  ["identity session", "UPDATE sandbox_identities SET workspaceSessionId='foreign'"],
  ["controller class", "UPDATE sandbox_identities SET controllerClass='Other'"],
  ["controller namespace", "UPDATE sandbox_identities SET controllerNamespace='other'"],
  ["identity state", "UPDATE sandbox_identities SET state='provisioning'"],
  ["retirement fence", "INSERT INTO runtime_retired_identity_fences(identityId,lifecycleGeneration,retiredAt) VALUES('executor',1,1)"],
  ["project deletion fence", "INSERT INTO runtime_deleted_target_fences(targetKind,targetId,lastOwnerVersion,deletedAt) VALUES('project','project',1,1)"],
  ["session deletion fence", "INSERT INTO runtime_deleted_target_fences(targetKind,targetId,lastOwnerVersion,deletedAt) VALUES('workspace_session','session',1,1)"],
] as const) it(`advisor configuration product denies ${name} at actual Worker/D1 seam`, async () => {
  expect((await product.readConfigurationAuthority(query, selection)).status).toBe("current");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('foreign','Foreign','foreign@example.invalid',0,0)"),
    env.DB.prepare("INSERT INTO projects(id,name,userId,status) VALUES('foreign','Foreign','foreign','ready')"),
    env.DB.prepare("INSERT INTO workspace_sessions(id,projectId,userId,status) VALUES('foreign','foreign','foreign','active')"),
  ]);
  await env.DB.prepare(sql).run();
  expect(await product.readConfigurationAuthority(query, selection)).toEqual({ version: 1, status: "denied" });
  expect(await product.readConfigurationAuthority(query)).toEqual({ version: 1, status: "denied" });
});
it("advisor configuration read receipts do not require current entitlement", async () => {
  await env.DB.prepare("DELETE FROM codex_fixture_capabilities").run();
  expect((await product.readConfigurationAuthority(query)).status).toBe("current");
  expect((await product.readConfigurationAuthority(query, selection)).status).toBe("denied");
});
it("advisor configuration rejects forged and foreign request scopes over Worker RPC", async () => {
  for (const patch of [{ userId: "owner" }, { workspaceSessionId: "foreign" }, { projectId: "foreign" }, { ownerVersion: 2 }]) {
    expect((await product.readConfigurationAuthority({ ...query, ...patch }, selection)).status).toBe("denied");
  }
  expect((await product.readSecondConfigurationAuthority(query, selection)).status).toBe("denied");
});
for (const [name, mutation] of [
  ["foreign owner", "UPDATE workspace_sessions SET userId='foreign'"],
  ["foreign project owner", "UPDATE projects SET userId='foreign'"],
  ["stale owner version", "UPDATE workspace_sessions SET runtimeOwnerVersion=2"],
  ["foreign session identity", "UPDATE sandbox_identities SET workspaceSessionId='foreign'"],
] as const) it(`advisor configuration first default denies ${name} with zero creation`, async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM runtime_command_memberships"),
    env.DB.prepare("DELETE FROM session_commands"),
    env.DB.prepare("INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('foreign','Foreign','foreign@example.invalid',0,0)"),
    env.DB.prepare("INSERT INTO projects(id,name,userId,status) VALUES('foreign','Foreign','foreign','ready')"),
    env.DB.prepare("INSERT INTO workspace_sessions(id,projectId,userId,status) VALUES('foreign','foreign','foreign','active')"),
    env.DB.prepare(mutation),
  ]);
  const subject = {
    version: 1 as const, userId: "owner", projectId: "project", workspaceSessionId: "session",
    identityId: "executor", incarnationId: "incarnation", controllerNamespace: "fixture-execution-v1",
    lifecycleGeneration: 1, runtimeOwnerVersion: 1, connectionGeneration: 1, capabilityRevision: 1,
  };
  await runInDurableObject(env.PI_MODEL_HOST.getByName(`advisor-default-${name}`), async (_instance, state) => {
    let requested = 0;
    await expect(PiDurableHost.open(state.storage, {
      now: Date.now,
      authority: async () => ({ current: await new ModelProductAuthority(env.DB).ownedConfiguration(subject, { ...query, version: 1 }), generation: 1, executor: 1 }),
      configuration: { subject, defaultSelection: { model: "faux-2", thinking: "low" }, authorize: (q, s) => product.readConfigurationAuthority(q, s) },
      wakeup: { getAlarm: async () => null, setAlarm: async () => {} },
      options: (guard) => {
        const adapter = createPrivateModelAdapter(guard, {
          readModelPermit: (input, descriptor) => product.readModelPermit(input, descriptor),
          requestModel: (input, capability) => { requested++; return product.requestModel(input, capability); },
        }, subject);
        return { models: adapter.models, registry: adapter.registry, settings: { extensions: [adapter.extension] } };
      },
    })).rejects.toThrow("Default configuration denied");
    expect(state.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM conversations").one().n).toBe(0);
    expect(requested).toBe(0);
    await state.storage.deleteAlarm();
  });
});
it("advisor configuration public fetch is not an authentication path", async () => {
  expect((await SELF.fetch("https://configuration-fixture.invalid/readConfigurationAuthority", { method: "POST", body: JSON.stringify(query) })).status).toBe(404);
});
