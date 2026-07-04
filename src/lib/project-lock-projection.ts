export type ProjectLockProjectionValues = {
	lockStatus: "free" | "mutating";
	lockHolderRunId: string | null;
	lockFencingToken: number | null;
	lockUpdatedAt: Date;
};

export function acquireMutatingProjectLockProjection(input: {
	runId: string;
	fencingToken: number;
	now: Date;
}): ProjectLockProjectionValues {
	return {
		lockStatus: "mutating",
		lockHolderRunId: input.runId,
		lockFencingToken: input.fencingToken,
		lockUpdatedAt: input.now,
	};
}

export function clearProjectLockProjection(
	now: Date,
): ProjectLockProjectionValues {
	return {
		lockStatus: "free",
		lockHolderRunId: null,
		lockFencingToken: null,
		lockUpdatedAt: now,
	};
}
