import {
	ContractParseError,
	decodeContractInput,
	integerField,
	literalField,
	strictRecord,
	stringField,
} from "./json.js";
import {
	type ModelSubjectV1,
	parseModelSubjectV1,
	type SyntheticModelId,
	type SyntheticThinking,
} from "./model.js";

export type ConfigurationSelectionV1 = {
	model: SyntheticModelId;
	thinking: SyntheticThinking;
};
export type ConfigurationIntentV1 = {
	version: 1;
	intentId: string;
	projectId: string;
	workspaceSessionId: string;
	ownerVersion: number;
	selection: ConfigurationSelectionV1;
};
export type ConfigurationReadV1 = Pick<
	ConfigurationIntentV1,
	"version" | "projectId" | "workspaceSessionId" | "ownerVersion"
>;
export type ConfigurationSnapshotV1 = ConfigurationReadV1 & {
	selection: ConfigurationSelectionV1 | null;
};
export type ConfigurationAckV1 = {
	version: 1;
	intentId: string;
	status: "applied" | "denied" | "conflict" | "unavailable" | "outcome_unknown";
	snapshot: ConfigurationSnapshotV1 | null;
};
export type ConfigurationAuthorityV1 =
	| { version: 1; status: "current"; subject: ModelSubjectV1 }
	| { version: 1; status: "denied" | "unavailable" };

export function parseConfigurationSelectionV1(
	input: unknown,
): ConfigurationSelectionV1 {
	const r = strictRecord(
		input,
		["model", "thinking"],
		"configuration selection",
	);
	return {
		model: literalField(r, "model", ["faux-1", "faux-2"]),
		thinking: literalField(r, "thinking", ["off", "low", "high", "max"]),
	};
}
function scope(r: Record<string, unknown>): ConfigurationReadV1 {
	return {
		version: literalField(r, "version", [1]),
		projectId: stringField(r, "projectId", { maxBytes: 256 }),
		workspaceSessionId: stringField(r, "workspaceSessionId", { maxBytes: 256 }),
		ownerVersion: integerField(r, "ownerVersion", { minimum: 1 }),
	};
}
export function parseConfigurationIntentV1(
	input: unknown,
): ConfigurationIntentV1 {
	const r = strictRecord(
		decodeContractInput(input, 2048),
		[
			"version",
			"intentId",
			"projectId",
			"workspaceSessionId",
			"ownerVersion",
			"selection",
		],
		"configuration intent",
	);
	return {
		...scope(r),
		intentId: stringField(r, "intentId", { maxBytes: 256 }),
		selection: parseConfigurationSelectionV1(r.selection),
	};
}
export function parseConfigurationReadV1(input: unknown): ConfigurationReadV1 {
	return scope(
		strictRecord(
			decodeContractInput(input, 1024),
			["version", "projectId", "workspaceSessionId", "ownerVersion"],
			"configuration read",
		),
	);
}
export function parseConfigurationSnapshotV1(
	input: unknown,
): ConfigurationSnapshotV1 {
	const r = strictRecord(
		decodeContractInput(input, 2048),
		["version", "projectId", "workspaceSessionId", "ownerVersion", "selection"],
		"configuration snapshot",
	);
	return {
		...scope(r),
		selection:
			r.selection === null ? null : parseConfigurationSelectionV1(r.selection),
	};
}
export function parseConfigurationAckV1(input: unknown): ConfigurationAckV1 {
	const r = strictRecord(
		decodeContractInput(input, 4096),
		["version", "intentId", "status", "snapshot"],
		"configuration acknowledgment",
	);
	const status = literalField(r, "status", [
		"applied",
		"denied",
		"conflict",
		"unavailable",
		"outcome_unknown",
	]);
	const snapshot =
		r.snapshot === null ? null : parseConfigurationSnapshotV1(r.snapshot);
	if (
		(status === "applied" && !snapshot?.selection) ||
		(status !== "applied" && snapshot !== null)
	)
		throw new ContractParseError(
			"invalid_configuration_ack",
			"Inconsistent configuration outcome.",
		);
	return {
		version: literalField(r, "version", [1]),
		intentId: stringField(r, "intentId", { maxBytes: 256 }),
		status,
		snapshot,
	};
}
export function parseConfigurationAuthorityV1(
	input: unknown,
): ConfigurationAuthorityV1 {
	const r = strictRecord(
		decodeContractInput(input, 4096),
		["version", "status", "subject"],
		"configuration authority",
	);
	const version = literalField(r, "version", [1]);
	if (r.status === "current")
		return {
			version,
			status: "current",
			subject: parseModelSubjectV1(r.subject),
		};
	strictRecord(r, ["version", "status"], "configuration denial");
	return {
		version,
		status: literalField(r, "status", ["denied", "unavailable"]),
	};
}
export async function configurationIdentity(
	subject: ModelSubjectV1,
	input: unknown,
): Promise<{ key: string; payload: string }> {
	const i = parseConfigurationIntentV1(input);
	const hash = async (v: unknown) =>
		Array.from(
			new Uint8Array(
				await crypto.subtle.digest(
					"SHA-256",
					new TextEncoder().encode(JSON.stringify(v)),
				),
			),
			(x) => x.toString(16).padStart(2, "0"),
		).join("");
	return {
		key: await hash([
			1,
			subject.userId,
			i.projectId,
			i.workspaceSessionId,
			i.ownerVersion,
			i.intentId,
		]),
		payload: await hash([
			1,
			i.projectId,
			i.workspaceSessionId,
			i.ownerVersion,
			i.selection.model,
			i.selection.thinking,
		]),
	};
}
