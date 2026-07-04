import { describe, expect, it } from "vitest";
import {
	buildRunProjection,
	hasFluePointer,
	type ProjectRunProjectionInput,
} from "./project-run-projection";

function runInput(
	overrides: Partial<ProjectRunProjectionInput> = {},
): ProjectRunProjectionInput {
	return {
		id: "run-1",
		status: "running",
		isMutating: true,
		modelSpecifier: "opencode-go/qwen3.7-plus",
		flueAgentName: null,
		flueAgentInstanceId: null,
		flueSubmissionId: null,
		flueStreamOffset: null,
		errorCode: null,
		finishedAt: null,
		...overrides,
	};
}

describe("project run projection", () => {
	it("reports a Flue pointer when agent instance and submission are present", () => {
		expect(
			hasFluePointer({
				flueAgentName: "project-coder",
				flueAgentInstanceId: "project-1:sandbox-1",
				flueSubmissionId: "submission-1",
				flueStreamOffset: null,
			}),
		).toBe(true);
	});

	it("reports a Flue pointer when stream offset exists without submission id", () => {
		expect(
			hasFluePointer({
				flueAgentName: "project-coder",
				flueAgentInstanceId: "project-1:sandbox-1",
				flueSubmissionId: null,
				flueStreamOffset: "42",
			}),
		).toBe(true);
	});

	it("reports no Flue pointer when agent identity is missing", () => {
		expect(
			hasFluePointer({
				flueAgentName: null,
				flueAgentInstanceId: "project-1:sandbox-1",
				flueSubmissionId: "submission-1",
				flueStreamOffset: "42",
			}),
		).toBe(false);
		expect(
			hasFluePointer({
				flueAgentName: "project-coder",
				flueAgentInstanceId: null,
				flueSubmissionId: "submission-1",
				flueStreamOffset: "42",
			}),
		).toBe(false);
		expect(
			hasFluePointer({
				flueAgentName: "project-coder",
				flueAgentInstanceId: "project-1:sandbox-1",
				flueSubmissionId: null,
				flueStreamOffset: null,
			}),
		).toBe(false);
	});

	it("builds a projection with a populated Flue pointer", () => {
		const projection = buildRunProjection(
			runInput({
				flueAgentName: "project-coder",
				flueAgentInstanceId: "project-1:sandbox-1",
				flueSubmissionId: "submission-1",
				flueStreamOffset: "42",
			}),
		);

		expect(projection).toEqual({
			runId: "run-1",
			status: "running",
			mode: "mutating",
			model: "opencode-go/qwen3.7-plus",
			flue: {
				agentName: "project-coder",
				agentInstanceId: "project-1:sandbox-1",
				submissionId: "submission-1",
				streamOffset: "42",
			},
			errorCode: null,
			finishedAt: null,
		});
	});

	it("builds a projection with stream coordinates and a null submission id", () => {
		const projection = buildRunProjection(
			runInput({
				flueAgentName: "project-coder",
				flueAgentInstanceId: "project-1:sandbox-1",
				flueSubmissionId: null,
				flueStreamOffset: "42",
			}),
		);

		expect(projection.flue).toEqual({
			agentName: "project-coder",
			agentInstanceId: "project-1:sandbox-1",
			submissionId: null,
			streamOffset: "42",
		});
	});

	it("builds a projection with a null Flue pointer when missing", () => {
		const projection = buildRunProjection(runInput());

		expect(projection.flue).toBeNull();
		expect(projection.mode).toBe("mutating");
	});

	it("maps isMutating false to read-only mode", () => {
		const projection = buildRunProjection(runInput({ isMutating: false }));

		expect(projection.mode).toBe("read_only");
	});

	it("carries error code and finish timestamp", () => {
		const finishedAt = new Date("2026-07-02T00:00:00.000Z");
		const projection = buildRunProjection(
			runInput({ status: "failed", errorCode: "timeout", finishedAt }),
		);

		expect(projection.status).toBe("failed");
		expect(projection.errorCode).toBe("timeout");
		expect(projection.finishedAt).toBe(finishedAt);
	});
});
