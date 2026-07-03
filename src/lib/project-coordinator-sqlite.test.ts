import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
	DurableObject: class DurableObject {},
}));

import { createInitialProjectCoordinatorState } from "./project-coordinator";
import {
	type CoordinatorSqlRows,
	coordinatorRowsToState,
	coordinatorStateToRows,
} from "./project-coordinator-sqlite";

const emptyRows: CoordinatorSqlRows = {
	meta: null,
	lease: null,
	readOnlyRuns: [],
	lastTerminal: null,
};

describe("coordinator sqlite row transforms", () => {
	it("produces initial state from empty rows", () => {
		expect(coordinatorRowsToState(emptyRows)).toEqual(
			createInitialProjectCoordinatorState(),
		);
	});

	it("round-trips a state with an active mutation lease", () => {
		const state = {
			projectId: "project-1",
			mutationLease: {
				projectId: "project-1",
				runId: "run-1",
				sessionId: "session-1",
				userId: "user-1",
				mode: "mutating" as const,
				capabilities: "mutating" as const,
				fencingToken: 7,
				admittedAt: "2026-07-02T00:00:00.000Z",
			},
			activeReadOnlyRuns: [],
			nextFencingToken: 8,
		};

		const roundTripped = coordinatorRowsToState(coordinatorStateToRows(state));

		expect(roundTripped).toEqual(state);
	});

	it("round-trips read-only runs and preserves order", () => {
		const state = {
			projectId: "project-1",
			mutationLease: null,
			activeReadOnlyRuns: [
				{
					projectId: "project-1",
					runId: "run-a",
					sessionId: "session-1",
					userId: "user-1",
					mode: "read_only" as const,
					capabilities: "read_only" as const,
					admittedAt: "2026-07-02T00:00:00.000Z",
				},
				{
					projectId: "project-1",
					runId: "run-b",
					sessionId: "session-1",
					userId: "user-2",
					mode: "read_only" as const,
					capabilities: "read_only" as const,
					admittedAt: "2026-07-02T00:01:00.000Z",
				},
			],
			nextFencingToken: 1,
		};

		const roundTripped = coordinatorRowsToState(coordinatorStateToRows(state));

		expect(roundTripped).toEqual(state);
		expect(roundTripped.activeReadOnlyRuns.map((r) => r.runId)).toEqual([
			"run-a",
			"run-b",
		]);
	});

	it("round-trips a last terminal record", () => {
		const state = {
			projectId: "project-1",
			mutationLease: null,
			activeReadOnlyRuns: [],
			lastTerminal: {
				runId: "run-1",
				status: "completed" as const,
				observedAt: "2026-07-02T00:00:00.000Z",
			},
			nextFencingToken: 2,
		};

		expect(coordinatorRowsToState(coordinatorStateToRows(state))).toEqual(
			state,
		);
	});

	it("drops an orphan lease row whose run is not in a terminal-aware state", () => {
		const rows: CoordinatorSqlRows = {
			meta: { project_id: "project-1", next_fencing_token: 3 },
			lease: {
				run_id: "run-1",
				session_id: "session-1",
				user_id: "user-1",
				fencing_token: 2,
				admitted_at: "2026-07-02T00:00:00.000Z",
			},
			readOnlyRuns: [],
			lastTerminal: null,
		};

		const state = coordinatorRowsToState(rows);

		expect(state.mutationLease?.runId).toBe("run-1");
		expect(state.nextFencingToken).toBe(3);
	});
});
