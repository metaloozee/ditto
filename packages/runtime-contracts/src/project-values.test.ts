import { describe, expect, it } from "vitest";
import {
	PROJECT_VALUE_LIMITS,
	parseProjectValueGrantV1,
	parseProjectValueRequestV1,
	redactProjectValues,
} from "./project-values.js";

const request = {
	version: 1,
	role: "repository_command",
	workspaceSessionId: "session",
	operationId: "op",
	executorGeneration: 1,
	epoch: 2,
	deadlineAt: 10_000,
};

describe("project value contracts", () => {
	it("binds a request to one operation, generation, epoch and deadline", () => {
		expect(parseProjectValueRequestV1(request)).toEqual(request);
		for (const role of ["builder", "preview", "git", "archive"])
			expect(parseProjectValueRequestV1({ ...request, role }).role).toBe(role);
		for (const value of [
			{ ...request, role: "agent" },
			{ ...request, operationId: "" },
			{ ...request, executorGeneration: 0 },
			{ ...request, epoch: 1.5 },
			{ ...request, deadlineAt: undefined },
			{ ...request, values: [] },
			{ ...request, version: 2 },
		])
			expect(() => parseProjectValueRequestV1(value)).toThrow();
	});

	it("accepts only bounded, unique, well-formed values for the requested operation", () => {
		const granted = {
			version: 1,
			operationId: "op",
			status: "granted",
			values: [{ key: "API_TOKEN", value: "synthetic-value" }],
		};
		expect(parseProjectValueGrantV1(granted, "op")).toEqual(granted);
		expect(() => parseProjectValueGrantV1(granted, "other")).toThrow(
			/another operation/,
		);
		expect(
			parseProjectValueGrantV1(
				{ version: 1, operationId: "op", status: "denied", reason: "role" },
				"op",
			),
		).toMatchObject({ status: "denied", reason: "role" });
		for (const values of [
			[{ key: "1BAD", value: "x" }],
			[{ key: "A-B", value: "x" }],
			[
				{ key: "A", value: "x" },
				{ key: "A", value: "y" },
			],
			[{ key: "A", value: "nul\0" }],
			[{ key: "A", value: 1 }],
			[{ key: "A", value: "x".repeat(PROJECT_VALUE_LIMITS.valueBytes + 1) }],
			Array.from({ length: PROJECT_VALUE_LIMITS.count + 1 }, (_, n) => ({
				key: `K${n}`,
				value: "x",
			})),
			Array.from({ length: 3 }, (_, n) => ({
				key: `K${n}`,
				value: "x".repeat(PROJECT_VALUE_LIMITS.valueBytes),
			})),
		])
			expect(() =>
				parseProjectValueGrantV1({ ...granted, values }, "op"),
			).toThrow();
		expect(() =>
			parseProjectValueGrantV1(
				{ version: 1, operationId: "op", status: "denied", reason: "maybe" },
				"op",
			),
		).toThrow();
	});

	it("redacts concrete values of at least eight characters", () => {
		expect(
			redactProjectValues("a=synthetic-1 b=short synthetic-1", [
				"synthetic-1",
				"short",
			]),
		).toBe("a=[REDACTED] b=short [REDACTED]");
	});
});
