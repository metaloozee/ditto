import { describe, expect, it } from "vitest";
import {
	type DefaultModelConfig,
	defaultModelUpstreamUrl,
	parseDefaultModelConfig,
	readDefaultModel,
	toRunnerModelConfig,
} from "#/lib/default-model";

const VALID = {
	baseUrl: "https://opencode.ai/zen/v1",
	id: "deepseek-v4-flash",
	name: "DeepSeek V4 Flash",
	reasoning: true,
	contextWindow: 1000000,
	maxTokens: 384000,
	thinkingLevelMap: {
		off: null,
		minimal: null,
		low: "low",
		medium: null,
		high: "high",
		xhigh: null,
		max: "max",
	},
	compat: {
		supportsStore: false,
		supportsDeveloperRole: false,
		maxTokensField: "max_tokens",
		supportsLongCacheRetention: false,
		requiresReasoningContentOnAssistantMessages: true,
	},
};

describe("parseDefaultModelConfig", () => {
	it("accepts the documented configuration", () => {
		expect(parseDefaultModelConfig(VALID)).toEqual(VALID);
	});

	it.each([
		["http base URL", { baseUrl: "http://opencode.ai/zen/v1" }],
		["base URL with query", { baseUrl: "https://opencode.ai/zen/v1?x=1" }],
		[
			"base URL with trailing slash",
			{ baseUrl: "https://opencode.ai/zen/v1/" },
		],
		["unknown top-level key", { extra: 1 }],
		["unknown compat key", { compat: { ...VALID.compat, extra: true } }],
		[
			"developer role enabled",
			{ compat: { ...VALID.compat, supportsDeveloperRole: true } },
		],
		[
			"max_completion_tokens",
			{ compat: { ...VALID.compat, maxTokensField: "max_completion_tokens" } },
		],
		["id with a space", { id: "deepseek v4" }],
		["zero context window", { contextWindow: 0 }],
		["unknown thinking level", { thinkingLevelMap: { turbo: "x" } }],
	])("rejects %s", (_label, patch) => {
		expect(parseDefaultModelConfig({ ...VALID, ...patch })).toBeNull();
	});

	it("rejects non-object input", () => {
		expect(parseDefaultModelConfig("x")).toBeNull();
		expect(parseDefaultModelConfig(null)).toBeNull();
		expect(parseDefaultModelConfig([VALID])).toBeNull();
	});
});

describe("readDefaultModel", () => {
	const DEFAULT_MODEL = JSON.stringify(VALID);

	it("returns config and trimmed key", () => {
		const result = readDefaultModel({
			DEFAULT_MODEL,
			DEFAULT_MODEL_API_KEY: " k ",
		});
		expect(result?.apiKey).toBe("k");
		expect(result?.config.id).toBe("deepseek-v4-flash");
	});

	it("returns null for invalid JSON, missing model, or blank key", () => {
		expect(
			readDefaultModel({ DEFAULT_MODEL: "{", DEFAULT_MODEL_API_KEY: "k" }),
		).toBeNull();
		expect(readDefaultModel({ DEFAULT_MODEL_API_KEY: "k" })).toBeNull();
		expect(
			readDefaultModel({ DEFAULT_MODEL: "", DEFAULT_MODEL_API_KEY: "k" }),
		).toBeNull();
		expect(
			readDefaultModel({ DEFAULT_MODEL, DEFAULT_MODEL_API_KEY: "  " }),
		).toBeNull();
	});
});

describe("defaultModelUpstreamUrl", () => {
	it("appends /chat/completions", () => {
		expect(defaultModelUpstreamUrl(VALID as DefaultModelConfig).href).toBe(
			"https://opencode.ai/zen/v1/chat/completions",
		);
	});
});

describe("toRunnerModelConfig", () => {
	it("drops baseUrl", () => {
		expect(toRunnerModelConfig(VALID as DefaultModelConfig)).not.toHaveProperty(
			"baseUrl",
		);
	});
});
