import type { createDb } from "#/db";
import { PI_THINKING_LEVELS } from "#/db/schema";

export const AGENT_RUN_STATUSES = [
	"accepted",
	"running",
	"stopping",
	"finalizing",
	"completed",
	"failed",
	"cancelled",
	"interrupted",
] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];
export const TERMINAL_RUN_STATUSES = [
	"completed",
	"failed",
	"cancelled",
	"interrupted",
] as const;
export type TerminalRunStatus = (typeof TERMINAL_RUN_STATUSES)[number];
export type ThinkingLevel = (typeof PI_THINKING_LEVELS)[number];

export const LEGAL_AGENT_RUN_TRANSITIONS: Readonly<
	Record<AgentRunStatus, readonly AgentRunStatus[]>
> = {
	accepted: ["running", "stopping", "finalizing"],
	running: ["stopping", "finalizing"],
	stopping: ["finalizing"],
	finalizing: [...TERMINAL_RUN_STATUSES],
	completed: [],
	failed: [],
	cancelled: [],
	interrupted: [],
};

const MAX_MESSAGE_LENGTH = 32_000;
const MAX_REQUEST_LENGTH = 128;
const MAX_TOOLS_LENGTH = 32_000;

type Client = ReturnType<typeof createDb>["$client"];
type Db = ReturnType<typeof createDb>;
type Row = Record<string, unknown>;

export type PersistenceErrorCode =
	| "not_found"
	| "idempotency_conflict"
	| "stale"
	| "terminal"
	| "busy"
	| "invalid";
export type PersistenceError = {
	kind: "error";
	status: 404 | 409 | 422;
	code: PersistenceErrorCode;
};

export type PersistenceScope = {
	db: Db;
	userId: string;
	projectId: string;
	workspaceSessionId: string;
};
export type AcceptAgentInputOptions = PersistenceScope & {
	requestId: string;
	message: string;
	modelSpecifier: string;
	thinkingLevel?: ThinkingLevel | null;
	createId?: () => string;
	now?: () => number;
};
export type AgentRunProjection = {
	runId: string;
	turnId: string;
	userMessageId: string;
	assistantMessageId: string;
	sequence: number;
	createdRun: boolean;
	duplicate: boolean;
};

function error(code: PersistenceErrorCode): PersistenceError {
	return {
		kind: "error",
		status: code === "not_found" ? 404 : code === "invalid" ? 422 : 409,
		code,
	};
}
function clientOf(db: Db): Client {
	return db.$client;
}
async function all(
	client: Client,
	query: string,
	...params: unknown[]
): Promise<Row[]> {
	const result = await client
		.prepare(query)
		.bind(...params)
		.all();
	return (result.results ?? []) as Row[];
}
async function one(
	client: Client,
	query: string,
	...params: unknown[]
): Promise<Row | null> {
	const rows = await all(client, query, ...params);
	return rows[0] ?? null;
}
function isTerminal(status: string): status is TerminalRunStatus {
	return (TERMINAL_RUN_STATUSES as readonly string[]).includes(status);
}
function validId(valueToCheck: string, max = MAX_REQUEST_LENGTH): boolean {
	return (
		valueToCheck.trim().length > 0 &&
		valueToCheck.length > 0 &&
		valueToCheck.length <= max
	);
}
function isUniqueError(cause: unknown): boolean {
	const message = cause instanceof Error ? cause.message : String(cause);
	return /UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE/i.test(message);
}
function asNumber(valueToCheck: unknown): number {
	return typeof valueToCheck === "number" ? valueToCheck : Number(valueToCheck);
}

async function duplicateForRequest(
	options: AcceptAgentInputOptions,
): Promise<Row | null> {
	return one(
		clientOf(options.db),
		`
		SELECT t.id AS turnId, t.runId, t.sequence, t.userMessageId, t.assistantMessageId,
		 t.projectId, t.workspaceSessionId, t.modelSpecifier, t.thinkingLevel, um.content AS userContent
		FROM turns t JOIN messages um ON um.id=t.userMessageId
		WHERE t.userId=? AND t.requestId=?`,
		options.userId,
		options.requestId,
	);
}

