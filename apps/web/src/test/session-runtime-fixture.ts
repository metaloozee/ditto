import { DatabaseSync } from "node:sqlite";
import type { createDb } from "#/db";
import { reconstructAdmittedCommandV1 } from "#/lib/session-command";
import { deliverSessionCommands } from "#/lib/session-command-delivery";
import type {
	SessionRuntime,
	SessionRuntimeControlInput,
	SessionRuntimeDeliverInput,
	SessionRuntimeHandoffAck,
} from "#/lib/session-runtime-client";
import {
	SessionRuntimeHandoffError,
	withSessionRuntimeResolution,
} from "#/lib/session-runtime-client";
import {
	createD1Drizzle,
	OWNERSHIP_D1_SCHEMA,
} from "#/lib/sqlite-d1-test-utils";

export const sessionRuntimeRouteHarness: {
	db: ReturnType<typeof createDb> | null;
	userId: string | null;
} = {
	db: null,
	userId: "user-1",
};

export const SESSION_COMMAND_D1_SCHEMA = `
${OWNERSHIP_D1_SCHEMA}
CREATE TABLE user (
	id text PRIMARY KEY NOT NULL,
	name text NOT NULL DEFAULT 'user',
	email text NOT NULL DEFAULT 'user@example.com'
);
CREATE TABLE projects (
	id text PRIMARY KEY NOT NULL,
	name text NOT NULL DEFAULT 'project',
	userId text NOT NULL,
	status text NOT NULL DEFAULT 'ready',
	githubRepo text,
	githubInstallationId integer,
	envVars text
);
CREATE TABLE runtime_deleted_target_fences (
	targetKind text NOT NULL,
	targetId text NOT NULL,
	lastOwnerVersion integer NOT NULL,
	deletedAt integer NOT NULL
);
CREATE UNIQUE INDEX runtime_deleted_target_fences_target_uidx
	ON runtime_deleted_target_fences (targetKind, targetId);
CREATE TABLE session_command_keys (
	id text PRIMARY KEY NOT NULL,
	userId text NOT NULL,
	targetKind text NOT NULL,
	targetId text NOT NULL,
	idempotencyKey text NOT NULL,
	commandKind text NOT NULL,
	canonicalPayloadHash text NOT NULL,
	commandId text NOT NULL,
	receiptId text NOT NULL,
	createdAt integer NOT NULL
);
CREATE UNIQUE INDEX session_command_keys_scope_uidx
	ON session_command_keys (userId, targetKind, targetId, idempotencyKey);
CREATE UNIQUE INDEX session_command_keys_receipt_uidx
	ON session_command_keys (receiptId);
CREATE TABLE session_command_sequences (
	sessionId text PRIMARY KEY NOT NULL,
	nextSequence integer NOT NULL DEFAULT 1,
	updatedAt integer NOT NULL
);
CREATE TABLE session_commands (
	id text PRIMARY KEY NOT NULL,
	userId text NOT NULL,
	targetKind text NOT NULL,
	targetId text NOT NULL,
	projectId text NOT NULL,
	sessionId text,
	kind text NOT NULL,
	commandSeq integer,
	targetRunId text,
	targetCommandId text,
	payloadVersion integer NOT NULL,
	userMessageId text,
	assistantMessageId text,
	payloadDigest text NOT NULL,
	acceptedAt integer NOT NULL,
	deadlineAt integer NOT NULL,
	admissionVersion integer NOT NULL DEFAULT 1,
	executionProjectionVersion integer NOT NULL DEFAULT 0,
	reasonCode text,
	CONSTRAINT session_commands_kind_enum CHECK(kind IN ('prompt', 'follow_up', 'stop', 'cancel', 'project_delete')),
	CONSTRAINT session_commands_target_kind_enum CHECK(targetKind IN ('project', 'workspace_session')),
	CONSTRAINT session_commands_target_shape CHECK((kind = 'project_delete' AND targetKind = 'project' AND sessionId IS NULL AND commandSeq IS NULL) OR (kind != 'project_delete' AND targetKind = 'workspace_session' AND sessionId IS NOT NULL AND commandSeq IS NOT NULL AND typeof(commandSeq) = 'integer' AND commandSeq > 0)),
	CONSTRAINT session_commands_message_shape CHECK((kind IN ('prompt', 'follow_up') AND userMessageId IS NOT NULL AND assistantMessageId IS NOT NULL) OR (kind NOT IN ('prompt', 'follow_up') AND userMessageId IS NULL AND assistantMessageId IS NULL)),
	CONSTRAINT session_commands_run_shape CHECK((kind IN ('follow_up', 'stop') AND targetRunId IS NOT NULL AND targetCommandId IS NULL) OR (kind = 'cancel' AND targetRunId IS NULL AND targetCommandId IS NOT NULL) OR (kind NOT IN ('follow_up', 'stop', 'cancel') AND targetRunId IS NULL AND targetCommandId IS NULL))
);
CREATE UNIQUE INDEX session_commands_session_seq_uidx
	ON session_commands (sessionId, commandSeq);
CREATE UNIQUE INDEX workspace_runtime_work_commandId_uidx
	ON workspace_runtime_work (commandId);
CREATE TABLE sandbox_identities (
	id text PRIMARY KEY NOT NULL,
	kind text NOT NULL,
	sandboxId text NOT NULL,
	containerId text NOT NULL,
	userId text NOT NULL,
	projectId text NOT NULL,
	workspaceSessionId text,
	controllerClass text,
	controllerNamespace text,
	incarnationId text,
	incarnationStartedAt integer,
	lifecycleGeneration integer NOT NULL DEFAULT 1,
	state text NOT NULL,
	retiredAt integer,
	created_at integer,
	updated_at integer
);
CREATE TABLE workspace_capacity_leases (
	id text PRIMARY KEY NOT NULL,
	sessionId text NOT NULL,
	userId text NOT NULL,
	identityId text,
	leaseToken text NOT NULL,
	expiresAt integer NOT NULL,
	created_at integer,
	updated_at integer
);
CREATE UNIQUE INDEX workspace_capacity_leases_sessionId_uidx
	ON workspace_capacity_leases (sessionId);
CREATE TABLE runtime_capacity_policy (
	id integer PRIMARY KEY NOT NULL,
	accountingMode text NOT NULL DEFAULT 'legacy',
	version integer NOT NULL DEFAULT 1,
	updatedAt integer NOT NULL
);
INSERT INTO runtime_capacity_policy (id, accountingMode, version, updatedAt)
VALUES (1, 'legacy', 1, 0);
`;

