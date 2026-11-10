import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

export const RUNNER_MODEL_SPECIFIER = "ditto/default" as const;

/**
 * Internal address the sandbox calls. The Worker's outbound handler intercepts
 * it and forwards to the operator-configured endpoint; it is never contacted
 * directly.
 */
export const SANDBOX_MODEL_BASE_URL = "https://opencode.ai/zen/v1" as const;

const PROVIDER_ID = "ditto";

const THINKING_LEVEL_KEYS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;
type ThinkingLevelKey = (typeof THINKING_LEVEL_KEYS)[number];

/** Operator model configuration without the endpoint, which the runner never sees. */
export type RunnerModelConfig = {
	id: string;
	name: string;
	reasoning: boolean;
	contextWindow: number;
	maxTokens: number;
	thinkingLevelMap?: Partial<Record<ThinkingLevelKey, string | null>>;
	compat?: {
		supportsStore?: false;
		supportsDeveloperRole?: false;
		maxTokensField?: "max_tokens";
		supportsLongCacheRetention?: boolean;
		requiresReasoningContentOnAssistantMessages?: boolean;
	};
};

const CONFIG_KEYS = new Set([
	"id",
	"name",
	"reasoning",
	"contextWindow",
	"maxTokens",
	"thinkingLevelMap",
	"compat",
]);
const COMPAT_KEYS = new Set([
	"supportsStore",
	"supportsDeveloperRole",
	"maxTokensField",
	"supportsLongCacheRetention",
	"requiresReasoningContentOnAssistantMessages",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** Same rules as the Worker parser, except `baseUrl` is refused. */
export function parseRunnerModelConfig(raw: unknown): RunnerModelConfig | null {
	if (!isRecord(raw)) return null;
	for (const key of Object.keys(raw)) {
		if (!CONFIG_KEYS.has(key)) return null;
	}
	const { id, name, reasoning, contextWindow, maxTokens } = raw;
	if (
		typeof id !== "string" ||
		id.length < 1 ||
		id.length > 128 ||
		!/^[A-Za-z0-9._:/-]+$/.test(id)
	) {
		return null;
	}
	if (typeof name !== "string" || name.length < 1 || name.length > 80) {
		return null;
	}
	if (typeof reasoning !== "boolean") return null;
	if (!isPositiveInteger(contextWindow) || !isPositiveInteger(maxTokens)) {
		return null;
	}
	const config: RunnerModelConfig = {
		id,
		name,
		reasoning,
		contextWindow,
		maxTokens,
	};
	if ("thinkingLevelMap" in raw) {
		if (!isRecord(raw.thinkingLevelMap)) return null;
		const map: Partial<Record<ThinkingLevelKey, string | null>> = {};
		for (const [key, entry] of Object.entries(raw.thinkingLevelMap)) {
			if (!(THINKING_LEVEL_KEYS as readonly string[]).includes(key)) {
				return null;
			}
			if (entry !== null && typeof entry !== "string") return null;
			map[key as ThinkingLevelKey] = entry;
		}
		config.thinkingLevelMap = map;
	}
	if ("compat" in raw) {
		const value = raw.compat;
		if (!isRecord(value)) return null;
		for (const key of Object.keys(value)) {
			if (!COMPAT_KEYS.has(key)) return null;
		}
		const compat: NonNullable<RunnerModelConfig["compat"]> = {};
		if ("supportsStore" in value) {
			if (value.supportsStore !== false) return null;
			compat.supportsStore = false;
		}
		if ("supportsDeveloperRole" in value) {
			if (value.supportsDeveloperRole !== false) return null;
			compat.supportsDeveloperRole = false;
		}
		if ("maxTokensField" in value) {
			if (value.maxTokensField !== "max_tokens") return null;
			compat.maxTokensField = "max_tokens";
		}
		for (const key of [
			"supportsLongCacheRetention",
			"requiresReasoningContentOnAssistantMessages",
		] as const) {
			if (key in value) {
				if (typeof value[key] !== "boolean") return null;
				compat[key] = value[key];
			}
		}
		config.compat = compat;
	}
	return config;
}

/** Public placeholder. Has no authority without Worker identity + open operation. */
export const OPENCODE_PLACEHOLDER_API_KEY =
	"ditto-public-opencode-placeholder" as const;

export type ParsedModelSpecifier = {
	provider: string;
};

export type ResolvedRunnerModel = {
	modelRuntime: ModelRuntime;
	model: NonNullable<ReturnType<ModelRuntime["getModel"]>>;
	provider: string;
	modelId: string;
};

const MODEL_SPECIFIER_MAX = 128;

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

	return { provider: PROVIDER_ID };
}

/**
 * Register the job's default model under the internal provider and seed an
 * in-memory credential store with the public placeholder. Env credential
 * values are deleted and never used as the credential.
 */
export async function resolveRunnerModel(
	modelSpecifier: string,
	modelConfig: unknown,
): Promise<ResolvedRunnerModel | { error: string }> {
	const parsed = parseModelSpecifier(modelSpecifier);
	if ("error" in parsed) {
		// Still scrub env so a bad specifier cannot leave secrets for later tools.
		scrubCredentialEnv();
		return parsed;
	}
	const config = parseRunnerModelConfig(modelConfig);
	if (!config) {
		scrubCredentialEnv();
		return { error: "modelConfig is invalid" };
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
	modelRuntime.registerProvider(parsed.provider, {
		baseUrl: SANDBOX_MODEL_BASE_URL,
		api: "openai-completions",
		models: [
			{
				id: config.id,
				name: config.name,
				reasoning: config.reasoning,
				thinkingLevelMap: config.thinkingLevelMap,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: config.contextWindow,
				maxTokens: config.maxTokens,
				compat: config.compat,
			},
		],
	});
	const model = modelRuntime.getModel(parsed.provider, config.id);
	if (!model) {
		return { error: `Unknown model: ${modelSpecifier}` };
	}

	return {
		modelRuntime,
		model,
		provider: parsed.provider,
		modelId: config.id,
	};
}
