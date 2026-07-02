import type {
	ProjectCoordinatorMode,
	ProjectCoordinatorTerminalStatus,
} from "#/lib/project-coordinator";

export type ProjectAgentRunInput = {
	projectId: string;
	sessionId: string;
	runId: string;
	userId: string;
	sandboxId: string;
	modelSpecifier: string;
	message: string;
	mode: ProjectCoordinatorMode;
};

export type ProjectAgentAdmission = {
	accepted: true;
	capabilities: "mutating" | "read_only";
	fencingToken?: number;
};

export type ProjectAgentAdmissionRejected = {
	accepted: false;
	message: string;
};

export type ProjectAgentDispatchReceipt = {
	dispatchId: string;
	acceptedAt: string;
};

export type ProjectAgentRunAdapters = {
	coordinator: {
		admit(
			input: Pick<
				ProjectAgentRunInput,
				"projectId" | "sessionId" | "runId" | "userId" | "mode"
			>,
		): Promise<ProjectAgentAdmission | ProjectAgentAdmissionRejected>;
		terminal(input: {
			projectId: string;
			runId: string;
			status: ProjectCoordinatorTerminalStatus;
		}): Promise<void>;
	};
	flue: {
		dispatch(
			input: ProjectAgentRunInput & {
				capabilities: "mutating" | "read_only";
				fencingToken?: number;
			},
		): Promise<ProjectAgentDispatchReceipt>;
	};
};

export type ProjectAgentRunResult =
	| {
			status: "dispatched";
			capabilities: "mutating" | "read_only";
			receipt: ProjectAgentDispatchReceipt;
	  }
	| { status: "conflict"; message: string };

export async function admitAndDispatchProjectAgentRun(
	input: ProjectAgentRunInput,
	adapters: ProjectAgentRunAdapters,
): Promise<ProjectAgentRunResult> {
	const admission = await adapters.coordinator.admit({
		projectId: input.projectId,
		sessionId: input.sessionId,
		runId: input.runId,
		userId: input.userId,
		mode: input.mode,
	});

	if (!admission.accepted) {
		return { status: "conflict", message: admission.message };
	}

	const receipt = await adapters.flue.dispatch({
		...input,
		capabilities: admission.capabilities,
		fencingToken: admission.fencingToken,
	});

	return {
		status: "dispatched",
		capabilities: admission.capabilities,
		receipt,
	};
}

export async function observeProjectAgentTerminal(
	input: {
		projectId: string;
		runId: string;
		status: ProjectCoordinatorTerminalStatus;
	},
	adapters: Pick<ProjectAgentRunAdapters, "coordinator">,
): Promise<void> {
	await adapters.coordinator.terminal(input);
}
