import { WorkerEntrypoint } from "cloudflare:workers";
import { strictRecord, stringField, literalField } from "../../../../../packages/runtime-contracts/src/json.js";
import { prepareCandidateRuntimeAuthority, validateCandidateRuntimeAuthority, type CandidateAuthorityRow } from "../../../../../apps/web/src/lib/session-command-candidate";
import type { CandidateRuntimeScope } from "../../../../../apps/runtime/src/pi-durable-product-session";

export class NativeRpcFixtureReceiver extends WorkerEntrypoint<{ DB: D1Database }> {
  echo(value: number) {
    const entry = Date.now();
    if (!Number.isSafeInteger(value) || value < 0 || value > 3) throw new Error("probe_echo_denied");
    return { entry, exit: Date.now(), value };
  }
  async authority(input: unknown) {
    const entry = Date.now();
    const row = strictRecord(input, ["version", "userId", "projectId", "workspaceSessionId", "ownerVersion"], "Probe scope");
    const scope: CandidateRuntimeScope = {
      version: literalField(row, "version", [2]), ownerVersion: literalField(row, "ownerVersion", [1]),
      userId: stringField(row, "userId"), projectId: stringField(row, "projectId"), workspaceSessionId: stringField(row, "workspaceSessionId"),
    };
    let authority;
    try {
      const owned = await prepareCandidateRuntimeAuthority(this.env.DB, scope.userId, scope.projectId, scope.workspaceSessionId).first<CandidateAuthorityRow>();
      authority = validateCandidateRuntimeAuthority(owned);
    } catch {
      authority = { current: false, generation: 1, executor: 1, liveExecutors: 0 };
    }
    return { entry, exit: Date.now(), ...authority };
  }
  async inventory() {
    const tables = ["workspace_sessions", "session_commands", "runtime_command_memberships", "candidate_fixture_resets"] as const;
    const result: Record<string, number> = {};
    for (const table of tables) {
      const exists = await this.env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(table).first();
      result[table] = exists ? (await this.env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{n: number}>())!.n : 0;
    }
    return result;
  }
  fetch() { return new Response("Not found", { status: 404 }); }
}
export default { fetch() { return new Response("Not found", { status: 404 }); } };