async function projection(
	options: PersistenceScope,
	turnId: string,
	createdRun: boolean,
	duplicate: boolean,
): Promise<AgentRunProjection | PersistenceError> {
	const row = await one(
		clientOf(options.db),
		`SELECT id AS turnId, runId, sequence, userMessageId, assistantMessageId FROM turns WHERE id=? AND userId=? AND projectId=? AND workspaceSessionId=?`,
		turnId,
		options.userId,
		options.projectId,
		options.workspaceSessionId,
	);
	if (!row) return error("busy");
	return {
		runId: String(row.runId),
		turnId: String(row.turnId),
		sequence: asNumber(row.sequence),
		userMessageId: String(row.userMessageId),
		assistantMessageId: String(row.assistantMessageId),
		createdRun,
		duplicate,
	};
}

export async function acceptAgentInput(
	options: AcceptAgentInputOptions,
): Promise<AgentRunProjection | PersistenceError> {
	if (
		!validId(options.userId) ||
		!validId(options.projectId) ||
		!validId(options.workspaceSessionId) ||
		!validId(options.requestId) ||
		!options.message.trim() ||
		options.message.length > MAX_MESSAGE_LENGTH ||
		!validId(options.modelSpecifier) ||
		(options.thinkingLevel !== undefined &&
			options.thinkingLevel !== null &&
			!(PI_THINKING_LEVELS as readonly string[]).includes(
				options.thinkingLevel,
			))
	)
		return error("invalid");
	const client = clientOf(options.db);
	const createId = options.createId ?? (() => crypto.randomUUID());
	const now = options.now ?? (() => Date.now());
	const candidateRunId = createId();
	const candidateTurnId = createId();
	const candidateUserMessageId = createId();
	const candidateAssistantMessageId = createId();
	const duplicate = await duplicateForRequest(options);
	if (duplicate) {
		const exact =
			duplicate.projectId === options.projectId &&
			duplicate.workspaceSessionId === options.workspaceSessionId &&
			duplicate.userContent === options.message &&
			duplicate.modelSpecifier === options.modelSpecifier &&
			(duplicate.thinkingLevel ?? null) === (options.thinkingLevel ?? null);
		return exact
			? {
					runId: String(duplicate.runId),
					turnId: String(duplicate.turnId),
					sequence: asNumber(duplicate.sequence),
					userMessageId: String(duplicate.userMessageId),
					assistantMessageId: String(duplicate.assistantMessageId),
					createdRun: false,
					duplicate: true,
				}
			: error("idempotency_conflict");
	}
	const session = await one(
		client,
		`SELECT id FROM workspace_sessions WHERE id=? AND projectId=? AND userId=? AND status='active'`,
		options.workspaceSessionId,
		options.projectId,
		options.userId,
	);
	if (!session) return error("not_found");
	for (let attempt = 0; attempt < 3; attempt++) {
		const pointer = await one(
			client,
			`SELECT p.currentRunId, r.status, r.id AS runId FROM pi_agent_sessions p LEFT JOIN agent_runs r ON r.id=p.currentRunId WHERE p.workspaceSessionId=? AND p.projectId=? AND p.userId=?`,
			options.workspaceSessionId,
			options.projectId,
			options.userId,
		);
		const status = String(pointer?.status ?? "none");
		const append = status === "accepted" || status === "running";
		const runId = append ? String(pointer?.runId) : candidateRunId;
		const turnId = candidateTurnId;
		const userMessageId = candidateUserMessageId;
		const assistantMessageId = candidateAssistantMessageId;
		const timestamp = Math.floor(now() / 1000);
		const statements: D1PreparedStatement[] = [];
		if (!append) {
			const predecessor = pointer?.runId ? String(pointer.runId) : null;
			statements.push(
				client
					.prepare(
						`INSERT INTO agent_runs (id,workspaceSessionId,projectId,userId,sequence,predecessorRunId,status,acceptedAt,created_at,updated_at) SELECT ?,?,?,?,(SELECT COALESCE(MAX(sequence),0)+1 FROM agent_runs WHERE workspaceSessionId=?),?,'accepted',?,?,? WHERE EXISTS (SELECT 1 FROM workspace_sessions WHERE id=? AND projectId=? AND userId=? AND status='active')`,
					)
					.bind(
						runId,
						options.workspaceSessionId,
						options.projectId,
						options.userId,
						options.workspaceSessionId,
						predecessor,
						timestamp,
						timestamp,
						timestamp,
						options.workspaceSessionId,
						options.projectId,
						options.userId,
					),
			);
			statements.push(
				client
					.prepare(
						`INSERT INTO pi_agent_sessions (workspaceSessionId,projectId,userId,currentRunId,created_at,updated_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM workspace_sessions WHERE id=? AND projectId=? AND userId=? AND status='active') AND EXISTS (SELECT 1 FROM agent_runs WHERE id=? AND workspaceSessionId=? AND projectId=? AND userId=? AND status='accepted') ON CONFLICT(workspaceSessionId) DO UPDATE SET currentRunId=excluded.currentRunId,updated_at=excluded.updated_at WHERE pi_agent_sessions.currentRunId IS ? OR pi_agent_sessions.currentRunId=?`,
					)
					.bind(
						options.workspaceSessionId,
						options.projectId,
						options.userId,
						runId,
						timestamp,
						timestamp,
						options.workspaceSessionId,
						options.projectId,
						options.userId,
						runId,
						options.workspaceSessionId,
						options.projectId,
						options.userId,
						predecessor,
						predecessor,
					),
			);
			statements.push(
				client
					.prepare(
						`DELETE FROM agent_runs WHERE id=? AND NOT EXISTS (SELECT 1 FROM pi_agent_sessions WHERE workspaceSessionId=? AND currentRunId=?)`,
					)
					.bind(runId, options.workspaceSessionId, runId),
			);
		} else {
			statements.push(
				client
					.prepare(
						`UPDATE agent_runs SET updated_at=? WHERE id=? AND workspaceSessionId=? AND projectId=? AND userId=? AND status IN ('accepted','running') AND EXISTS (SELECT 1 FROM workspace_sessions WHERE id=? AND projectId=? AND userId=? AND status='active')`,
					)
					.bind(
						timestamp,
						runId,
						options.workspaceSessionId,
						options.projectId,
						options.userId,
						options.workspaceSessionId,
						options.projectId,
						options.userId,
					),
			);
		}
		statements.push(
			client
				.prepare(
					`INSERT INTO messages (id,sessionId,projectId,userId,role,content,model,status,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM agent_runs WHERE id=? AND workspaceSessionId=? AND projectId=? AND userId=? AND status IN ('accepted','running')) AND EXISTS (SELECT 1 FROM workspace_sessions WHERE id=? AND projectId=? AND userId=? AND status='active')`,
				)
				.bind(
					userMessageId,
					options.workspaceSessionId,
					options.projectId,
					options.userId,
					"user",
					options.message,
					options.modelSpecifier,
					"complete",
					timestamp,
					runId,
					options.workspaceSessionId,
					options.projectId,
					options.userId,
					options.workspaceSessionId,
					options.projectId,
					options.userId,
				),
		);
		statements.push(
			client
				.prepare(
					`INSERT INTO messages (id,sessionId,projectId,userId,role,content,status,created_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM agent_runs WHERE id=? AND workspaceSessionId=? AND projectId=? AND userId=? AND status IN ('accepted','running')) AND EXISTS (SELECT 1 FROM workspace_sessions WHERE id=? AND projectId=? AND userId=? AND status='active')`,
				)
				.bind(
					assistantMessageId,
					options.workspaceSessionId,
					options.projectId,
					options.userId,
					"assistant",
					"",
					"pending",
					timestamp,
					runId,
					options.workspaceSessionId,
					options.projectId,
					options.userId,
					options.workspaceSessionId,
					options.projectId,
					options.userId,
				),
		);
		statements.push(
			client
				.prepare(
					`INSERT INTO turns (id,runId,workspaceSessionId,projectId,userId,sequence,requestId,userMessageId,assistantMessageId,modelSpecifier,thinkingLevel,created_at) SELECT ?,?,?,?,?,(SELECT COALESCE(MAX(sequence),0)+1 FROM turns WHERE runId=?),?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM agent_runs WHERE id=? AND workspaceSessionId=? AND projectId=? AND userId=? AND status IN ('accepted','running')) AND EXISTS (SELECT 1 FROM workspace_sessions WHERE id=? AND projectId=? AND userId=? AND status='active')`,
				)
				.bind(
					turnId,
					runId,
					options.workspaceSessionId,
					options.projectId,
					options.userId,
					runId,
					options.requestId,
					userMessageId,
					assistantMessageId,
					options.modelSpecifier,
					options.thinkingLevel ?? null,
					timestamp,
					runId,
					options.workspaceSessionId,
					options.projectId,
					options.userId,
					options.workspaceSessionId,
					options.projectId,
					options.userId,
				),
		);
		statements.push(
			client
				.prepare(
					`UPDATE workspace_sessions SET updated_at=? WHERE id=? AND projectId=? AND userId=? AND status='active' AND EXISTS (SELECT 1 FROM turns WHERE id=? AND runId=? AND workspaceSessionId=? AND projectId=? AND userId=?)`,
				)
				.bind(
					timestamp,
					options.workspaceSessionId,
					options.projectId,
					options.userId,
					turnId,
					runId,
					options.workspaceSessionId,
					options.projectId,
					options.userId,
				),
		);
		try {
			const result = await client.batch(statements);
			const expectedChanges = append ? [1, 1, 1, 1, 1] : [1, 1, 0, 1, 1, 1, 1];
			if (
				result.length !== expectedChanges.length ||
				result.some(
					(entry, index) =>
						(entry.meta?.changes ?? 0) !== expectedChanges[index],
				)
			) {
				const activeSession = await one(
					client,
					`SELECT id FROM workspace_sessions WHERE id=? AND projectId=? AND userId=? AND status='active'`,
					options.workspaceSessionId,
					options.projectId,
					options.userId,
				);
				if (!activeSession) return error("not_found");
				continue;
			}
			const out = await projection(options, turnId, !append, false);
			if ("kind" in out) continue;
			return out;
		} catch (cause) {
			if (!isUniqueError(cause)) throw cause;
			const winner = await duplicateForRequest(options);
			if (winner) {
				const exact =
					winner.projectId === options.projectId &&
					winner.workspaceSessionId === options.workspaceSessionId &&
					winner.userContent === options.message &&
					winner.modelSpecifier === options.modelSpecifier &&
					(winner.thinkingLevel ?? null) === (options.thinkingLevel ?? null);
				return exact
					? {
							runId: String(winner.runId),
							turnId: String(winner.turnId),
							sequence: asNumber(winner.sequence),
							userMessageId: String(winner.userMessageId),
							assistantMessageId: String(winner.assistantMessageId),
							createdRun: false,
							duplicate: true,
						}
					: error("idempotency_conflict");
			}
		}
	}
	return error("busy");
}

