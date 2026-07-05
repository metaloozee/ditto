import { DurableObject } from "cloudflare:workers";
import {
	type CoordinatorSqlRows,
	coordinatorRowsToState,
	coordinatorStateToRows,
} from "./project-coordinator-sqlite";

export type ProjectCoordinatorMode = "mutating" | "read_only";
export type ProjectCoordinatorTerminalStatus =
	| "completed"
	| "failed"
	| "canceled";

export type ProjectCoordinatorLease = {
	projectId: string;
	runId: string;
	sessionId: string;
	userId: string;
	mode: "mutating";
	capabilities: "mutating";
	fencingToken: number;
	admittedAt: string;
	expiresAt: string;
};

export type ProjectCoordinatorReadOnlyRun = {
	projectId: string;
	runId: string;
	sessionId: string;
	userId: string;
	mode: "read_only";
	capabilities: "read_only";
	admittedAt: string;
};

export type ProjectCoordinatorSnapshotState = {
	latestSnapshotId: string | null;
	restoring: boolean;
};

export type ProjectCoordinatorState = {
	projectId?: string;
	mutationLease: ProjectCoordinatorLease | null;
	activeReadOnlyRuns: ProjectCoordinatorReadOnlyRun[];
	lastTerminal?: {
		runId: string;
		status: ProjectCoordinatorTerminalStatus;
		observedAt: string;
	};
	nextFencingToken: number;
	snapshot: ProjectCoordinatorSnapshotState;
};

export type ProjectCoordinatorAdmissionInput = {
	projectId: string;
	runId: string;
	sessionId: string;
	userId: string;
	mode: ProjectCoordinatorMode;
};

export type ProjectCoordinatorAdmissionAccepted = {
	accepted: true;
	status: 202;
	state: ProjectCoordinatorState;
	admission: ProjectCoordinatorLease | ProjectCoordinatorReadOnlyRun;
};

export type ProjectCoordinatorAdmissionRejected = {
	accepted: false;
	status: 409;
	state: ProjectCoordinatorState;
	message: string;
};

export type ProjectCoordinatorAdmissionDecision =
	| ProjectCoordinatorAdmissionAccepted
	| ProjectCoordinatorAdmissionRejected;

export const PROJECT_COORDINATOR_STATE_KEY = "project-coordinator-state";
export const MUTATION_CONFLICT_MESSAGE =
	"Another mutating run already holds the project lease.";
export const RESTORE_IN_PROGRESS_MESSAGE =
	"Workspace is restoring; mutating runs are paused.";
export const MUTATION_LEASE_TTL_MS = 5 * 60 * 1000;
export const MUTATION_LEASE_RENEWAL_THRESHOLD_MS = 60 * 1000;
export const PROJECT_COORDINATOR_LEASE_VALIDATION_MESSAGES = {
	missingToken: "Missing fencing token.",
	noActiveLease: "No active mutating lease.",
	projectMismatch: "Mutating lease project mismatch.",
	runMismatch: "Mutating lease run mismatch.",
	tokenMismatch: "Mutating lease fencing token mismatch.",
	terminalRun: "Mutating run is terminal.",
	expiredLease: "Mutating lease has expired.",
} as const;

export type ProjectCoordinatorLeaseValidationInput = {
	projectId: string;
	runId: string;
	fencingToken?: number;
};

export type ProjectCoordinatorLeaseValidationResult =
	| { valid: true; lease: ProjectCoordinatorLease }
	| { valid: false; message: string };

export type ProjectCoordinatorLeaseRenewalInput = {
	projectId: string;
	runId: string;
	fencingToken: number;
};

export type ProjectCoordinatorLeaseRenewalAccepted = {
	accepted: true;
	status: 202;
	state: ProjectCoordinatorState;
	lease: ProjectCoordinatorLease;
};

export type ProjectCoordinatorLeaseRenewalRejected = {
	accepted: false;
	status: 409;
	state: ProjectCoordinatorState;
	message: string;
};

export type ProjectCoordinatorLeaseRenewalDecision =
	| ProjectCoordinatorLeaseRenewalAccepted
	| ProjectCoordinatorLeaseRenewalRejected;

export function createInitialProjectCoordinatorState(): ProjectCoordinatorState {
	return {
		mutationLease: null,
		activeReadOnlyRuns: [],
		nextFencingToken: 1,
		snapshot: { latestSnapshotId: null, restoring: false },
	};
}

