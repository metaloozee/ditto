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

export function createInitialProjectCoordinatorState(): ProjectCoordinatorState {
	return {
		mutationLease: null,
		activeReadOnlyRuns: [],
		nextFencingToken: 1,
	};
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

	if (baseState.mutationLease) {
		return {
			accepted: false,
			status: 409,
			state: baseState,
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
		fencingToken: baseState.nextFencingToken,
		admittedAt: nowIso,
	};

	return {
		accepted: true,
		status: 202,
		admission,
		state: {
			...baseState,
			mutationLease: admission,
			nextFencingToken: baseState.nextFencingToken + 1,
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
				case "/terminal":
					return await this.terminal(parseTerminalInput(await request.json()));
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

	private ensureSchema(): void {
		const sql = this.ctx.storage.sql;
		sql.exec(
			"CREATE TABLE IF NOT EXISTS coordinator_meta (id INTEGER PRIMARY KEY, project_id TEXT, next_fencing_token INTEGER NOT NULL DEFAULT 1)",
		);
		sql.exec(
			"CREATE TABLE IF NOT EXISTS mutation_lease (id INTEGER PRIMARY KEY, run_id TEXT, session_id TEXT, user_id TEXT, fencing_token INTEGER, admitted_at TEXT)",
		);
		sql.exec(
			"CREATE TABLE IF NOT EXISTS read_only_runs (run_id TEXT PRIMARY KEY, session_id TEXT, user_id TEXT, admitted_at TEXT)",
		);
		sql.exec(
			"CREATE TABLE IF NOT EXISTS last_terminal (id INTEGER PRIMARY KEY, run_id TEXT, status TEXT, observed_at TEXT)",
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
				}>(
					"SELECT run_id, session_id, user_id, fencing_token, admitted_at FROM mutation_lease WHERE id = 1",
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

		const rows: CoordinatorSqlRows = {
			meta,
			lease,
			readOnlyRuns,
			lastTerminal,
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
				"INSERT OR REPLACE INTO mutation_lease (id, run_id, session_id, user_id, fencing_token, admitted_at) VALUES (1, ?, ?, ?, ?, ?)",
				rows.lease.run_id,
				rows.lease.session_id,
				rows.lease.user_id,
				rows.lease.fencing_token,
				rows.lease.admitted_at,
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
	}
}
