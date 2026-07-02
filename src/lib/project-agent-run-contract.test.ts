import { describe, expect, it, vi } from "vitest";
import {
	admitAndDispatchProjectAgentRun,
	observeProjectAgentTerminal,
	type ProjectAgentRunAdapters,
	type ProjectAgentRunInput,
} from "./project-agent-run-contract";

const runInput: ProjectAgentRunInput = {
	projectId: "project-1",
	sessionId: "session-1",
	runId: "run-1",
	userId: "user-1",
	sandboxId: "sandbox-project-1",
	modelSpecifier: "anthropic/claude-sonnet-4-6",
	message: "Inspect the repo",
	mode: "mutating",
};

function createAdapters(
	admission: Awaited<ReturnType<ProjectAgentRunAdapters["coordinator"]["admit"]>>,
) {
	const calls: string[] = [];
	const adapters: ProjectAgentRunAdapters = {
		coordinator: {
			admit: vi.fn(async () => {
				calls.push("admit");
				return admission;
			}),
			terminal: vi.fn(async () => {
				calls.push("terminal");
			}),
		},
		flue: {
			dispatch: vi.fn(async () => {
				calls.push("dispatch");
				return {
					dispatchId: "dispatch-1",
					acceptedAt: "2026-07-02T00:00:00.000Z",
				};
			}),
		},
	};

	return { adapters, calls };
}

describe("project agent run contract", () => {
	it("admits before dispatching a mutating run", async () => {
		const { adapters, calls } = createAdapters({
			accepted: true,
			capabilities: "mutating",
			fencingToken: 7,
		});

		const result = await admitAndDispatchProjectAgentRun(runInput, adapters);

		expect(result).toMatchObject({
			status: "dispatched",
			capabilities: "mutating",
		});
		expect(calls).toEqual(["admit", "dispatch"]);
		expect(adapters.coordinator.admit).toHaveBeenCalledWith({
			projectId: "project-1",
			sessionId: "session-1",
			runId: "run-1",
			userId: "user-1",
			mode: "mutating",
		});
		expect(adapters.flue.dispatch).toHaveBeenCalledWith({
			...runInput,
			capabilities: "mutating",
			fencingToken: 7,
		});
	});

	it("does not dispatch when mutating admission is rejected", async () => {
		const { adapters } = createAdapters({
			accepted: false,
			message: "Another mutating run already holds the project lease.",
		});

		const result = await admitAndDispatchProjectAgentRun(runInput, adapters);

		expect(result).toEqual({
			status: "conflict",
			message: "Another mutating run already holds the project lease.",
		});
		expect(adapters.flue.dispatch).not.toHaveBeenCalled();
	});

	it("represents read-only admission without mutating capabilities", async () => {
		const { adapters } = createAdapters({
			accepted: true,
			capabilities: "read_only",
		});

		const result = await admitAndDispatchProjectAgentRun(
			{ ...runInput, mode: "read_only" },
			adapters,
		);

		expect(result).toMatchObject({
			status: "dispatched",
			capabilities: "read_only",
		});
		expect(adapters.flue.dispatch).toHaveBeenCalledWith(
			expect.objectContaining({
				mode: "read_only",
				capabilities: "read_only",
			}),
		);
	});

	it("projects terminal events back through the coordinator", async () => {
		const { adapters, calls } = createAdapters({
			accepted: true,
			capabilities: "mutating",
		});

		await observeProjectAgentTerminal(
			{ projectId: "project-1", runId: "run-2", status: "failed" },
			adapters,
		);

		expect(calls).toEqual(["terminal"]);
		expect(adapters.coordinator.terminal).toHaveBeenCalledWith({
			projectId: "project-1",
			runId: "run-2",
			status: "failed",
		});
	});
});