export async function loadOwnedAgentRun(
	options: PersistenceScope & { runId: string },
): Promise<{ run: Row; turns: Row[] } | PersistenceError | null> {
	if (!validId(options.runId)) return error("invalid");
	const run = await one(
		clientOf(options.db),
		`SELECT r.* FROM agent_runs r JOIN workspace_sessions s ON s.id=r.workspaceSessionId AND s.projectId=r.projectId AND s.userId=r.userId AND s.status='active' WHERE r.id=? AND r.workspaceSessionId=? AND r.projectId=? AND r.userId=?`,
		options.runId,
		options.workspaceSessionId,
		options.projectId,
		options.userId,
	);
	if (!run) return null;
	const turns = await all(
		clientOf(options.db),
		`SELECT t.*, um.content AS userContent, um.status AS userStatus, am.content AS assistantContent, am.status AS assistantStatus, am.tools AS assistantTools FROM turns t JOIN agent_runs r ON r.id=t.runId JOIN workspace_sessions s ON s.id=t.workspaceSessionId AND s.projectId=t.projectId AND s.userId=t.userId AND s.status='active' JOIN messages um ON um.id=t.userMessageId JOIN messages am ON am.id=t.assistantMessageId WHERE t.runId=? AND t.workspaceSessionId=? AND t.projectId=? AND t.userId=? AND r.workspaceSessionId=? AND r.projectId=? AND r.userId=? ORDER BY t.sequence`,
		options.runId,
		options.workspaceSessionId,
		options.projectId,
		options.userId,
		options.workspaceSessionId,
		options.projectId,
		options.userId,
	);
	return { run, turns };
}

