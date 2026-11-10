import {
	type ModelOutcomeV2,
	type ModelTransportDescriptorV1,
	parseModelTransportDescriptorV1,
	SYNTHETIC_MODEL_LIMITS,
} from "../../../../packages/runtime-contracts/src/model.js";
import {
	awaitSynthetic,
	modelRequestDigest,
	reconstructModelRequest,
} from "./codex-request-contract";
import {
	type CANDIDATE_MODEL_POLICY,
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
			): Promise<ModelOutcomeV2>;
		};
	};
};

export async function performPrivateModelRequest(
	env: ModelProductBindings,
	input: unknown,
	capability: ModelClaimRpc,
	fixtureAvailable: boolean,
): Promise<ModelOutcomeV2> {
	if (!fixtureAvailable) return { version: 2, status: "unavailable" };
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
		return { version: 2, status: "denied" };
	}
}

export async function readPrivateModelPermit(
	db: D1Database,
	input: unknown,
	descriptor: ModelTransportDescriptorV1,
	fixtureAvailable: boolean,
	candidatePolicy?: typeof CANDIDATE_MODEL_POLICY,
): Promise<{ status: "current" | "denied" }> {
	if (!fixtureAvailable) return { status: "denied" };
	try {
		const d = parseModelTransportDescriptorV1(descriptor);
		const { request } = reconstructModelRequest(input);
		if ((await modelRequestDigest(request)) !== d.requestDigest)
			return { status: "denied" };
		return {
			status: (await new ModelProductAuthority(
				db,
				Date.now,
				candidatePolicy,
			).permit(d, request))
				? "current"
				: "denied",
		};
	} catch {
		return { status: "denied" };
	}
}
