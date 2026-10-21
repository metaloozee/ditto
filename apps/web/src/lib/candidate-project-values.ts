import {
	PROJECT_VALUE_LIMITS,
	type ProjectValueDenial,
	type ProjectValueGrantV1,
	type ProjectValueRequestV1,
	parseProjectValueRequestV1,
	parseProjectValues,
} from "../../../../packages/runtime-contracts/src/project-values.js";
import { decryptText } from "./crypto";

type DeliveryAuthority = {
	current: boolean;
	generation: number;
	liveExecutors?: number;
};

/**
 * Product side of execution-only project values. Values are decrypted only
 * for an admitted repository command of the caller's owned, current session,
 * and only while its operation deadline holds. Authority and the deadline are
 * checked again after decryption, so a revocation during preparation denies.
 */
export async function deliverCandidateProjectValues(input: {
	workspaceSessionId: string;
	request: unknown;
	authority: () => Promise<DeliveryAuthority>;
	/** The owned project's encrypted values, or null when it has none. */
	ciphertext: () => Promise<string | null>;
	secret: string;
	now?: () => number;
}): Promise<ProjectValueGrantV1> {
	const now = input.now ?? Date.now;
	let request: ProjectValueRequestV1;
	try {
		request = parseProjectValueRequestV1(input.request);
	} catch {
		const operationId =
			input.request &&
			typeof input.request === "object" &&
			"operationId" in input.request &&
			typeof input.request.operationId === "string"
				? input.request.operationId.slice(0, 512)
				: "invalid";
		return deny(operationId, "invalid");
	}
	const id = request.operationId;
	if (request.role !== "repository_command") return deny(id, "role");
	if (request.workspaceSessionId !== input.workspaceSessionId)
		return deny(id, "scope");
	const fresh = async (): Promise<ProjectValueDenial | undefined> => {
		const at = now();
		if (
			at >= request.deadlineAt ||
			request.deadlineAt - at > PROJECT_VALUE_LIMITS.maxRemainingMs
		)
			return "expired";
		const authority = await input.authority().catch(() => undefined);
		if (
			!authority?.current ||
			authority.generation !== request.executorGeneration ||
			(authority.liveExecutors ?? 1) !== 1
		)
			return "authority";
		return now() >= request.deadlineAt ? "expired" : undefined;
	};
	const before = await fresh();
	if (before) return deny(id, before);
	let values: { key: string; value: string }[];
	try {
		const ciphertext = await input.ciphertext();
		values = ciphertext
			? parseProjectValues(
					JSON.parse(await decryptText(ciphertext, input.secret)),
				)
			: [];
	} catch {
		return deny(id, "unavailable");
	}
	const after = await fresh();
	if (after) return deny(id, after);
	return { version: 1, operationId: id, status: "granted", values };
}

function deny(
	operationId: string,
	reason: ProjectValueDenial,
): ProjectValueGrantV1 {
	return { version: 1, operationId, status: "denied", reason };
}

/** The owned, ready project's encrypted values for a candidate session. */
export function candidateProjectCiphertext(
	db: D1Database,
	scope: { userId: string; projectId: string; workspaceSessionId: string },
) {
	return async () => {
		const row = await db
			.prepare(
				"SELECT p.envVars FROM projects p JOIN workspace_sessions s ON s.projectId=p.id WHERE p.id=? AND p.userId=? AND s.id=? AND s.userId=p.userId AND p.status='ready'",
			)
			.bind(scope.projectId, scope.userId, scope.workspaceSessionId)
			.first<{ envVars: string | null }>();
		if (!row) throw new Error("Project values unavailable");
		return row.envVars;
	};
}