export async function requestAgentRunStop(
	options: PersistenceScope & {
		runId: string;
		requestId: string;
		now?: () => number;
	},
): Promise<{ accepted: boolean; status: AgentRunStatus } | PersistenceError> {
	if (!validId(options.runId) || !validId(options.requestId))
		return error("invalid");
	const client = clientOf(options.db);
	const row = await one(
		client,
		`SELECT r.status,r.stopRequestId FROM agent_runs r JOIN workspace_sessions s ON s.id=r.workspaceSessionId AND s.projectId=r.projectId AND s.userId=r.userId AND s.status='active' WHERE r.id=? AND r.workspaceSessionId=? AND r.projectId=? AND r.userId=?`,
		options.runId,
		options.workspaceSessionId,
		options.projectId,
		options.userId,
	);
	if (!row) return error("not_found");
	const status = String(row.status) as AgentRunStatus;
	if (status === "finalizing" || isTerminal(status))
		return { accepted: false, status };
	if (row.stopRequestId === options.requestId || status === "stopping")
		return { accepted: false, status: "stopping" };
	const timestamp = Math.floor((options.now ?? (() => Date.now()))() / 1000);
	const result = await client.batch([
		client
			.prepare(
				`UPDATE agent_runs SET status='stopping',stopRequestId=?,stopRequestedAt=?,updated_at=? WHERE id=? AND workspaceSessionId=? AND projectId=? AND userId=? AND status IN ('accepted','running') AND EXISTS (SELECT 1 FROM workspace_sessions WHERE id=? AND projectId=? AND userId=? AND status='active')`,
			)
			.bind(
				options.requestId,
				timestamp,
				timestamp,
				options.runId,
				options.workspaceSessionId,
				options.projectId,
				options.userId,
				options.workspaceSessionId,
				options.projectId,
				options.userId,
			),
	]);
	if ((result[0]?.meta?.changes ?? 0) !== 1) {
		const current = await one(
			client,
			`SELECT r.status FROM agent_runs r JOIN workspace_sessions s ON s.id=r.workspaceSessionId AND s.projectId=r.projectId AND s.userId=r.userId AND s.status='active' WHERE r.id=? AND r.workspaceSessionId=? AND r.projectId=? AND r.userId=?`,
			options.runId,
			options.workspaceSessionId,
			options.projectId,
			options.userId,
		);
		if (!current) return error("not_found");
		return {
			accepted: false,
			status: String(current.status) as AgentRunStatus,
		};
	}
	return { accepted: true, status: "stopping" };
}

