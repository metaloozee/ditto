import { env, fetchMock } from "cloudflare:test";
import { beforeEach, afterEach, expect, it } from "vitest";
import type { CandidateRuntimeScope } from "../../../../../apps/runtime/src/pi-durable-product-session";
import type { CandidateFixtureProduct, CandidateFixtureSession } from "../../../../../apps/credential-tests/src/model-entry";
import { boundedNativeRpcProbe, type ProbeBindings } from "./caller";
import type { CandidateFixtureCredential } from "../../../../../apps/credential-tests/src/entry";
import m0 from "../../../../../apps/web/migrations/0000_wet_giant_girl.sql?raw";
import m1 from "../../../../../apps/web/migrations/0001_jazzy_firelord.sql?raw";
import m2 from "../../../../../apps/web/migrations/0002_sparkling_agent_zero.sql?raw";
import m3 from "../../../../../apps/web/migrations/0003_material_ghost_rider.sql?raw";
import m4 from "../../../../../apps/web/migrations/0004_same_stellaris.sql?raw";
import m5 from "../../../../../apps/web/migrations/0005_illegal_invisible_woman.sql?raw";
import m6 from "../../../../../apps/web/migrations/0006_late_wonder_man.sql?raw";
import m7 from "../../../../../apps/web/migrations/0007_amused_shinobi_shaw.sql?raw";
import m8 from "../../../../../apps/web/migrations/0008_chunky_sunset_bain.sql?raw";
import m9 from "../../../../../apps/web/migrations/0009_worthless_young_avengers.sql?raw";
import m10 from "../../../../../apps/web/migrations/0010_worthless_george_stacy.sql?raw";
import m11 from "../../../../../apps/web/migrations/0011_handy_loa.sql?raw";
import m12 from "../../../../../apps/web/migrations/0012_pale_hiroim.sql?raw";
import m13 from "../../../../../apps/web/migrations/0013_lonely_tigra.sql?raw";
import m14 from "../../../../../apps/web/migrations/0014_smiling_namora.sql?raw";
import m15 from "../../../../../apps/web/migrations/0015_opencode_contract_denials.sql?raw";
import m16 from "../../../../../apps/web/migrations/0016_git_push_contract_state.sql?raw";
import m17 from "../../../../../apps/web/migrations/0017_dazzling_sandman.sql?raw";
import m18 from "../../../../../apps/web/migrations/0018_old_whistler.sql?raw";
import m19 from "../../../../../apps/web/migrations/0019_needy_squadron_sinister.sql?raw";
import m20 from "../../../../../apps/web/migrations/0020_trusted_runtime_additive.sql?raw";
import m21 from "../../../../../apps/web/migrations/0021_first_lilandra.sql?raw";
import m22 from "../../../../../apps/web/migrations/0022_synthetic_model_transport.sql?raw";
import m23 from "../../../../../apps/web/migrations/0023_candidate_product_commands.sql?raw";

declare module "cloudflare:test" {
  interface ProvidedEnv extends ProbeBindings {
    CandidateProduct: Service<CandidateFixtureProduct>;
    CandidateSessions: DurableObjectNamespace<CandidateFixtureSession>;
    CandidateCredential: DurableObjectNamespace<CandidateFixtureCredential>;
  }
}
const receivers = () => [env.ScratchCurrent008, env.ScratchNative008];
let admittedScope: CandidateRuntimeScope | undefined;
beforeEach(() => { fetchMock.activate(); fetchMock.disableNetConnect(); });
afterEach(() => fetchMock.deactivate());

