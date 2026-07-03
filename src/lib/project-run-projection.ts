export type ProjectRunProjection = {
	runId: string;
	status: string;
	mode: "mutating" | "read_only";
	model: string;
	flue: {
		agentName: string;
		agentInstanceId: string;
		submissionId: string;
		streamOffset: string | null;
	} | null;
	errorCode: string | null;
	finishedAt: Date | null;
};

export type ProjectRunProjectionInput = {
	id: string;
	status: string;
	isMutating: boolean;
	modelSpecifier: string;
	flueAgentName: string | null;
	flueAgentInstanceId: string | null;
	flueSubmissionId: string | null;
	flueStreamOffset: string | null;
	errorCode: string | null;
	finishedAt: Date | null;
};

export function hasFluePointer(
	run: Pick<
		ProjectRunProjectionInput,
		"flueAgentInstanceId" | "flueSubmissionId"
	>,
): boolean {
	return Boolean(run.flueAgentInstanceId && run.flueSubmissionId);
}

export function buildRunProjection(
	run: ProjectRunProjectionInput,
): ProjectRunProjection {
	return {
		runId: run.id,
		status: run.status,
		mode: run.isMutating ? "mutating" : "read_only",
		model: run.modelSpecifier,
		flue: hasFluePointer(run)
			? {
					agentName: run.flueAgentName ?? "",
					agentInstanceId: run.flueAgentInstanceId as string,
					submissionId: run.flueSubmissionId as string,
					streamOffset: run.flueStreamOffset,
				}
			: null,
		errorCode: run.errorCode,
		finishedAt: run.finishedAt,
	};
}