export function computeMutationLeaseExpiry(nowIso: string): string {
	return new Date(Date.parse(nowIso) + MUTATION_LEASE_TTL_MS).toISOString();
}

export function isMutationLeaseExpired(
	lease: ProjectCoordinatorLease,
	nowIso: string,
): boolean {
	return Date.parse(lease.expiresAt) <= Date.parse(nowIso);
}

export function admitProjectRun(
	state: ProjectCoordinatorState,
	input: ProjectCoordinatorAdmissionInput,
	nowIso: string,
): ProjectCoordinatorAdmissionDecision {
	const projectId = state.projectId ?? input.projectId;
	const baseState = { ...state, projectId };

	if (input.mode === "read_only") {
		const admission: ProjectCoordinatorReadOnlyRun = {
			projectId: input.projectId,
			runId: input.runId,
			sessionId: input.sessionId,
			userId: input.userId,
			mode: "read_only",
			capabilities: "read_only",
			admittedAt: nowIso,
		};

		return {
			accepted: true,
			status: 202,
			admission,
			state: {
				...baseState,
				activeReadOnlyRuns: [...baseState.activeReadOnlyRuns, admission],
			},
		};
	}

	if (input.mode === "mutating" && baseState.snapshot.restoring) {
		return {
			accepted: false,
			status: 409,
			state: baseState,
			message: RESTORE_IN_PROGRESS_MESSAGE,
		};
	}

	const clearedState =
		baseState.mutationLease &&
		isMutationLeaseExpired(baseState.mutationLease, nowIso)
			? { ...baseState, mutationLease: null }
			: baseState;

	if (clearedState.mutationLease) {
		return {
			accepted: false,
			status: 409,
			state: clearedState,
			message: MUTATION_CONFLICT_MESSAGE,
		};
	}

	const admission: ProjectCoordinatorLease = {
		projectId: input.projectId,
		runId: input.runId,
		sessionId: input.sessionId,
		userId: input.userId,
		mode: "mutating",
		capabilities: "mutating",
		fencingToken: clearedState.nextFencingToken,
		admittedAt: nowIso,
		expiresAt: computeMutationLeaseExpiry(nowIso),
	};

	return {
		accepted: true,
		status: 202,
		admission,
		state: {
			...clearedState,
			mutationLease: admission,
			nextFencingToken: clearedState.nextFencingToken + 1,
		},
	};
}

export function observeProjectRunTerminal(
	state: ProjectCoordinatorState,
	input: {
		projectId: string;
		runId: string;
		status: ProjectCoordinatorTerminalStatus;
	},
	nowIso: string,
): ProjectCoordinatorState {
	return {
		...state,
		projectId: state.projectId ?? input.projectId,
		mutationLease:
			state.mutationLease?.runId === input.runId ? null : state.mutationLease,
		activeReadOnlyRuns: state.activeReadOnlyRuns.filter(
			(run) => run.runId !== input.runId,
		),
		lastTerminal: {
			runId: input.runId,
			status: input.status,
			observedAt: nowIso,
		},
	};
}

export function beginProjectRestore(
	state: ProjectCoordinatorState,
): ProjectCoordinatorState {
	if (state.snapshot.restoring) {
		return state;
	}

	return {
		...state,
		snapshot: { ...state.snapshot, restoring: true },
	};
}

export function endProjectRestore(
	state: ProjectCoordinatorState,
	snapshotId: string | null,
): ProjectCoordinatorState {
	return {
		...state,
		snapshot: {
			latestSnapshotId:
				snapshotId === null ? state.snapshot.latestSnapshotId : snapshotId,
			restoring: false,
		},
	};
}

export function recordLatestSnapshot(
	state: ProjectCoordinatorState,
	snapshotId: string,
): ProjectCoordinatorState {
	return {
		...state,
		snapshot: { ...state.snapshot, latestSnapshotId: snapshotId },
	};
}