it("compares identical bounded receivers and proves shared fresh owned authority", async () => {
  for (const migration of [m0,m1,m2,m3,m4,m5,m6,m7,m8,m9,m10,m11,m12,m13,m14,m15,m16,m17,m18,m19,m20,m21,m22,m23]) {
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) await env.DB.exec(statement.replace(/^\s*--[^\n]*$/gm, "").replaceAll("\n", " "));
    }
  }
  await env.DB.batch([
    env.DB.prepare("INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('owner','Synthetic owner','owner@example.invalid',0,0)"),
    env.DB.prepare("INSERT INTO projects(id,name,userId,status) VALUES('project','Synthetic project','owner','ready')"),
    env.DB.prepare("INSERT INTO codex_connections VALUES('owner',1,0,'connected',0,0)"),
    env.DB.prepare("INSERT INTO codex_fixture_capabilities VALUES('owner',1,1,?)").bind(JSON.stringify({version:1,status:"available",generation:1,revision:1,models:[{id:"faux-1",thinking:["off"]}]})),
  ]);
  expect((await env.CodexCredential.getByName("owner").install("owner", 1, {access:"synthetic-product-access",refresh:"synthetic-product-refresh",expiresAt:4102444800000})).status).toBe("connected");
  expect((await env.CandidateCredential.getByName("owner").install("owner", 1, {access:"synthetic-product-access",refresh:"synthetic-product-refresh",expiresAt:4102444800000})).status).toBe("connected");
  const receipt = await env.CandidateProduct.admitOwned("owner", {version:2,kind:"prompt",projectId:"project",idempotencyKey:"first",text:"Synthetic admitted command"});
  admittedScope = { version:2, userId:"owner", projectId:"project", workspaceSessionId:receipt.workspaceSessionId, ownerVersion:1 };
  for (const receiver of receivers()) {
    expect(await receiver.inventory()).toEqual({ workspace_sessions:1, session_commands:1, runtime_command_memberships:0, candidate_fixture_resets:0 });
    expect((await receiver.authority(admittedScope)).current).toBe(true);
    expect((await receiver.authority({...admittedScope,userId:"not-owner"})).current).toBe(false);
  }
  const testSamples = await boundedNativeRpcProbe(env, admittedScope);
  console.log("NATIVE_RPC_008_SAMPLES", JSON.stringify({ caller:"test", samples:testSamples }));
  expect(testSamples).toHaveLength(12);
  expect(testSamples.every(sample => sample.ok)).toBe(true);
  const doSamples = await env.CandidateSessions.getByName(receipt.workspaceSessionId).fixtureNativeRpc008(admittedScope);
  console.log("NATIVE_RPC_008_SAMPLES", JSON.stringify({ caller:"existing-DO", samples:doSamples }));
  expect(doSamples).toHaveLength(12);
  expect(doSamples.every(sample => sample.ok)).toBe(true);
  await env.DB.exec("UPDATE workspace_sessions SET runtimeFailureReasonCode='review'");
  for (const receiver of receivers()) expect((await receiver.authority(admittedScope)).current).toBe(false);
  await env.DB.exec("UPDATE workspace_sessions SET runtimeFailureReasonCode=NULL");
  for (const receiver of receivers()) expect((await receiver.authority(admittedScope)).current).toBe(true);
  await env.DB.exec("INSERT INTO runtime_deleted_target_fences VALUES('project','project',1,0)");
  for (const receiver of receivers()) expect((await receiver.authority(admittedScope)).current).toBe(false);
  expect(await env.DB.prepare("SELECT name FROM sqlite_master WHERE name='candidate_fixture_resets'").first()).toBeNull();
  console.log("NATIVE_RPC_008_PROOF", JSON.stringify({ sharedVisibility:true, ordinaryGeneration:1, realAdmission:true, successfulMembershipSeeded:false, reviewFreshness:true, deletionFreshness:true, noResetTable:true }));
});

it("both receivers observe next-test isolation, with no prior admitted D1 rows", async () => {
  expect(admittedScope).toBeDefined();
  expect(await env.DB.prepare("SELECT name FROM sqlite_master WHERE name='workspace_sessions'").first()).toBeNull();
  for (const receiver of receivers()) {
    expect(await receiver.inventory()).toEqual({ workspace_sessions:0, session_commands:0, runtime_command_memberships:0, candidate_fixture_resets:0 });
    expect((await receiver.authority(admittedScope)).current).toBe(false);
  }
  console.log("NATIVE_RPC_008_PROOF", JSON.stringify({ nextTestIsolationBothReceivers:true, priorRows:0 }));
});
