import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
	DurableObject: class DurableObject {},
}));

const {
	admitProjectRun,
	beginProjectRestore,
	createInitialProjectCoordinatorState,
	endProjectRestore,
	MUTATION_CONFLICT_MESSAGE,
	observeProjectRunTerminal,
	recordLatestSnapshot,
	RESTORE_IN_PROGRESS_MESSAGE,
	validateProjectCoordinatorLease,
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

	it("rejects lease validation without a fencing token", () => {
		const admitted = admitProjectRun(
			createInitialProjectCoordinatorState(),
			admissionInput("run-1", "mutating"),
			now,
		);
		if (!admitted.accepted) {
			throw new Error("expected admission");
		}

		expect(
			validateProjectCoordinatorLease(admitted.state, {
				projectId: "project-1",
				runId: "run-1",
			}),
		).toMatchObject({ valid: false, message: "Missing fencing token." });
	});

	it("rejects stale fencing tokens", () => {
		const admitted = admitProjectRun(
			createInitialProjectCoordinatorState(),
			admissionInput("run-1", "mutating"),
			now,
		);
		if (!admitted.accepted) {
			throw new Error("expected admission");
		}

		expect(
			validateProjectCoordinatorLease(admitted.state, {
				projectId: "project-1",
				runId: "run-1",
				fencingToken: 2,
			}),
		).toMatchObject({
			valid: false,
			message: "Mutating lease fencing token mismatch.",
		});
	});

	it("rejects stale run ids", () => {
		const admitted = admitProjectRun(
			createInitialProjectCoordinatorState(),
			admissionInput("run-1", "mutating"),
			now,
		);
		if (!admitted.accepted) {
			throw new Error("expected admission");
		}

		expect(
			validateProjectCoordinatorLease(admitted.state, {
				projectId: "project-1",
				runId: "run-2",
				fencingToken: 1,
			}),
		).toMatchObject({
			valid: false,
			message: "Mutating lease run mismatch.",
		});
	});

	it("rejects canceled or terminal runs", () => {
		const admitted = admitProjectRun(
			createInitialProjectCoordinatorState(),
			admissionInput("run-1", "mutating"),
			now,
		);
		if (!admitted.accepted) {
			throw new Error("expected admission");
		}
		const terminal = observeProjectRunTerminal(
			admitted.state,
			{ projectId: "project-1", runId: "run-1", status: "canceled" },
			now,
		);

		expect(
			validateProjectCoordinatorLease(terminal, {
				projectId: "project-1",
				runId: "run-1",
				fencingToken: 1,
			}),
		).toMatchObject({ valid: false, message: "Mutating run is terminal." });
	});
});

describe("project coordinator restore decisions", () => {
	it("rejects mutating admission while a restore is in progress", () => {
		const restoring = beginProjectRestore(
			createInitialProjectCoordinatorState(),
		);

		const decision = admitProjectRun(
			restoring,
			admissionInput("run-1", "mutating"),
			now,
		);

		expect(decision).toMatchObject({
			accepted: false,
			status: 409,
			message: RESTORE_IN_PROGRESS_MESSAGE,
		});
		expect(decision.state.snapshot.restoring).toBe(true);
		expect(decision.state.mutationLease).toBeNull();
	});

	it("still admits read-only runs while a restore is in progress", () => {
		const restoring = beginProjectRestore(
			createInitialProjectCoordinatorState(),
		);

		const decision = admitProjectRun(
			restoring,
			admissionInput("run-1", "read_only"),
			now,
		);

		expect(decision.accepted).toBe(true);
		if (!decision.accepted) {
			throw new Error("expected read-only admission");
		}
		expect(decision.admission).toMatchObject({
			runId: "run-1",
			capabilities: "read_only",
		});
		expect(decision.state.snapshot.restoring).toBe(true);
		expect(decision.state.activeReadOnlyRuns).toHaveLength(1);
	});

	it("clears restoring and records the snapshot id on end-restore", () => {
		const restoring = beginProjectRestore(
			createInitialProjectCoordinatorState(),
		);

		const restored = endProjectRestore(restoring, "snap-1");

		expect(restored.snapshot.restoring).toBe(false);
		expect(restored.snapshot.latestSnapshotId).toBe("snap-1");
	});

	it("end-restore with a null snapshot id keeps the previous latest snapshot id", () => {
		const withSnapshot = recordLatestSnapshot(
			createInitialProjectCoordinatorState(),
			"snap-1",
		);
		const restoring = beginProjectRestore(withSnapshot);

		const restored = endProjectRestore(restoring, null);

		expect(restored.snapshot.restoring).toBe(false);
		expect(restored.snapshot.latestSnapshotId).toBe("snap-1");
	});

	it("is idempotent when beginning a restore that is already in progress", () => {
		const restoring = beginProjectRestore(
			createInitialProjectCoordinatorState(),
		);

		expect(beginProjectRestore(restoring)).toBe(restoring);
	});

	it("records the latest snapshot without flipping the restoring flag", () => {
		const restoring = beginProjectRestore(
			createInitialProjectCoordinatorState(),
		);

		const recorded = recordLatestSnapshot(restoring, "snap-2");

		expect(recorded.snapshot.restoring).toBe(true);
		expect(recorded.snapshot.latestSnapshotId).toBe("snap-2");
	});

	it("admits a mutating run again once restore ends", () => {
		const restoring = beginProjectRestore(
			createInitialProjectCoordinatorState(),
		);
		const restored = endProjectRestore(restoring, "snap-1");

		const decision = admitProjectRun(
			restored,
			admissionInput("run-1", "mutating"),
			now,
		);

		expect(decision.accepted).toBe(true);
		if (!decision.accepted) {
			throw new Error("expected admission after restore");
		}
		expect(decision.state.mutationLease?.runId).toBe("run-1");
		expect(decision.state.snapshot.restoring).toBe(false);
		expect(decision.state.snapshot.latestSnapshotId).toBe("snap-1");
	});
});