export function validateProjectCoordinatorLease(
	state: ProjectCoordinatorState,
	input: ProjectCoordinatorLeaseValidationInput,
	nowIso: string,
): ProjectCoordinatorLeaseValidationResult {
	if (typeof input.fencingToken !== "number") {
		return {
			valid: false,
			message: PROJECT_COORDINATOR_LEASE_VALIDATION_MESSAGES.missingToken,
		};
	}

	if (
		state.lastTerminal?.runId === input.runId ||
		state.activeReadOnlyRuns.some((run) => run.runId === input.runId)
	) {
		return {
			valid: false,
			message: PROJECT_COORDINATOR_LEASE_VALIDATION_MESSAGES.terminalRun,
		};
	}

	const lease = state.mutationLease;
	if (!lease) {
		return {
			valid: false,
			message: PROJECT_COORDINATOR_LEASE_VALIDATION_MESSAGES.noActiveLease,
		};
	}

	if (
		lease.projectId !== input.projectId ||
		state.projectId !== input.projectId
	) {
		return {
			valid: false,
			message: PROJECT_COORDINATOR_LEASE_VALIDATION_MESSAGES.projectMismatch,
		};
	}

	if (lease.runId !== input.runId) {
		return {
			valid: false,
			message: PROJECT_COORDINATOR_LEASE_VALIDATION_MESSAGES.runMismatch,
		};
	}

	if (lease.fencingToken !== input.fencingToken) {
		return {
			valid: false,
			message: PROJECT_COORDINATOR_LEASE_VALIDATION_MESSAGES.tokenMismatch,
		};
	}

	if (isMutationLeaseExpired(lease, nowIso)) {
		return {
			valid: false,
			message: PROJECT_COORDINATOR_LEASE_VALIDATION_MESSAGES.expiredLease,
		};
	}

	return { valid: true, lease };
}

export function renewProjectCoordinatorLease(
	state: ProjectCoordinatorState,
	input: ProjectCoordinatorLeaseRenewalInput,
	nowIso: string,
): ProjectCoordinatorLeaseRenewalDecision {
	const validation = validateProjectCoordinatorLease(state, input, nowIso);
	if (!validation.valid) {
		return {
			accepted: false,
			status: 409,
			state,
			message: validation.message,
		};
	}

	const renewedLease: ProjectCoordinatorLease = {
		...validation.lease,
		expiresAt: computeMutationLeaseExpiry(nowIso),
	};

	return {
		accepted: true,
		status: 202,
		lease: renewedLease,
		state: {
			...state,
			mutationLease: renewedLease,
		},
	};
}

function getString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

function requireString(input: Record<string, unknown>, key: string): string {
	const value = getString(input[key]);
	if (!value) {
		throw new Error(`Missing ${key}.`);
	}
	return value;
}

function parseMode(value: unknown): ProjectCoordinatorMode {
	if (value === "mutating" || value === "read_only") {
		return value;
	}
	throw new Error("Invalid mode.");
}

function parseTerminalStatus(value: unknown): ProjectCoordinatorTerminalStatus {
	if (value === "completed" || value === "failed" || value === "canceled") {
		return value;
	}
	throw new Error("Invalid terminal status.");
}

function parseAdmissionInput(value: unknown): ProjectCoordinatorAdmissionInput {
	if (!value || typeof value !== "object") {
		throw new Error("Invalid admission request.");
	}

	const input = value as Record<string, unknown>;
	return {
		projectId: requireString(input, "projectId"),
		runId: requireString(input, "runId"),
		sessionId: requireString(input, "sessionId"),
		userId: requireString(input, "userId"),
		mode: parseMode(input.mode),
	};
}

function parseTerminalInput(value: unknown): {
	projectId: string;
	runId: string;
	status: ProjectCoordinatorTerminalStatus;
} {
	if (!value || typeof value !== "object") {
		throw new Error("Invalid terminal request.");
	}

	const input = value as Record<string, unknown>;
	return {
		projectId: requireString(input, "projectId"),
		runId: requireString(input, "runId"),
		status: parseTerminalStatus(input.status),
	};
}

function parseFencingToken(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error("Invalid fencing token.");
	}
	return value;
}

function parseRenewalInput(
	value: unknown,
): ProjectCoordinatorLeaseRenewalInput {
	if (!value || typeof value !== "object") {
		throw new Error("Invalid renewal request.");
	}

	const input = value as Record<string, unknown>;
	return {
		projectId: requireString(input, "projectId"),
		runId: requireString(input, "runId"),
		fencingToken: parseFencingToken(input.fencingToken),
	};
}

function parseNullableSnapshotIdInput(value: unknown): {
	snapshotId: string | null;
} {
	if (!value || typeof value !== "object") {
		throw new Error("Invalid snapshot request.");
	}

	const input = value as Record<string, unknown>;
	const snapshotId = input.snapshotId;

	if (snapshotId === null) {
		return { snapshotId: null };
	}

	return { snapshotId: requireString(input, "snapshotId") };
}