export type RecordedRuntimeCall =
	| { method: "modelConfiguration" }
	| { method: "deliver"; input: SessionRuntimeDeliverInput }
	| { method: "control"; input: SessionRuntimeControlInput };

type AgentRoute = {
	server: {
		handlers: {
			POST: (ctx: { request: Request }) => Promise<Response>;
		};
	};
};

let streamRoute: AgentRoute | null = null;
let controlRoute: AgentRoute | null = null;

async function loadAgentRoute(path: "stream" | "control"): Promise<AgentRoute> {
	if (path === "stream") {
		if (!streamRoute) {
			const loaded = (await import("#/routes/api.agent.stream")) as unknown as {
				Route: AgentRoute;
			};
			streamRoute = loaded.Route;
		}
		return streamRoute;
	}
	if (!controlRoute) {
		const loaded = (await import("#/routes/api.agent.control")) as unknown as {
			Route: AgentRoute;
		};
		controlRoute = loaded.Route;
	}
	return controlRoute;
}

export function createSessionRuntimeFixture(options?: {
	now?: () => number;
	random?: () => number;
	modelConfigured?: boolean;
	failBatchAt?: number;
	failStatement?: (sql: string) => boolean;
	createId?: () => string;
	protocolVersion?: number;
}) {
	const sqlite = new DatabaseSync(":memory:");
	sqlite.exec(SESSION_COMMAND_D1_SCHEMA);
	const db = createD1Drizzle(sqlite, {
		beforeBatchStatement:
			options?.failBatchAt === undefined
				? undefined
				: (index) => {
						if (index === options.failBatchAt) {
							throw new Error(`injected failure at ${index}`);
						}
					},
		beforeStatement: options?.failStatement
			? (sql) => {
					if (options.failStatement?.(sql)) {
						throw new Error("injected delivery storage fault");
					}
				}
			: undefined,
	});
	const outbound: RecordedRuntimeCall[] = [];
	let configured = options?.modelConfigured ?? true;
	let protocolVersion = options?.protocolVersion ?? 1;
	let deliverImpl:
		| ((
				input: SessionRuntimeDeliverInput,
		  ) => Promise<SessionRuntimeHandoffAck | undefined>)
		| null = null;
	let controlImpl:
		| ((
				input: SessionRuntimeControlInput,
		  ) => Promise<SessionRuntimeHandoffAck | undefined>)
		| null = null;
	let loseNextAck = false;

	function lookupAck(input: {
		commandId: string;
		ownerVersion: number;
	}): SessionRuntimeHandoffAck {
		const row = sqlite
			.prepare(
				`SELECT sc.commandSeq AS commandSeq, k.receiptId AS receiptId
				 FROM session_commands sc
				 JOIN session_command_keys k ON k.commandId = sc.id
				 WHERE sc.id = ?`,
			)
			.get(input.commandId) as
			| { commandSeq: number; receiptId: string }
			| undefined;
		if (!row) {
			throw new SessionRuntimeHandoffError(
				"invalid_ack",
				"No persisted command for acknowledgment.",
			);
		}
		return {
			version: 1,
			commandId: input.commandId,
			ownerVersion: input.ownerVersion,
			acceptedPosition: row.commandSeq,
			receiptId: row.receiptId,
		};
	}

	const transport: SessionRuntime = {
		async modelConfiguration() {
			outbound.push({ method: "modelConfiguration" });
			return { configured, protocolVersion };
		},
		async deliver(input) {
			outbound.push({ method: "deliver", input });
			if (loseNextAck) {
				loseNextAck = false;
				return undefined as unknown as SessionRuntimeHandoffAck;
			}
			if (deliverImpl) {
				const ack = await deliverImpl(input);
				return ack as SessionRuntimeHandoffAck;
			}
			return lookupAck(input);
		},
		async control(input) {
			outbound.push({ method: "control", input });
			if (loseNextAck) {
				loseNextAck = false;
				return undefined as unknown as SessionRuntimeHandoffAck;
			}
			if (controlImpl) {
				const ack = await controlImpl(input);
				return ack as SessionRuntimeHandoffAck;
			}
			return lookupAck(input);
		},
	};
	const now = options?.now ?? (() => 1_700_000_000_000);

	function seedProject(input?: {
		userId?: string;
		projectId?: string;
		status?: string;
	}) {
		const userId = input?.userId ?? "user-1";
		const projectId = input?.projectId ?? "proj-1";
		sqlite
			.prepare("INSERT OR IGNORE INTO user (id, name, email) VALUES (?, ?, ?)")
			.run(userId, userId, `${userId}@example.com`);
		sqlite
			.prepare(
				"INSERT OR IGNORE INTO projects (id, name, userId, status) VALUES (?, ?, ?, ?)",
			)
			.run(projectId, "Demo", userId, input?.status ?? "ready");
		return { userId, projectId };
	}

	function seedTrustedSession(input?: {
		userId?: string;
		projectId?: string;
		sessionId?: string;
		ownerVersion?: number;
		status?: string;
	}) {
		const seeded = seedProject(input);
		const sessionId = input?.sessionId ?? "sess-1";
		sqlite
			.prepare(
				`INSERT INTO workspace_sessions (
					id, projectId, userId, status, runtimeOwner, runtimeOwnerVersion
				) VALUES (?, ?, ?, ?, 'trusted_v1', ?)`,
			)
			.run(
				sessionId,
				seeded.projectId,
				seeded.userId,
				input?.status ?? "active",
				input?.ownerVersion ?? 1,
			);
		return { ...seeded, sessionId };
	}

	function counts() {
		return {
			sessions: Number(
				(
					sqlite
						.prepare("SELECT count(*) AS n FROM workspace_sessions")
						.get() as { n: number }
				).n,
			),
			messages: Number(
				(
					sqlite.prepare("SELECT count(*) AS n FROM messages").get() as {
						n: number;
					}
				).n,
			),
			commands: Number(
				(
					sqlite
						.prepare("SELECT count(*) AS n FROM session_commands")
						.get() as { n: number }
				).n,
			),
			keys: Number(
				(
					sqlite
						.prepare("SELECT count(*) AS n FROM session_command_keys")
						.get() as { n: number }
				).n,
			),
			work: Number(
				(
					sqlite
						.prepare("SELECT count(*) AS n FROM workspace_runtime_work")
						.get() as { n: number }
				).n,
			),
		};
	}

	function activateHarness(userId: string | null) {
		sessionRuntimeRouteHarness.db = db as ReturnType<typeof createDb>;
		sessionRuntimeRouteHarness.userId = userId;
	}

	function withResolution<T>(
		run: () => T,
		overrides?: { trustedAdmissionEligible?: boolean },
	): T {
		return withSessionRuntimeResolution(
			{
				transport,
				trustedAdmissionEligible: overrides?.trustedAdmissionEligible ?? true,
				now,
				createId: options?.createId,
			},
			run,
		);
	}

	return {
		db: db as ReturnType<typeof createDb>,
		sqlite,
		runtime: transport,
		outbound,
		now,
		counts,
		seedProject,
		seedTrustedSession,
		setModelConfigured(value: boolean) {
			configured = value;
		},
		setProtocolVersion(value: number) {
			protocolVersion = value;
		},
		setDeliverImpl(
			handler:
				| ((
						input: SessionRuntimeDeliverInput,
				  ) => Promise<SessionRuntimeHandoffAck | undefined>)
				| null,
		) {
			deliverImpl = handler;
		},
		setControlImpl(
			handler:
				| ((
						input: SessionRuntimeControlInput,
				  ) => Promise<SessionRuntimeHandoffAck | undefined>)
				| null,
		) {
			controlImpl = handler;
		},
		loseNextAcknowledgment() {
			loseNextAck = true;
		},
		observeReceipt(commandId: string) {
			return sqlite
				.prepare(
					`SELECT k.receiptId AS receiptId, k.commandId AS commandId, sc.kind AS kind,
					        sc.commandSeq AS commandSeq, sc.userMessageId AS userMessageId,
					        sc.assistantMessageId AS assistantMessageId, sc.sessionId AS sessionId
					 FROM session_command_keys k
					 JOIN session_commands sc ON sc.id = k.commandId
					 WHERE k.commandId = ?`,
				)
				.get(commandId);
		},
		observeMessages(sessionId: string) {
			return sqlite
				.prepare(
					"SELECT id, role, content, status FROM messages WHERE sessionId = ? ORDER BY role DESC",
				)
				.all(sessionId);
		},
		observeWork(commandId: string) {
			return sqlite
				.prepare(
					"SELECT status, deliveryState, payload, commandId FROM workspace_runtime_work WHERE commandId = ?",
				)
				.get(commandId);
		},
		async reconstructCommand(commandId: string) {
			return reconstructAdmittedCommandV1(
				db as ReturnType<typeof createDb>,
				commandId,
			);
		},
		/** Mocked-auth captured production-handler helper, not proof of cookie authentication. */
		asUser(userId: string) {
			return {
				async command(
					body: unknown,
					request: {
						raw?: string;
						bytes?: Uint8Array;
						path?: "stream" | "control";
						trustedAdmissionEligible?: boolean;
					} = {},
				) {
					activateHarness(userId);
					const path = request.path ?? "stream";
					const route = await loadAgentRoute(path);
					const payload = request.bytes ?? request.raw ?? JSON.stringify(body);
					return withResolution(
						async () => {
							const response = await route.server.handlers.POST({
								request: new Request(`http://localhost/api/agent/${path}`, {
									method: "POST",
									headers: { "Content-Type": "application/json" },
									body: payload as BodyInit,
								}),
							});
							return {
								status: response.status,
								body: (await response.json()) as unknown,
							};
						},
						{
							trustedAdmissionEligible:
								request.trustedAdmissionEligible ?? true,
						},
					);
				},
			};
		},
		async deliver(budget?: { maxDeliveries?: number; maxMs?: number }) {
			return withResolution(() =>
				deliverSessionCommands({
					db: db as ReturnType<typeof createDb>,
					runtime: transport,
					clock: { now, random: options?.random ?? (() => 0.5) },
					budget,
					createId: options?.createId,
				}),
			);
		},
		async scheduledDrain() {
			const { drainWorkspaceRuntime } = await import("#/lib/workspace-runtime");
			return withResolution(() =>
				drainWorkspaceRuntime({
					env: {} as Env,
					db: db as ReturnType<typeof createDb>,
					now,
					createId: options?.createId,
				}),
			);
		},
	};
}

export type SessionRuntimeFixture = ReturnType<
	typeof createSessionRuntimeFixture
>;
export type { SessionCommandError } from "#/lib/session-command";
