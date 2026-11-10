import { describe, expect, it } from "vitest";
import { parseJob } from "./agent-job.js";

const MODEL_CONFIG = {
	id: "test-model",
	name: "Test model",
	reasoning: false,
	contextWindow: 1000,
	maxTokens: 100,
};

describe("parseJob", () => {
	const base = {
		runId: "run-1",
		conversationId: "sess-1",
		model: "ditto/default",
		modelConfig: MODEL_CONFIG,
		prompt: "hi",
	};

	it("accepts optional canonical thinkingLevel", () => {
		const { job, error } = parseJob(
			JSON.stringify({ ...base, thinkingLevel: "high" }),
		);
		expect(error).toBeUndefined();
		expect(job?.thinkingLevel).toBe("high");
	});

	it("rejects non-canonical thinkingLevel", () => {
		const { error } = parseJob(
			JSON.stringify({ ...base, thinkingLevel: "ultra" }),
		);
		expect(error).toMatch(/thinkingLevel/);
	});

	it("rejects Pi levels outside off, high, and max", () => {
		const { error } = parseJob(
			JSON.stringify({ ...base, thinkingLevel: "medium" }),
		);
		expect(error).toMatch(/thinkingLevel/);
	});

	it("round-trips a valid modelConfig", () => {
		const { job, error } = parseJob(JSON.stringify(base));
		expect(error).toBeUndefined();
		expect(job?.modelConfig).toEqual(MODEL_CONFIG);
	});

	it("rejects a missing, invalid, or endpoint-carrying modelConfig", () => {
		const { modelConfig: _omit, ...withoutConfig } = base;
		expect(parseJob(JSON.stringify(withoutConfig)).error).toBe(
			"modelConfig is invalid",
		);
		expect(
			parseJob(
				JSON.stringify({
					...base,
					modelConfig: { ...MODEL_CONFIG, id: "a b" },
				}),
			).error,
		).toBe("modelConfig is invalid");
		expect(
			parseJob(
				JSON.stringify({
					...base,
					modelConfig: {
						...MODEL_CONFIG,
						baseUrl: "https://llm.example.com/v1",
					},
				}),
			).error,
		).toBe("modelConfig is invalid");
	});

	it("rejects every model other than the fixed literal", () => {
		const { error } = parseJob(
			JSON.stringify({ ...base, model: "provider/model" }),
		);
		expect(error).toMatch(/Unknown model/);
	});

	it("allows omitting thinkingLevel", () => {
		const { job, error } = parseJob(JSON.stringify(base));
		expect(error).toBeUndefined();
		expect(job?.thinkingLevel).toBeUndefined();
	});
});
