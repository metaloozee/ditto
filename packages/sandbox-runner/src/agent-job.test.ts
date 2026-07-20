import { describe, expect, it } from "vitest";
import { parseJob } from "./agent-job.js";

describe("parseJob", () => {
	const base = {
		runId: "run-1",
		conversationId: "sess-1",
		model: "opencode/deepseek-v4-flash-free",
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

	it("allows omitting thinkingLevel", () => {
		const { job, error } = parseJob(JSON.stringify(base));
		expect(error).toBeUndefined();
		expect(job?.thinkingLevel).toBeUndefined();
	});
});
