import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	modelRuntimeCreate: vi.fn(),
	getModel: vi.fn(),
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
} from "./runner-model.js";

describe("parseModelSpecifier", () => {
	it("parses the fixed provider/model", () => {
		expect(parseModelSpecifier(RUNNER_MODEL_SPECIFIER)).toEqual({
			provider: "opencode",
			modelId: "deepseek-v4-flash-free",
		});
	});

	it("rejects every other specifier", () => {
		expect(parseModelSpecifier("noslash")).toEqual({
			error: "Unknown model: noslash",
		});
		expect(parseModelSpecifier("provider/model")).toEqual({
			error: "Unknown model: provider/model",
		});
		expect(parseModelSpecifier("opencode/some-paid-model")).toEqual({
			error: "Unknown model: opencode/some-paid-model",
		});
	});

	it("rejects NUL and oversize specifiers", () => {
		expect(parseModelSpecifier("a\0b/model")).toEqual({
			error: "Unknown model: invalid specifier",
		});
		expect(parseModelSpecifier(`opencode/${"x".repeat(200)}`)).toEqual({
			error: "Unknown model: invalid specifier",
		});
	});
});

describe("resolveRunnerModel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getModel.mockReturnValue({
			provider: "opencode",
			id: "deepseek-v4-flash-free",
		});
		mocks.modelRuntimeCreate.mockResolvedValue({ getModel: mocks.getModel });
		delete process.env.OPENCODE_API_KEY;
		delete process.env.DITTO_PI_CREDENTIAL;
	});

	it("seeds the public placeholder and deletes leftover credential env vars", async () => {
		process.env.DITTO_PI_CREDENTIAL = JSON.stringify({
			type: "api_key",
			key: "test-opencode-key",
		});
		process.env.OPENCODE_API_KEY = "legacy-key";
		const resolved = await resolveRunnerModel(RUNNER_MODEL_SPECIFIER);
		expect("error" in resolved).toBe(false);
		if ("error" in resolved) return;

		expect(process.env.DITTO_PI_CREDENTIAL).toBeUndefined();
		expect(process.env.OPENCODE_API_KEY).toBeUndefined();
		expect(mocks.credentialModify).toHaveBeenCalledWith(
			"opencode",
			expect.any(Function),
		);
		const seeded = await mocks.credentialModify.mock.calls[0][1](undefined);
		expect(seeded).toEqual({
			type: "api_key",
			key: OPENCODE_PLACEHOLDER_API_KEY,
		});
		expect(seeded).not.toEqual({ type: "api_key", key: "test-opencode-key" });
		expect(seeded).not.toEqual({ type: "api_key", key: "legacy-key" });
		expect(mocks.modelRuntimeCreate).toHaveBeenCalledWith({
			credentials: expect.any(Object),
			modelsPath: null,
			allowModelNetwork: false,
		});
		expect(resolved.model).toEqual({
			provider: "opencode",
			id: "deepseek-v4-flash-free",
		});
	});

	it("does not seed leftover OPENCODE_API_KEY as the credential", async () => {
		process.env.OPENCODE_API_KEY = "legacy-key";
		const resolved = await resolveRunnerModel(RUNNER_MODEL_SPECIFIER);
		expect("error" in resolved).toBe(false);
		const seeded = await mocks.credentialModify.mock.calls[0][1](undefined);
		expect(seeded).toEqual({
			type: "api_key",
			key: OPENCODE_PLACEHOLDER_API_KEY,
		});
		expect(process.env.OPENCODE_API_KEY).toBeUndefined();
	});

	it("fails cleanly for unknown models and still scrubs env", async () => {
		process.env.DITTO_PI_CREDENTIAL = JSON.stringify({
			type: "api_key",
			key: "secret",
		});
		const resolved = await resolveRunnerModel("provider/missing");
		expect(resolved).toEqual({ error: "Unknown model: provider/missing" });
		expect(process.env.DITTO_PI_CREDENTIAL).toBeUndefined();
		expect(mocks.modelRuntimeCreate).not.toHaveBeenCalled();
	});

	it("scrubs env even when the specifier is invalid", async () => {
		process.env.DITTO_PI_CREDENTIAL = "secret";
		const resolved = await resolveRunnerModel("bad");
		expect(resolved).toEqual({ error: "Unknown model: bad" });
		expect(process.env.DITTO_PI_CREDENTIAL).toBeUndefined();
		expect(process.env.OPENCODE_API_KEY).toBeUndefined();
		expect(mocks.modelRuntimeCreate).not.toHaveBeenCalled();
	});
});
