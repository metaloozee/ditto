import { DurableObject } from "cloudflare:workers";

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

	private async getState(): Promise<ProjectCoordinatorState> {
		return (
			(await this.ctx.storage.get<ProjectCoordinatorState>(
				PROJECT_COORDINATOR_STATE_KEY,
			)) ?? createInitialProjectCoordinatorState()
		);
	}

	private async setState(state: ProjectCoordinatorState): Promise<void> {
		await this.ctx.storage.put(PROJECT_COORDINATOR_STATE_KEY, state);
	}
}
