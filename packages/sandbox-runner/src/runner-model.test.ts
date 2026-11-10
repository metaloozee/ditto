import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	modelRuntimeCreate: vi.fn(),
	getModel: vi.fn(),
	registerProvider: vi.fn(),
	credentialModify: vi.fn(),
}));

vi.mock("@earendil-works/pi-ai", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@earendil-works/pi-ai")>();
	return {
		...actual,
		InMemoryCredentialStore: class {
			modify = mocks.credentialModify.mockImplementation(
				async (
					_providerId: string,
					fn: (current: unknown) => Promise<unknown>,
				) => fn(undefined),
			);
		},
	};
});

vi.mock("@earendil-works/pi-coding-agent", () => ({
	ModelRuntime: {
		create: mocks.modelRuntimeCreate,
	},
}));

import {
	OPENCODE_PLACEHOLDER_API_KEY,
	parseModelSpecifier,
	RUNNER_MODEL_SPECIFIER,
	resolveRunnerModel,
	SANDBOX_MODEL_BASE_URL,
} from "./runner-model.js";

const MODEL_CONFIG = {
	id: "test-model",
	name: "Test model",
	reasoning: true,
	contextWindow: 1000,
	maxTokens: 100,
	thinkingLevelMap: { off: null, high: "high" },
	compat: { supportsStore: false, maxTokensField: "max_tokens" },
};

describe("parseModelSpecifier", () => {
	it("parses the fixed provider", () => {
		expect(parseModelSpecifier(RUNNER_MODEL_SPECIFIER)).toEqual({
			provider: "ditto",
		});
	});

	it("rejects every other specifier", () => {
		expect(parseModelSpecifier("noslash")).toEqual({
			error: "Unknown model: noslash",
		});
		expect(parseModelSpecifier("opencode/some-paid-model")).toEqual({
			error: "Unknown model: opencode/some-paid-model",
		});
	});

	it("rejects NUL and oversize specifiers", () => {
		expect(parseModelSpecifier("a\0b/model")).toEqual({
			error: "Unknown model: invalid specifier",
		});
		expect(parseModelSpecifier(`ditto/${"x".repeat(200)}`)).toEqual({
			error: "Unknown model: invalid specifier",
		});
	});
});

describe("resolveRunnerModel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getModel.mockReturnValue({
			provider: "ditto",
			id: "test-model",
			baseUrl: SANDBOX_MODEL_BASE_URL,
			api: "openai-completions",
		});
		mocks.modelRuntimeCreate.mockResolvedValue({
			getModel: mocks.getModel,
			registerProvider: mocks.registerProvider,
		});
		delete process.env.OPENCODE_API_KEY;
	});

	it("registers the job model under the internal address and seeds the placeholder", async () => {
		process.env.OPENCODE_API_KEY = "legacy-key";
		const resolved = await resolveRunnerModel(
			RUNNER_MODEL_SPECIFIER,
			MODEL_CONFIG,
		);
		expect("error" in resolved).toBe(false);
		if ("error" in resolved) return;

		expect(process.env.OPENCODE_API_KEY).toBeUndefined();
		expect(mocks.credentialModify).toHaveBeenCalledWith(
			"ditto",
			expect.any(Function),
		);
		const seeded = await mocks.credentialModify.mock.calls[0][1](undefined);
		expect(seeded).toEqual({
			type: "api_key",
			key: OPENCODE_PLACEHOLDER_API_KEY,
		});
		expect(mocks.modelRuntimeCreate).toHaveBeenCalledWith({
			credentials: expect.any(Object),
			modelsPath: null,
			allowModelNetwork: false,
		});
		expect(mocks.registerProvider).toHaveBeenCalledWith("ditto", {
			baseUrl: "https://opencode.ai/zen/v1",
			api: "openai-completions",
			models: [
				{
					id: "test-model",
					name: "Test model",
					reasoning: true,
					thinkingLevelMap: MODEL_CONFIG.thinkingLevelMap,
					input: ["text"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 1000,
					maxTokens: 100,
					compat: MODEL_CONFIG.compat,
				},
			],
		});
		expect(mocks.getModel).toHaveBeenCalledWith("ditto", "test-model");
		expect(resolved.provider).toBe("ditto");
		expect(resolved.modelId).toBe("test-model");
	});

	it("fails cleanly for unknown specifiers and scrubs env", async () => {
		process.env.OPENCODE_API_KEY = "secret";
		const resolved = await resolveRunnerModel("bad", MODEL_CONFIG);
		expect(resolved).toEqual({ error: "Unknown model: bad" });
		expect(process.env.OPENCODE_API_KEY).toBeUndefined();
		expect(mocks.modelRuntimeCreate).not.toHaveBeenCalled();
	});

	it("refuses a config carrying baseUrl and scrubs env", async () => {
		process.env.OPENCODE_API_KEY = "secret";
		const resolved = await resolveRunnerModel(RUNNER_MODEL_SPECIFIER, {
			...MODEL_CONFIG,
			baseUrl: "https://llm.example.com/v1",
		});
		expect(resolved).toEqual({ error: "modelConfig is invalid" });
		expect(process.env.OPENCODE_API_KEY).toBeUndefined();
		expect(mocks.registerProvider).not.toHaveBeenCalled();
	});

	it("refuses compat that would widen the broker contract", async () => {
		const resolved = await resolveRunnerModel(RUNNER_MODEL_SPECIFIER, {
			...MODEL_CONFIG,
			compat: { supportsDeveloperRole: true },
		});
		expect(resolved).toEqual({ error: "modelConfig is invalid" });
	});

	it("reports an unknown model when the registered id is not found", async () => {
		mocks.getModel.mockReturnValue(undefined);
		const resolved = await resolveRunnerModel(
			RUNNER_MODEL_SPECIFIER,
			MODEL_CONFIG,
		);
		expect(resolved).toEqual({ error: "Unknown model: ditto/default" });
	});
});
