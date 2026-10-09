import { expect, it } from "vitest";
import { parseModelAttemptV1 } from "./model.js";

const attempt = {
	version: 1,
	effectId: "effect/attempt/1",
	operationId: "generation/1",
	runId: "run",
	commandId: "command",
	assistantId: "assistant",
	taskId: 1,
	epoch: 2,
	attempt: 1,
	generation: 1,
	deadlineAt: 1000,
	requestDigest: "a".repeat(64),
	kind: "generation",
};

it("round trips exact generation and custom-summary attempt associations", () => {
	expect(parseModelAttemptV1(JSON.stringify(attempt))).toEqual(attempt);
	expect(parseModelAttemptV1({ ...attempt, kind: "custom_summary" }).kind).toBe(
		"custom_summary",
	);
});

it("rejects duplicate, unknown, malformed and unbounded attempt fields", () => {
	for (const changed of [
		{ version: 2 },
		{ epoch: 0 },
		{ attempt: 1.5 },
		{ taskId: -1 },
		{ generation: Number.MAX_SAFE_INTEGER + 1 },
		{ kind: "tool" },
		{ deadlineAt: Infinity },
		{ requestDigest: "wrong" },
		{ effectId: "x".repeat(513) },
		{ token: "forbidden" },
	])
		expect(() => parseModelAttemptV1({ ...attempt, ...changed })).toThrow();
	expect(() =>
		parseModelAttemptV1(
			JSON.stringify(attempt).replace('"epoch":2', '"epoch":2,"epoch":2'),
		),
	).toThrow("Duplicate");
});