function parseRequiredSnapshotIdInput(value: unknown): { snapshotId: string } {
	if (!value || typeof value !== "object") {
		throw new Error("Invalid snapshot request.");
	}

	const input = value as Record<string, unknown>;
	return { snapshotId: requireString(input, "snapshotId") };
}

export class ProjectCoordinator extends DurableObject<Env> {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		try {
			if (request.method === "GET" && url.pathname === "/status") {
				return Response.json(await this.getState());
			}

			if (request.method !== "POST") {
				return new Response("Method not allowed", { status: 405 });
			}

			switch (url.pathname) {
				case "/admit":
					return await this.admit(parseAdmissionInput(await request.json()));
				case "/renew":
					return await this.renew(parseRenewalInput(await request.json()));
				case "/terminal":
					return await this.terminal(parseTerminalInput(await request.json()));
				case "/begin-restore":
					return await this.beginRestore();
				case "/end-restore":
					return await this.endRestore(
						parseNullableSnapshotIdInput(await request.json()),
					);
				case "/record-snapshot":
					return await this.recordSnapshot(
						parseRequiredSnapshotIdInput(await request.json()),
					);
				default:
					return new Response("Not found", { status: 404 });
			}
		} catch (error) {
			return Response.json(
				{
					error:
						error instanceof Error
							? error.message
							: "Project coordinator request failed.",
				},
				{ status: 400 },
			);
		}
	}

	private async admit(
		input: ProjectCoordinatorAdmissionInput,
	): Promise<Response> {
		const decision = admitProjectRun(
			await this.getState(),
			input,
			new Date().toISOString(),
		);
		await this.setState(decision.state);

		if (!decision.accepted) {
			return Response.json(
				{ error: decision.message, state: decision.state },
				{
					status: decision.status,
				},
			);
		}

		return Response.json(
			{ admission: decision.admission, state: decision.state },
			{ status: decision.status },
		);
	}

	private async renew(
		input: ProjectCoordinatorLeaseRenewalInput,
	): Promise<Response> {
		const decision = renewProjectCoordinatorLease(
			await this.getState(),
			input,
			new Date().toISOString(),
		);
		await this.setState(decision.state);

		if (!decision.accepted) {
			return Response.json(
				{ error: decision.message, state: decision.state },
				{
					status: decision.status,
				},
			);
		}

		return Response.json(
			{ lease: decision.lease, state: decision.state },
			{ status: decision.status },
		);
	}

	private async terminal(input: {
		projectId: string;
		runId: string;
		status: ProjectCoordinatorTerminalStatus;
	}): Promise<Response> {
		const state = observeProjectRunTerminal(
			await this.getState(),
			input,
			new Date().toISOString(),
		);
		await this.setState(state);

		return Response.json({ state }, { status: 202 });
	}

	private async beginRestore(): Promise<Response> {
		const state = beginProjectRestore(await this.getState());
		await this.setState(state);

		return Response.json({ state }, { status: 202 });
	}

	private async endRestore(input: {
		snapshotId: string | null;
	}): Promise<Response> {
		const state = endProjectRestore(await this.getState(), input.snapshotId);
		await this.setState(state);

		return Response.json({ state }, { status: 202 });
	}

	private async recordSnapshot(input: {
		snapshotId: string;
	}): Promise<Response> {
		const state = recordLatestSnapshot(await this.getState(), input.snapshotId);
		await this.setState(state);

		return Response.json({ state }, { status: 202 });
	}

	private ensureSchema(): void {
		const sql = this.ctx.storage.sql;
		sql.exec(
			"CREATE TABLE IF NOT EXISTS coordinator_meta (id INTEGER PRIMARY KEY, project_id TEXT, next_fencing_token INTEGER NOT NULL DEFAULT 1)",
		);
		sql.exec(
			"CREATE TABLE IF NOT EXISTS mutation_lease (id INTEGER PRIMARY KEY, run_id TEXT, session_id TEXT, user_id TEXT, fencing_token INTEGER, admitted_at TEXT, expires_at TEXT)",
		);
		try {
			sql.exec("ALTER TABLE mutation_lease ADD COLUMN expires_at TEXT");
		} catch {}
		sql.exec(
			"CREATE TABLE IF NOT EXISTS read_only_runs (run_id TEXT PRIMARY KEY, session_id TEXT, user_id TEXT, admitted_at TEXT)",
		);
		sql.exec(
			"CREATE TABLE IF NOT EXISTS last_terminal (id INTEGER PRIMARY KEY, run_id TEXT, status TEXT, observed_at TEXT)",
		);
		sql.exec(
			"CREATE TABLE IF NOT EXISTS snapshot_state (id INTEGER PRIMARY KEY, latest_snapshot_id TEXT, restoring INTEGER NOT NULL DEFAULT 0)",
		);
	}

	private async getState(): Promise<ProjectCoordinatorState> {
		this.ensureSchema();
		const sql = this.ctx.storage.sql;

		const meta =
			sql
				.exec<{ project_id: string | null; next_fencing_token: number }>(
					"SELECT project_id, next_fencing_token FROM coordinator_meta WHERE id = 1",
				)
				.toArray()[0] ?? null;

		const lease =
			sql
				.exec<{
					run_id: string;
					session_id: string;
					user_id: string;
					fencing_token: number;
					admitted_at: string;
					expires_at: string | null;
				}>(
					"SELECT run_id, session_id, user_id, fencing_token, admitted_at, expires_at FROM mutation_lease WHERE id = 1",
				)
				.toArray()[0] ?? null;

		const readOnlyRuns = sql
			.exec<{
				run_id: string;
				session_id: string;
				user_id: string;
				admitted_at: string;
			}>(
				"SELECT run_id, session_id, user_id, admitted_at FROM read_only_runs ORDER BY rowid",
			)
			.toArray();

		const lastTerminal =
			sql
				.exec<{
					run_id: string;
					status: string;
					observed_at: string;
				}>("SELECT run_id, status, observed_at FROM last_terminal WHERE id = 1")
				.toArray()[0] ?? null;

		const snapshotState =
			sql
				.exec<{
					latest_snapshot_id: string | null;
					restoring: number;
				}>(
					"SELECT latest_snapshot_id, restoring FROM snapshot_state WHERE id = 1",
				)
				.toArray()[0] ?? null;

		const rows: CoordinatorSqlRows = {
			meta,
			lease,
			readOnlyRuns,
			lastTerminal,
			snapshotState,
		};

		return coordinatorRowsToState(rows);
	}

	private async setState(state: ProjectCoordinatorState): Promise<void> {
		this.ensureSchema();
		const sql = this.ctx.storage.sql;
		const rows = coordinatorStateToRows(state);
		const meta = rows.meta;
		if (!meta) {
			throw new Error("Coordinator state rows must include metadata.");
		}

		sql.exec(
			"INSERT OR REPLACE INTO coordinator_meta (id, project_id, next_fencing_token) VALUES (1, ?, ?)",
			meta.project_id,
			meta.next_fencing_token,
		);

		if (rows.lease) {
			sql.exec(
				"INSERT OR REPLACE INTO mutation_lease (id, run_id, session_id, user_id, fencing_token, admitted_at, expires_at) VALUES (1, ?, ?, ?, ?, ?, ?)",
				rows.lease.run_id,
				rows.lease.session_id,
				rows.lease.user_id,
				rows.lease.fencing_token,
				rows.lease.admitted_at,
				rows.lease.expires_at,
			);
		} else {
			sql.exec("DELETE FROM mutation_lease WHERE id = 1");
		}

		sql.exec("DELETE FROM read_only_runs");
		for (const run of rows.readOnlyRuns) {
			sql.exec(
				"INSERT INTO read_only_runs (run_id, session_id, user_id, admitted_at) VALUES (?, ?, ?, ?)",
				run.run_id,
				run.session_id,
				run.user_id,
				run.admitted_at,
			);
		}

		if (rows.lastTerminal) {
			sql.exec(
				"INSERT OR REPLACE INTO last_terminal (id, run_id, status, observed_at) VALUES (1, ?, ?, ?)",
				rows.lastTerminal.run_id,
				rows.lastTerminal.status,
				rows.lastTerminal.observed_at,
			);
		} else {
			sql.exec("DELETE FROM last_terminal WHERE id = 1");
		}

		const snapshot = rows.snapshotState ?? {
			latest_snapshot_id: null as string | null,
			restoring: 0,
		};
		sql.exec(
			"INSERT OR REPLACE INTO snapshot_state (id, latest_snapshot_id, restoring) VALUES (1, ?, ?)",
			snapshot.latest_snapshot_id,
			snapshot.restoring,
		);
	}
}
