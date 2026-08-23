import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

export const RUNNER_MODEL_SPECIFIER =
	"opencode/deepseek-v4-flash-free" as const;

/** Public placeholder. Has no authority without Worker identity + open operation. */
export const OPENCODE_PLACEHOLDER_API_KEY =
	"ditto-public-opencode-placeholder" as const;

export type ParsedModelSpecifier = {
	provider: string;
	modelId: string;
};

export type ResolvedRunnerModel = {
	modelRuntime: ModelRuntime;
	model: NonNullable<ReturnType<ModelRuntime["getModel"]>>;
	provider: string;
	modelId: string;
};

const MODEL_SPECIFIER_MAX = 128;
const FIXED_PROVIDER = "opencode";
const FIXED_MODEL_ID = "deepseek-v4-flash-free";

function scrubCredentialEnv(): void {
	delete process.env.OPENCODE_API_KEY;
}

export function parseModelSpecifier(
	modelSpecifier: string,
): ParsedModelSpecifier | { error: string } {
	if (
		typeof modelSpecifier !== "string" ||
		modelSpecifier.length === 0 ||
		modelSpecifier.length > MODEL_SPECIFIER_MAX ||
		modelSpecifier.includes("\0")
	) {
		return { error: "Unknown model: invalid specifier" };
	}
	if (modelSpecifier !== RUNNER_MODEL_SPECIFIER) {
		return { error: `Unknown model: ${modelSpecifier}` };
	}

	return {
		provider: FIXED_PROVIDER,
		modelId: FIXED_MODEL_ID,
	};
}

/**
 * Resolve the fixed provider/model and seed an in-memory credential store
 * with the public OpenCode placeholder. Env credential values are deleted
 * and never used as the credential.
 */
export async function resolveRunnerModel(
	modelSpecifier: string,
): Promise<ResolvedRunnerModel | { error: string }> {
	const parsed = parseModelSpecifier(modelSpecifier);
	if ("error" in parsed) {
		// Still scrub env so a bad specifier cannot leave secrets for later tools.
		scrubCredentialEnv();
		return parsed;
	}

	const credentials = new InMemoryCredentialStore();
	// Delete before session/tools so bash children cannot inherit leftover secrets.
	scrubCredentialEnv();
	await credentials.modify(
		parsed.provider,
		async () =>
			({
				type: "api_key",
				key: OPENCODE_PLACEHOLDER_API_KEY,
			}) as never,
	);

	const modelRuntime = await ModelRuntime.create({
		credentials,
		modelsPath: null,
		allowModelNetwork: false,
	});
	const model = modelRuntime.getModel(parsed.provider, parsed.modelId);
	if (!model) {
		return { error: `Unknown model: ${modelSpecifier}` };
	}

	return {
		modelRuntime,
		model,
		provider: parsed.provider,
		modelId: parsed.modelId,
	};
}
