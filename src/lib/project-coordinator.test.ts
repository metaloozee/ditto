import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
	DurableObject: class DurableObject {},
}));

const {
	admitProjectRun,
	createInitialProjectCoordinatorState,
	MUTATION_CONFLICT_MESSAGE,
	observeProjectRunTerminal,
} = await import("./project-coordinator");

const now = "2026-07-02T00:00:00.000Z";

function admissionInput(runId: string, mode: "mutating" | "read_only") {
	return {
		projectId: "project-1",
		runId,
		sessionId: "session-1",
		userId: "user-1",
		mode,
	};
}

describe("project coordinator lease decisions", () => {
	it("admits the first mutating run with a fencing token", () => {
		const decision = admitProjectRun(
			createInitialProjectCoordinatorState(),
			admissionInput("run-1", "mutating"),
			now,
		);

		expect(decision.accepted).toBe(true);
		if (!decision.accepted) {
			throw new Error("expected admission");
		}
		expect(decision.admission).toMatchObject({
			runId: "run-1",
			capabilities: "mutating",
			fencingToken: 1,
		});
		expect(decision.state.mutationLease?.runId).toBe("run-1");
		expect(decision.state.nextFencingToken).toBe(2);
	});

	it("rejects a second mutating run while a lease is active", () => {
		const first = admitProjectRun(
			createInitialProjectCoordinatorState(),
			admissionInput("run-1", "mutating"),
			now,
		);
		if (!first.accepted) {
			throw new Error("expected first admission");
		}

		const second = admitProjectRun(
			first.state,
			admissionInput("run-2", "mutating"),
			now,
		);

		expect(second).toMatchObject({
			accepted: false,
			status: 409,
			message: MUTATION_CONFLICT_MESSAGE,
		});
		expect(second.state.mutationLease?.runId).toBe("run-1");
	});

	it("admits read-only runs during mutation without mutating capabilities", () => {
		const mutating = admitProjectRun(
			createInitialProjectCoordinatorState(),
			admissionInput("run-1", "mutating"),
			now,
		);
		if (!mutating.accepted) {
			throw new Error("expected mutating admission");
		}

		const readOnly = admitProjectRun(
			mutating.state,
			admissionInput("run-2", "read_only"),
			now,
		);

		expect(readOnly.accepted).toBe(true);
		if (!readOnly.accepted) {
			throw new Error("expected read-only admission");
		}
		expect(readOnly.admission).toMatchObject({
			runId: "run-2",
			capabilities: "read_only",
		});
		expect(readOnly.state.mutationLease?.runId).toBe("run-1");
	});

	it("releases the mutation lease on owner terminal", () => {
		const admitted = admitProjectRun(
			createInitialProjectCoordinatorState(),
			admissionInput("run-1", "mutating"),
			now,
		);
		if (!admitted.accepted) {
			throw new Error("expected admission");
		}

		const state = observeProjectRunTerminal(
			admitted.state,
			{ projectId: "project-1", runId: "run-1", status: "completed" },
			now,
		);

		expect(state.mutationLease).toBeNull();
		expect(state.lastTerminal).toMatchObject({
			runId: "run-1",
			status: "completed",
		});
	});

	it("does not release another run's mutation lease", () => {
		const admitted = admitProjectRun(
			createInitialProjectCoordinatorState(),
			admissionInput("run-1", "mutating"),
			now,
		);
		if (!admitted.accepted) {
			throw new Error("expected admission");
		}

		const state = observeProjectRunTerminal(
			admitted.state,
			{ projectId: "project-1", runId: "run-2", status: "failed" },
			now,
		);

		expect(state.mutationLease?.runId).toBe("run-1");
		expect(state.lastTerminal).toMatchObject({ runId: "run-2" });
	});
});
