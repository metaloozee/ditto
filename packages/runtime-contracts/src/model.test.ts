import { expect, it } from "vitest";
import {
	MODEL_LIMITS_V2,
	modelRequestDigestV2,
	parseModelAttemptV1,
	parseModelFrameV2,
	parseModelRequestV2,
	validateModelFramesV2,
} from "./model.js";

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

const usage = { input: 3, output: 4, cacheRead: 0 };
const piUsage = {
	input: 3,
	output: 4,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 7,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const request = () => ({
	version: 2,
	purpose: "generation",
	provider: "faux",
	model: "faux-1",
	thinking: "off",
	maxTokens: 4096,
	transcript: {
		messages: [
			{
				role: "system",
				content: "You are Ditto.",
				toolsAdded: [
					{
						name: "read",
						description: "Read a file",
						parameters: {
							type: "object",
							properties: { path: { type: "string" } },
						},
					},
				],
			},
			{ role: "user", content: [{ type: "text", text: "open a.ts" }] },
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "plan", thinkingSignature: "sig" },
					{ type: "text", text: "ok" },
					{
						type: "toolCall",
						id: "call_1",
						name: "read",
						arguments: { path: "a.ts" },
					},
				],
				api: "faux",
				provider: "faux",
				model: "faux-1",
				usage: piUsage,
				stopReason: "toolUse",
				responseId: "r1",
			},
			{
				role: "toolResult",
				toolCallId: "call_1",
				toolName: "read",
				content: [{ type: "text", text: "const a = 1" }],
				isError: false,
				details: { bytes: 11 },
			},
		],
	},
});

it("parses a realistic transcript, drops assistant metadata and round trips", () => {
	const parsed = parseModelRequestV2(request());
	expect(parsed.transcript.messages[2]).toEqual({
		role: "assistant",
		content: request().transcript.messages[2].content,
	});
	expect(
		(parsed.transcript.messages[3] as Record<string, unknown>).details,
	).toBeUndefined();
	expect(parseModelRequestV2(JSON.stringify(parsed))).toEqual(parsed);
	expect(parseModelRequestV2(parsed)).toEqual(parsed);
});

it("rejects images, unknown shapes, malformed fields and oversize requests", () => {
	const mutate = (change: (r: ReturnType<typeof request>) => void) => {
		const r = request();
		change(r);
		return r;
	};
	const cases: [string, unknown, string][] = [
		[
			"image in user content",
			mutate((r) => {
				r.transcript.messages[1] = {
					role: "user",
					content: [{ type: "image", data: "AA", mimeType: "image/png" }],
				} as never;
			}),
			"invalid_content",
		],
		[
			"image in tool result",
			mutate((r) => {
				(r.transcript.messages[3] as { content: unknown }).content = [
					{ type: "image", data: "AA", mimeType: "image/png" },
				];
			}),
			"invalid_content",
		],
		[
			"unknown role",
			mutate((r) => {
				r.transcript.messages[1] = { role: "tool", content: "x" } as never;
			}),
			"invalid_request",
		],
		[
			"unknown block type",
			mutate((r) => {
				(r.transcript.messages[2] as { content: unknown[] }).content.push({
					type: "audio",
				});
			}),
			"invalid_content",
		],
		[
			"unknown assistant key",
			mutate((r) => {
				(r.transcript.messages[2] as Record<string, unknown>).extra = 1;
			}),
			"invalid_request",
		],
		[
			"model with a space",
			{ ...request(), model: "faux 1" },
			"invalid_request",
		],
		[
			"unknown thinking",
			{ ...request(), thinking: "ultra" },
			"invalid_request",
		],
		[
			"oversize",
			mutate((r) => {
				r.transcript.messages[1] = {
					role: "user",
					content: "x".repeat(MODEL_LIMITS_V2.requestBytes),
				} as never;
			}),
			"oversized",
		],
	];
	for (const [label, input, code] of cases)
		expect(() => parseModelRequestV2(input), label).toThrow(
			expect.objectContaining({ code }),
		);
	expect(() =>
		parseModelRequestV2(
			JSON.stringify(request()).replace(
				'"maxTokens":4096',
				'"maxTokens":4096,"maxTokens":4096',
			),
		),
	).toThrow(expect.objectContaining({ code: "invalid_request" }));
	expect(() =>
		parseModelRequestV2(
			JSON.stringify(request()).replace('"purpose":', '"extra":1,"purpose":'),
		),
	).toThrow();
});

it("digests independently of object key order", async () => {
	const a = request();
	const reordered = JSON.parse(
		JSON.stringify(a, (_k, v) =>
			v && typeof v === "object" && !Array.isArray(v)
				? Object.fromEntries(Object.entries(v).reverse())
				: v,
		),
	);
	expect(await modelRequestDigestV2(reordered)).toBe(
		await modelRequestDigestV2(a),
	);
	expect(await modelRequestDigestV2({ ...a, maxTokens: 1 })).not.toBe(
		await modelRequestDigestV2(a),
	);
});

it("parses every frame type and rejects invalid frames", () => {
	for (const frame of [
		{ version: 2, type: "text", text: "hi", signature: "s" },
		{ version: 2, type: "thinking", thinking: "t", redacted: true },
		{
			version: 2,
			type: "toolCall",
			id: "c",
			name: "read",
			arguments: { a: 1 },
		},
		{
			version: 2,
			type: "done",
			stopReason: "toolUse",
			usage: { ...usage, reasoning: 1 },
		},
	])
		expect(parseModelFrameV2(frame)).toEqual(frame);
	for (const frame of [
		{ version: 2, type: "done", stopReason: "aborted", usage },
		{ version: 2, type: "text", text: "x", extra: 1 },
		{ version: 2, type: "toolCall", id: "c", name: "read", arguments: [] },
		{ version: 1, type: "text", text: "x" },
	])
		expect(() => parseModelFrameV2(frame)).toThrow();
});

it("bounds a reply: one final done, tool call count", () => {
	const done = { version: 2, type: "done", stopReason: "stop", usage };
	const call = {
		version: 2,
		type: "toolCall",
		id: "c",
		name: "read",
		arguments: {},
	};
	expect(validateModelFramesV2([call, done])).toHaveLength(2);
	expect(() => validateModelFramesV2([call])).toThrow();
	expect(() => validateModelFramesV2([done, call])).toThrow();
	expect(() =>
		validateModelFramesV2([
			...Array.from({ length: MODEL_LIMITS_V2.toolCalls + 1 }, () => call),
			done,
		]),
	).toThrow(expect.objectContaining({ code: "oversized" }));
});
