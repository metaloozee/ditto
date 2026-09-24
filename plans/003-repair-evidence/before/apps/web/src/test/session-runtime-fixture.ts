import { DatabaseSync } from "node:sqlite";
import type { createDb } from "#/db";
import {
	handleSessionCommandRequest,
	type SessionCommandError,
} from "#/lib/session-command";
import { deliverSessionCommands } from "#/lib/session-command-delivery";
import type {
	SessionRuntime,
	SessionRuntimeControlInput,
	SessionRuntimeDeliverInput,
} from "#/lib/session-runtime-client";
import { createSessionRuntimeClient } from "#/lib/session-runtime-client";
import {
	createD1Drizzle,
	OWNERSHIP_D1_SCHEMA,
} from "#/lib/sqlite-d1-test-utils";

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
`;

export type RecordedRuntimeCall =
	| { method: "modelConfiguration" }
	| { method: "deliver"; input: SessionRuntimeDeliverInput }
	| { method: "control"; input: SessionRuntimeControlInput };

export function createSessionRuntimeFixture(options?: {
	now?: () => number;
	random?: () => number;
	modelConfigured?: boolean;
	failBatchAt?: number;
	createId?: () => string;
}) {
	const sqlite = new DatabaseSync(":memory:");
	sqlite.exec(SESSION_COMMAND_D1_SCHEMA);
	const db = createD1Drizzle(
		sqlite,
		options?.failBatchAt === undefined
			? undefined
			: {
					beforeBatchStatement: (index) => {
						if (index === options.failBatchAt) {
							throw new Error(`injected failure at ${index}`);
						}
					},
				},
	);
	const outbound: RecordedRuntimeCall[] = [];
	let configured = options?.modelConfigured ?? true;
	const transport: SessionRuntime = {
		async modelConfiguration() {
			outbound.push({ method: "modelConfiguration" });
			return { configured, protocolVersion: 1 };
		},
		async deliver(input) {
			outbound.push({ method: "deliver", input });
		},
		async control(input) {
			outbound.push({ method: "control", input });
		},
	};
	const runtime = createSessionRuntimeClient(transport);
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

	return {
		db: db as ReturnType<typeof createDb>,
		sqlite,
		runtime,
		outbound,
		now,
		counts,
		seedProject,
		seedTrustedSession,
		setModelConfigured(value: boolean) {
			configured = value;
		},
		/** Mocked-auth ownership/admission helper, not proof of cookie authentication. */
		asUser(userId: string) {
			return {
				async command(body: unknown) {
					return handleSessionCommandRequest({
						db: db as ReturnType<typeof createDb>,
						runtime,
						authenticatedUserId: userId,
						body,
						now,
						createId: options?.createId,
					});
				},
			};
		},
		async deliver(budget?: { maxDeliveries?: number; maxMs?: number }) {
			return deliverSessionCommands({
				db: db as ReturnType<typeof createDb>,
				runtime,
				clock: { now, random: options?.random ?? (() => 0.5) },
				budget,
				createId: options?.createId,
			});
		},
	};
}

export type SessionRuntimeFixture = ReturnType<
	typeof createSessionRuntimeFixture
>;
export type { SessionCommandError };
