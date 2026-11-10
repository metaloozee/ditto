import { PI_THINKING_LEVELS, type PiThinkingLevel } from "#/lib/agent-models";

/** Ditto-side specifier stored in messages and job `model` fields. */
export const DEFAULT_MODEL_SPECIFIER = "ditto/default" as const;

/**
 * Operator-configured default model (the `DEFAULT_MODEL` JSON binding).
 * Upstream is `${baseUrl}/chat/completions`. `compat` is restricted to values
 * that keep pi's requests inside the sandbox egress broker contract.
 */
export type DefaultModelConfig = {
	baseUrl: string;
	id: string;
	name: string;
	reasoning: boolean;
	contextWindow: number;
	maxTokens: number;
	thinkingLevelMap?: Partial<Record<PiThinkingLevel, string | null>>;
	compat?: {
		supportsStore?: false;
		supportsDeveloperRole?: false;
		maxTokensField?: "max_tokens";
		supportsLongCacheRetention?: boolean;
		requiresReasoningContentOnAssistantMessages?: boolean;
	};
};

/** The runner never receives the endpoint. */
export type RunnerModelConfig = Omit<DefaultModelConfig, "baseUrl">;

const TOP_KEYS = new Set([
	"baseUrl",
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
const ID_PATTERN = /^[A-Za-z0-9._:/-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function parseBaseUrl(value: unknown): string | null {
	if (typeof value !== "string" || value.endsWith("/")) return null;
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	if (url.protocol !== "https:" || url.search || url.hash) return null;
	return value;
}

function parseThinkingLevelMap(
	value: unknown,
): DefaultModelConfig["thinkingLevelMap"] | null {
	if (!isRecord(value)) return null;
	const out: Partial<Record<PiThinkingLevel, string | null>> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (!(PI_THINKING_LEVELS as readonly string[]).includes(key)) return null;
		if (entry !== null && typeof entry !== "string") return null;
		out[key as PiThinkingLevel] = entry;
	}
	return out;
}

function parseCompat(value: unknown): DefaultModelConfig["compat"] | null {
	if (!isRecord(value)) return null;
	for (const key of Object.keys(value)) {
		if (!COMPAT_KEYS.has(key)) return null;
	}
	const out: NonNullable<DefaultModelConfig["compat"]> = {};
	if ("supportsStore" in value) {
		if (value.supportsStore !== false) return null;
		out.supportsStore = false;
	}
	if ("supportsDeveloperRole" in value) {
		if (value.supportsDeveloperRole !== false) return null;
		out.supportsDeveloperRole = false;
	}
	if ("maxTokensField" in value) {
		if (value.maxTokensField !== "max_tokens") return null;
		out.maxTokensField = "max_tokens";
	}
	for (const key of [
		"supportsLongCacheRetention",
		"requiresReasoningContentOnAssistantMessages",
	] as const) {
		if (key in value) {
			if (typeof value[key] !== "boolean") return null;
			out[key] = value[key];
		}
	}
	return out;
}

export function parseDefaultModelConfig(
	raw: unknown,
): DefaultModelConfig | null {
	if (!isRecord(raw)) return null;
	for (const key of Object.keys(raw)) {
		if (!TOP_KEYS.has(key)) return null;
	}
	const baseUrl = parseBaseUrl(raw.baseUrl);
	if (baseUrl === null) return null;
	const { id, name, reasoning, contextWindow, maxTokens } = raw;
	if (
		typeof id !== "string" ||
		id.length < 1 ||
		id.length > 128 ||
		!ID_PATTERN.test(id)
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
	const config: DefaultModelConfig = {
		baseUrl,
		id,
		name,
		reasoning,
		contextWindow,
		maxTokens,
	};
	if ("thinkingLevelMap" in raw) {
		const map = parseThinkingLevelMap(raw.thinkingLevelMap);
		if (map === null || map === undefined) return null;
		config.thinkingLevelMap = map;
	}
	if ("compat" in raw) {
		const compat = parseCompat(raw.compat);
		if (compat === null || compat === undefined) return null;
		config.compat = compat;
	}
	return config;
}

export function readDefaultModel(env: {
	DEFAULT_MODEL?: string;
	DEFAULT_MODEL_API_KEY?: string;
}): { config: DefaultModelConfig; apiKey: string } | null {
	const apiKey = env.DEFAULT_MODEL_API_KEY?.trim();
	if (!apiKey || !env.DEFAULT_MODEL) return null;
	let raw: unknown;
	try {
		raw = JSON.parse(env.DEFAULT_MODEL);
	} catch {
		return null;
	}
	const config = parseDefaultModelConfig(raw);
	return config ? { config, apiKey } : null;
}

export function defaultModelUpstreamUrl(config: DefaultModelConfig): URL {
	return new URL(`${config.baseUrl}/chat/completions`);
}

export function toRunnerModelConfig(
	config: DefaultModelConfig,
): RunnerModelConfig {
	const { baseUrl: _baseUrl, ...rest } = config;
	return rest;
}