export async function transitionAgentRun(
	options: PersistenceScope & {
		runId: string;
		from: AgentRunStatus;
		to: AgentRunStatus;
		expectedEpoch?: number | null;
		outcomeCode?: string;
		now?: () => number;
	},
): Promise<
	{ status: AgentRunStatus; epoch: number | null } | PersistenceError
> {
	if (!LEGAL_AGENT_RUN_TRANSITIONS[options.from].includes(options.to))
		return error("invalid");
	if (
		options.outcomeCode !== undefined &&
		!/^[a-z0-9_:-]{1,128}$/.test(options.outcomeCode)
	)
		return error("invalid");
	const client = clientOf(options.db);
	const owned = await one(
		client,
		`SELECT r.status FROM agent_runs r JOIN workspace_sessions s ON s.id=r.workspaceSessionId AND s.projectId=r.projectId AND s.userId=r.userId AND s.status='active' WHERE r.id=? AND r.workspaceSessionId=? AND r.projectId=? AND r.userId=?`,
		options.runId,
		options.workspaceSessionId,
		options.projectId,
		options.userId,
	);
	if (!owned) return error("not_found");
	const pending =
		options.to === "completed" ||
		options.to === "failed" ||
		options.to === "cancelled" ||
		options.to === "interrupted";
	if (
		pending &&
		(await one(
			client,
			`SELECT 1 AS pending FROM turns t JOIN messages m ON m.id=t.assistantMessageId WHERE t.runId=? AND m.status='pending'`,
			options.runId,
		))
	)
		return error("stale");
	const timestamp = Math.floor((options.now ?? (() => Date.now()))() / 1000);
	const epoch =
		options.to === "running"
			? (options.expectedEpoch ?? 0) + 1
			: (options.expectedEpoch ?? null);
	const set =
		options.to === "running"
			? `status='running',startedAt=COALESCE(startedAt,?),currentExecutionEpoch=?,updated_at=?`
			: options.to === "finalizing"
				? `status='finalizing',finalizingAt=COALESCE(finalizingAt,?),updated_at=?`
				: options.to === "stopping"
					? `status=?,updated_at=?`
					: `status=?,outcomeCode=?,finishedAt=?,updated_at=?`;
	const params: unknown[] =
		options.to === "running"
			? [timestamp, epoch, timestamp]
			: options.to === "finalizing"
				? [timestamp, timestamp]
				: options.to === "stopping"
					? [options.to, timestamp]
					: [options.to, options.outcomeCode ?? null, timestamp, timestamp];
	const expected =
		options.expectedEpoch === undefined
			? ""
			: " AND (currentExecutionEpoch IS ? OR currentExecutionEpoch=?)";
	params.push(
		options.runId,
		options.workspaceSessionId,
		options.projectId,
		options.userId,
		options.from,
		options.workspaceSessionId,
		options.projectId,
		options.userId,
	);
	if (options.expectedEpoch !== undefined)
		params.push(options.expectedEpoch, options.expectedEpoch);
	const result = await client.batch([
		client
			.prepare(
				`UPDATE agent_runs SET ${set} WHERE id=? AND workspaceSessionId=? AND projectId=? AND userId=? AND status=? AND EXISTS (SELECT 1 FROM workspace_sessions WHERE id=? AND projectId=? AND userId=? AND status='active')${expected}`,
			)
			.bind(...params),
	]);
	if ((result[0]?.meta?.changes ?? 0) !== 1) return error("stale");
	return {
		status: options.to,
		epoch: options.to === "running" ? epoch : (options.expectedEpoch ?? null),
	};
}

