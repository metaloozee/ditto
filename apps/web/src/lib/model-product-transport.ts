import {
	type ModelTransportDescriptorV1,
	parseModelTransportDescriptorV1,
	SYNTHETIC_MODEL_LIMITS,
	type SyntheticModelOutcomeV1,
} from "../../../../packages/runtime-contracts/src/model.js";
import {
	awaitSynthetic,
	reconstructSyntheticRequest,
	syntheticRequestDigest,
} from "./codex-request-contract";
import {
	type ModelClaimRpc,
	ModelProductAuthority,
} from "./model-product-authority";

export type ModelProductBindings = {
	DB: D1Database;
	CodexCredential: {
		getByName(owner: string): {
			status(owner: string): Promise<{ status: string; generation: number }>;
			requestModel(
				input: unknown,
				capability: ModelClaimRpc,
			): Promise<SyntheticModelOutcomeV1>;
		};
	};
};

export async function performPrivateModelRequest(
	env: ModelProductBindings,
	input: unknown,
	capability: ModelClaimRpc,
	fixtureAvailable: boolean,
): Promise<SyntheticModelOutcomeV1> {
	if (!fixtureAvailable) return { version: 1, status: "unavailable" };
	try {
		const d = parseModelTransportDescriptorV1(
			await awaitSynthetic(
				capability.describe(),
				AbortSignal.timeout(SYNTHETIC_MODEL_LIMITS.deadlineMs),
			),
		);
		return await env.CodexCredential.getByName(d.subject.userId).requestModel(
			input,
			capability,
		);
	} catch {
		return { version: 1, status: "denied" };
	}
}

export async function readPrivateModelPermit(
	db: D1Database,
	input: unknown,
	descriptor: ModelTransportDescriptorV1,
	fixtureAvailable: boolean,
): Promise<{ status: "current" | "denied" }> {
	if (!fixtureAvailable) return { status: "denied" };
	try {
		const d = parseModelTransportDescriptorV1(descriptor);
		const { body, request } = reconstructSyntheticRequest(input);
		if ((await syntheticRequestDigest(request)) !== d.requestDigest)
			return { status: "denied" };
		return {
			status: (await new ModelProductAuthority(db).permit(d, body))
				? "current"
				: "denied",
		};
	} catch {
		return { status: "denied" };
	}
}
