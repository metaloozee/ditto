// ../../plans/evidence/artifacts/008/native-rpc-fixture-correction/receiver.ts
import { WorkerEntrypoint } from "cloudflare:workers";

// ../../packages/runtime-contracts/src/limits.ts
var RUNTIME_LIMITS = {
  commandBodyBytes: 64 * 1024,
  commandTextCharacters: 32e3,
  idBytes: 128,
  deliveryEnvelopeBytes: 8 * 1024,
  brainControlRecordBytes: 1024 * 1024,
  streamFrameBytes: 64 * 1024,
  subscriberBufferBytes: 1024 * 1024,
  jsonMaxNesting: 64
};

// ../../packages/runtime-contracts/src/json.ts
var ContractParseError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "ContractParseError";
  }
};
var encoder = new TextEncoder();
function strictRecord(value, keys, contract) {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new ContractParseError(
      "invalid_object",
      `${contract} must be a plain object.`
    );
  }
  const record = value;
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) {
      throw new ContractParseError(
        "unknown_field",
        `${contract} contains unknown field ${key}.`
      );
    }
  }
  return record;
}
function stringField(record, key, options = {}) {
  const value = record[key];
  if (value === void 0 && options.optional) return void 0;
  if (typeof value !== "string" || value.length === 0) {
    throw new ContractParseError(
      "invalid_field",
      `${key} must be a non-empty string.`
    );
  }
  if (options.maxCharacters !== void 0 && value.length > options.maxCharacters) {
    throw new ContractParseError(
      "field_too_large",
      `${key} exceeds its character limit.`
    );
  }
  const maxBytes = options.maxBytes;
  if (maxBytes !== void 0 && encoder.encode(value).byteLength > maxBytes) {
    throw new ContractParseError(
      "field_too_large",
      `${key} exceeds its byte limit.`
    );
  }
  return value;
}
function literalField(record, key, values) {
  const value = record[key];
  if (!values.includes(value)) {
    throw new ContractParseError("invalid_field", `${key} is invalid.`);
  }
  return value;
}

// ../web/src/lib/model-product-authority.ts
var CANDIDATE_MODEL_POLICY = Object.freeze({
  owner: "pi_durable_v1",
  controllerNamespace: "fixture-pi-durable-execution-v1"
});

// ../web/src/lib/session-runtime-client.ts
import { AsyncLocalStorage } from "node:async_hooks";
var resolution = new AsyncLocalStorage();

// ../web/src/lib/session-command-candidate.ts
var ownedSessionSql = `SELECT s.*,i.id AS identityId,i.incarnationId,i.lifecycleGeneration,i.controllerNamespace
FROM workspace_sessions s JOIN projects p ON p.id=s.projectId
JOIN sandbox_identities i ON i.id=s.sandboxIdentityId
JOIN candidate_workspace_claims q ON q.sessionId=s.id AND q.identityId=i.id AND q.userId=s.userId AND q.projectId=s.projectId
WHERE s.id=? AND s.userId=? AND s.projectId=? AND p.userId=s.userId
AND s.status='active' AND p.status='ready' AND s.runtimeOwner='pi_durable_v1'
AND s.runtimeOwnerVersion=1 AND s.runtimeProtocolVersion=2 AND s.brainIdentityId IS NULL
AND i.kind='workspace_session' AND i.workspaceSessionId=s.id AND i.userId=s.userId AND i.projectId=s.projectId
AND i.controllerClass='Sandbox' AND i.controllerNamespace='fixture-pi-durable-execution-v1'
AND i.lifecycleGeneration=1 AND i.state='ready' AND i.retiredAt IS NULL
AND NOT EXISTS(SELECT 1 FROM runtime_retired_identity_fences f WHERE f.identityId=i.id)
AND NOT EXISTS(SELECT 1 FROM runtime_deleted_target_fences f WHERE (f.targetKind='project' AND f.targetId=p.id) OR (f.targetKind='workspace_session' AND f.targetId=s.id))`;
function prepareCandidateRuntimeAuthority(db, userId, projectId, sessionId) {
  const query = ownedSessionSql.replace(
    "SELECT s.*,i.id AS identityId,i.incarnationId,i.lifecycleGeneration,i.controllerNamespace",
    "SELECT i.id AS identityId,i.incarnationId,i.lifecycleGeneration,i.controllerNamespace,(SELECT count(*) FROM sandbox_identities WHERE kind='workspace_session' AND controllerClass='Sandbox' AND controllerNamespace='fixture-pi-durable-execution-v1' AND state='ready' AND retiredAt IS NULL) AS liveExecutors"
  );
  return db.prepare(`${query} AND s.runtimeFailureReasonCode IS NULL`).bind(sessionId, userId, projectId);
}
function validateCandidateRuntimeAuthority(row, expected) {
  return {
    current: !!row && row.liveExecutors === 1 && (!expected || row.identityId === expected.identityId && row.incarnationId === expected.incarnationId && row.controllerNamespace === expected.controllerNamespace && row.lifecycleGeneration === expected.lifecycleGeneration),
    generation: 1,
    executor: row?.lifecycleGeneration ?? 1,
    liveExecutors: row?.liveExecutors ?? 0
  };
}

// ../../plans/evidence/artifacts/008/native-rpc-fixture-correction/receiver.ts
var NativeRpcFixtureReceiver = class extends WorkerEntrypoint {
  echo(value) {
    const entry = Date.now();
    if (!Number.isSafeInteger(value) || value < 0 || value > 3) throw new Error("probe_echo_denied");
    return { entry, exit: Date.now(), value };
  }
  async authority(input) {
    const entry = Date.now();
    const row = strictRecord(input, ["version", "userId", "projectId", "workspaceSessionId", "ownerVersion"], "Probe scope");
    const scope = {
      version: literalField(row, "version", [2]),
      ownerVersion: literalField(row, "ownerVersion", [1]),
      userId: stringField(row, "userId"),
      projectId: stringField(row, "projectId"),
      workspaceSessionId: stringField(row, "workspaceSessionId")
    };
    let authority;
    try {
      const owned = await prepareCandidateRuntimeAuthority(this.env.DB, scope.userId, scope.projectId, scope.workspaceSessionId).first();
      authority = validateCandidateRuntimeAuthority(owned);
    } catch {
      authority = { current: false, generation: 1, executor: 1, liveExecutors: 0 };
    }
    return { entry, exit: Date.now(), ...authority };
  }
  async inventory() {
    const tables = ["workspace_sessions", "session_commands", "runtime_command_memberships", "candidate_fixture_resets"];
    const result = {};
    for (const table of tables) {
      const exists = await this.env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(table).first();
      result[table] = exists ? (await this.env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n : 0;
    }
    return result;
  }
  fetch() {
    return new Response("Not found", { status: 404 });
  }
};
var receiver_default = { fetch() {
  return new Response("Not found", { status: 404 });
} };
export {
  NativeRpcFixtureReceiver,
  receiver_default as default
};
