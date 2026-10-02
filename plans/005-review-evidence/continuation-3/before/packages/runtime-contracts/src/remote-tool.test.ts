import { describe, expect, it } from "vitest";
import { parseRemoteToolV1, type RemoteToolV1 } from "./remote-tool.js";

const job: RemoteToolV1 = {
	version: 1,
	runId: "run",
	assistantEntryId: "assistant",
	toolCallId: "call",
	attempt: 1,
	executorIncarnationId: "executor",
	runEpoch: 1,
	lifecycleGeneration: 1,
	deadline: 1000,
	outcomePolicy: "never_retry",
	tool: {
		name: "write",
		path: "source",
		content: "",
		expected: { absent: true },
	},
};

describe("RemoteToolV1", () => {
	it("permits empty-file creation with an absent-file precondition", () => {
		expect(parseRemoteToolV1(JSON.stringify(job))).toEqual(job);
	});
	it("rejects duplicate authority fields in raw JSON", () => {
		expect(() =>
			parseRemoteToolV1(
				JSON.stringify(job).replace('"attempt":1', '"attempt":1,"attempt":2'),
			),
		).toThrow();
	});
	it.each([
		null,
		{},
		{ sha256: "bad" },
		{ absent: true, sha256: "0".repeat(64) },
	])("requires one exact write precondition", (expected) => {
		expect(() =>
			parseRemoteToolV1({ ...job, tool: { ...job.tool, expected } }),
		).toThrow();
	});
	it("rejects arbitrary shells declared retry-safe", () => {
		expect(() =>
			parseRemoteToolV1({
				...job,
				outcomePolicy: "retry_safe",
				tool: { name: "bash", command: "echo command" },
			}),
		).toThrow();
	});
	it("rejects fractional deadlines, extra arguments and unbounded commands", () => {
		for (const candidate of [
			{ ...job, deadline: 1.5 },
			{ ...job, tool: { ...job.tool, env: {} } },
			{ ...job, tool: { name: "bash", command: "x".repeat(128 * 1024 + 1) } },
		])
			expect(() => parseRemoteToolV1(candidate)).toThrow();
	});
});