export async function advanceAgentRunEpoch(
	options: PersistenceScope & {
		runId: string;
		expectedEpoch: number;
		now?: () => number;
	},
): Promise<{ epoch: number } | PersistenceError> {
	if (!Number.isInteger(options.expectedEpoch) || options.expectedEpoch < 1)
		return error("invalid");
	const owned = await one(
		clientOf(options.db),
		`SELECT r.id FROM agent_runs r JOIN workspace_sessions s ON s.id=r.workspaceSessionId AND s.projectId=r.projectId AND s.userId=r.userId AND s.status='active' WHERE r.id=? AND r.workspaceSessionId=? AND r.projectId=? AND r.userId=?`,
		options.runId,
		options.workspaceSessionId,
		options.projectId,
		options.userId,
	);
	if (!owned) return error("not_found");
	const timestamp = Math.floor((options.now ?? (() => Date.now()))() / 1000);
	const result = await clientOf(options.db).batch([
		clientOf(options.db)
			.prepare(
				`UPDATE agent_runs SET currentExecutionEpoch=?,updated_at=? WHERE id=? AND workspaceSessionId=? AND projectId=? AND userId=? AND status IN ('accepted','running','stopping','finalizing') AND currentExecutionEpoch=? AND EXISTS (SELECT 1 FROM workspace_sessions WHERE id=? AND projectId=? AND userId=? AND status='active')`,
			)
			.bind(
				options.expectedEpoch + 1,
				timestamp,
				options.runId,
				options.workspaceSessionId,
				options.projectId,
				options.userId,
				options.expectedEpoch,
				options.workspaceSessionId,
				options.projectId,
				options.userId,
			),
	]);
	return (result[0]?.meta?.changes ?? 0) === 1
		? { epoch: options.expectedEpoch + 1 }
		: error("stale");
}

