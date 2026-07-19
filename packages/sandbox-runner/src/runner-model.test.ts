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

import { parseModelSpecifier, resolveRunnerModel } from "./runner-model.js";

describe("parseModelSpecifier", () => {
	it("parses provider/model", () => {
		expect(parseModelSpecifier("opencode/deepseek-v4-flash-free")).toEqual({
			provider: "opencode",
			modelId: "deepseek-v4-flash-free",
		});
	});

	it("rejects missing slash or empty parts", () => {
		expect(parseModelSpecifier("noslash")).toEqual({
			error: "Unknown model: noslash",
		});
		expect(parseModelSpecifier("/model")).toEqual({
			error: "Unknown model: /model",
		});
		expect(parseModelSpecifier("provider/")).toEqual({
			error: "Unknown model: provider/",
		});
	});
});

describe("resolveRunnerModel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getModel.mockReturnValue({ provider: "provider", id: "model" });
		mocks.modelRuntimeCreate.mockResolvedValue({ getModel: mocks.getModel });
		delete process.env.OPENCODE_API_KEY;
		delete process.env.DITTO_PI_CREDENTIAL;
	});

	it("seeds the selected provider in memory and deletes credential env vars", async () => {
		process.env.DITTO_PI_CREDENTIAL = JSON.stringify({
			type: "api_key",
			key: "test-opencode-key",
		});
		const resolved = await resolveRunnerModel("provider/model");
		expect("error" in resolved).toBe(false);
		if ("error" in resolved) return;

		expect(process.env.DITTO_PI_CREDENTIAL).toBeUndefined();
		expect(process.env.OPENCODE_API_KEY).toBeUndefined();
		expect(mocks.credentialModify).toHaveBeenCalledWith(
			"provider",
			expect.any(Function),
		);
		const seeded = await mocks.credentialModify.mock.calls[0][1](undefined);
		expect(seeded).toEqual({ type: "api_key", key: "test-opencode-key" });
		expect(mocks.modelRuntimeCreate).toHaveBeenCalledWith({
			credentials: expect.any(Object),
			modelsPath: null,
			allowModelNetwork: false,
		});
		expect(resolved.model).toEqual({ provider: "provider", id: "model" });
	});

	it("accepts legacy bare OPENCODE_API_KEY strings", async () => {
		process.env.OPENCODE_API_KEY = "legacy-key";
		const resolved = await resolveRunnerModel("provider/model");
		expect("error" in resolved).toBe(false);
		const seeded = await mocks.credentialModify.mock.calls[0][1](undefined);
		expect(seeded).toEqual({ type: "api_key", key: "legacy-key" });
		expect(process.env.OPENCODE_API_KEY).toBeUndefined();
	});

	it("fails cleanly for unknown models and still scrubs env", async () => {
		process.env.DITTO_PI_CREDENTIAL = JSON.stringify({
			type: "api_key",
			key: "secret",
		});
		mocks.getModel.mockReturnValue(undefined);
		const resolved = await resolveRunnerModel("provider/missing");
		expect(resolved).toEqual({ error: "Unknown model: provider/missing" });
		expect(process.env.DITTO_PI_CREDENTIAL).toBeUndefined();
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
