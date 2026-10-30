import { literalField, strictRecord, stringField } from "./json.js";

export type CandidateRuntimeScope = {
	version: 2;
	userId: string;
	projectId: string;
	workspaceSessionId: string;
	ownerVersion: 1;
};

export function parseCandidateRuntimeScope(
	value: unknown,
): CandidateRuntimeScope {
	const row = strictRecord(
		value,
		["version", "userId", "projectId", "workspaceSessionId", "ownerVersion"],
		"Candidate runtime scope",
	);
	return {
		version: literalField(row, "version", [2]),
		userId: stringField(row, "userId"),
		projectId: stringField(row, "projectId"),
		workspaceSessionId: stringField(row, "workspaceSessionId"),
		ownerVersion: literalField(row, "ownerVersion", [1]),
	};
}
