import "/home/ayan/ditto-execution/plan-007-recovery/apps/credential-tests/src/codex-request-contract.worker.test.ts";
import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { ModelProductAuthority } from "/home/ayan/ditto-execution/plan-007-recovery/apps/web/src/lib/model-product-authority.ts";
import type { ModelTransportDescriptorV1, SyntheticModelBodyV1 } from "/home/ayan/ditto-execution/plan-007-recovery/packages/runtime-contracts/src/model.ts";

it("advisor: current host invocation generation is independent of identity lifecycle generation", async () => {
 const descriptor = {
  version: 1 as const,
  subject: { version: 1 as const, userId: "owner", projectId: "project", workspaceSessionId: "session", identityId: "executor", incarnationId: "incarnation", controllerNamespace: "fixture-execution-v1", lifecycleGeneration: 1, runtimeOwnerVersion: 1, connectionGeneration: 1, capabilityRevision: 1 },
  requestDigest: "0".repeat(64),
  attempt: { version: 1 as const, effectId: "effect", operationId: "operation", runId: "run", commandId: "command", assistantId: "assistant", taskId: 1, epoch: 1, attempt: 1, generation: 2, deadlineAt: Date.now()+10000, requestDigest: "0".repeat(64), kind: "generation" as const },
 };
 const policy = new ModelProductAuthority(env.DB);
 expect(await policy.current({ ...descriptor, attempt: { ...descriptor.attempt, generation: 1 } })).toBe(true);
 expect(await policy.current(descriptor)).toBe(true);
});

it("advisor: permit rejects time expiry during its actual capability read", async () => {
 let now = 100;
 const descriptor: ModelTransportDescriptorV1 = {
  version: 1,
  subject: { version: 1, userId: "owner", projectId: "project", workspaceSessionId: "session", identityId: "executor", incarnationId: "incarnation", controllerNamespace: "fixture-execution-v1", lifecycleGeneration: 1, runtimeOwnerVersion: 1, connectionGeneration: 1, capabilityRevision: 1 },
  requestDigest: "0".repeat(64),
  attempt: { version: 1, effectId: "effect", operationId: "operation", runId: "run", commandId: "command", assistantId: "assistant", taskId: 1, epoch: 1, attempt: 1, generation: 1, deadlineAt: 1000, requestDigest: "0".repeat(64), kind: "generation" },
 };
 const body: SyntheticModelBodyV1 = { version: 1, protocol: "ditto-synthetic-ndjson-1", purpose: "generation", model: "faux-1", thinking: "off", transcript: "Synthetic expiry probe", options: { maxTokens: 128 } };
 const policy = new ModelProductAuthority(env.DB, () => now);
 expect(await policy.reserve(descriptor, body)).not.toBeNull();
 await env.DB.prepare("UPDATE session_commands SET deadlineAt=150").run();
 await env.DB.prepare("UPDATE privileged_operations SET expiresAt=150").run();
 const db = new Proxy(env.DB, {
  get(target, key) {
   if (key === "prepare") return (sql: string) => {
    const statement = target.prepare(sql);
    if (!sql.startsWith("SELECT snapshot FROM codex_fixture_capabilities")) return statement;
    const wrap = (inner: D1PreparedStatement): D1PreparedStatement => new Proxy(inner, {
     get(item, property) {
      if (property === "bind") return (...args: unknown[]) => wrap(item.bind(...args));
      if (property === "first") return async (...args: Parameters<D1PreparedStatement["first"]>) => {
       const result = await item.first(...args);
       now = 200;
       return result;
      };
      const value = Reflect.get(item, property, item);
      return typeof value === "function" ? value.bind(item) : value;
     },
    });
    return wrap(statement);
   };
   const value = Reflect.get(target, key, target);
   return typeof value === "function" ? value.bind(target) : value;
  },
 });
 expect(await new ModelProductAuthority(db, () => now).permit(descriptor, body)).toBe(false);
});