export async function settleTurnAssistant(
	options: PersistenceScope & {
		turnId: string;
		status: "complete" | "failed";
		content: string;
		tools?: string | null;
	},
): Promise<{ status: "complete" | "failed" } | PersistenceError> {
	if (
		options.content.length > MAX_MESSAGE_LENGTH ||
		(options.tools?.length ?? 0) > MAX_TOOLS_LENGTH
	)
		return error("invalid");
	const client = clientOf(options.db);
	const message = await one(
		client,
		`SELECT m.id,m.status,m.content,m.tools FROM turns t JOIN agent_runs r ON r.id=t.runId JOIN workspace_sessions s ON s.id=t.workspaceSessionId AND s.projectId=t.projectId AND s.userId=t.userId AND s.status='active' JOIN messages m ON m.id=t.assistantMessageId WHERE t.id=? AND t.runId=r.id AND t.workspaceSessionId=? AND t.projectId=? AND t.userId=? AND r.workspaceSessionId=? AND r.projectId=? AND r.userId=? AND m.id=t.assistantMessageId AND m.sessionId=? AND m.projectId=? AND m.userId=? AND m.role='assistant'`,
		options.turnId,
		options.workspaceSessionId,
		options.projectId,
		options.userId,
		options.workspaceSessionId,
		options.projectId,
		options.userId,
		options.workspaceSessionId,
		options.projectId,
		options.userId,
	);
	if (!message) return error("not_found");
	if (message.status === options.status) {
		return message.content === options.content &&
			(message.tools ?? null) === (options.tools ?? null)
			? { status: options.status }
			: error("idempotency_conflict");
	}
	if (message.status !== "pending") return error("terminal");
	const result = await client.batch([
		client
			.prepare(
				`UPDATE messages SET content=?,tools=?,status=? WHERE id=? AND sessionId=? AND projectId=? AND userId=? AND role='assistant' AND status='pending' AND EXISTS (SELECT 1 FROM workspace_sessions WHERE id=? AND projectId=? AND userId=? AND status='active')`,
			)
			.bind(
				options.content,
				options.tools ?? null,
				options.status,
				message.id,
				options.workspaceSessionId,
				options.projectId,
				options.userId,
				options.workspaceSessionId,
				options.projectId,
				options.userId,
			),
	]);
	return (result[0]?.meta?.changes ?? 0) === 1
		? { status: options.status }
		: error("stale");
}
