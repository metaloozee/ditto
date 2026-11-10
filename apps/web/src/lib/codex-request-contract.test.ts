import { describe, expect, it } from "vitest";
import {
	MODEL_FIXTURE_URL_V2,
	MODEL_LIMITS_V2,
	parseSyntheticAccountV1,
} from "../../../../packages/runtime-contracts/src/model.js";
import {
	buildFixtureUpstream,
	modelRequestDigest,
	readModelFrames,
	reconstructModelRequest,
} from "./codex-request-contract";

const request = {
	version: 2,
	purpose: "generation",
	provider: "faux",
	model: "faux-1",
	thinking: "off",
	maxTokens: 128,
	transcript: {
		messages: [
			{ role: "system", content: "Synthetic system" },
			{ role: "user", content: "Synthetic transcript" },
		],
	},
};
const end = {
	version: 2,
	type: "done",
	stopReason: "stop",
	usage: { input: 2, output: 3, cacheRead: 0 },
};
const stream = (text: string, headers: Record<string, string> = {}) =>
	new Response(text, {
		headers: { "content-type": "application/x-ndjson", ...headers },
	});
const lines = (frames: unknown[]) =>
	`${frames.map((frame) => JSON.stringify(frame)).join("\n")}\n`;

describe("strict model request reconstruction", () => {
	it("builds the upstream itself with fixed url and headers, never caller-supplied ones", async () => {
		const reordered = JSON.stringify(request, null, 2);
		const { request: parsed } = reconstructModelRequest(reordered);
		expect(parsed).toEqual(request);
		const upstream = buildFixtureUpstream(parsed);
		expect(upstream.url).toBe(MODEL_FIXTURE_URL_V2);
		expect(upstream.headers).toEqual({
			"content-type": "application/json",
			accept: "application/x-ndjson",
		});
		expect(upstream.body).toBe(JSON.stringify(request));
		expect(await modelRequestDigest(reordered)).toBe(
			await modelRequestDigest(request),
		);
		expect(await modelRequestDigest({ ...request, thinking: "high" })).not.toBe(
			await modelRequestDigest(request),
		);
	});
	for (const changed of [
		{ version: 1 },
		{ url: MODEL_FIXTURE_URL_V2 },
		{ headers: [["authorization", "caller"]] },
		{ unknown: 1 },
		{ model: "real provider" },
		{ thinking: "unsupported" },
		{ maxTokens: 0 },
		{ purpose: "tool" },
		{ transcript: { messages: [] } },
		{ transcript: { messages: request.transcript.messages, extra: 1 } },
		{
			transcript: {
				messages: [
					{
						role: "user",
						content: [{ type: "image", data: "AA", mimeType: "image/png" }],
					},
				],
			},
		},
		{
			transcript: {
				messages: [{ role: "user", content: "x".repeat(1_048_577) }],
			},
		},
	])
		it(`rejects request variant ${JSON.stringify(changed).slice(0, 100)}`, () => {
			expect(() =>
				reconstructModelRequest({ ...request, ...changed }),
			).toThrow();
		});
	it("rejects duplicate fields", () => {
		expect(() =>
			reconstructModelRequest(
				JSON.stringify(request).replace(
					'"version":2',
					'"version":2,"version":2',
				),
			),
		).toThrow();
	});
	it("account capability parsing is bounded, strict and does not infer entitlement from a catalogue", () => {
		const account = {
			version: 1,
			status: "available",
			generation: 1,
			revision: 1,
			models: [{ id: "faux-1", thinking: ["off", "high"] }],
		};
		expect(parseSyntheticAccountV1(account)).toEqual(account);
		for (const changed of [
			{ models: [...account.models, ...account.models] },
			{ status: "revoked" },
			{ models: [{ id: "faux-1", thinking: ["off", "off"] }] },
			{ catalogue: true },
		])
			expect(() =>
				parseSyntheticAccountV1({ ...account, ...changed }),
			).toThrow();
	});
});

describe("bounded model frame reconstruction", () => {
	it("retains exact validated frames in content order across arbitrary chunk boundaries", async () => {
		const frames = [
			{ version: 2, type: "thinking", thinking: "plan", signature: "s" },
			{ version: 2, type: "text", text: "Synthetic answer" },
			{
				version: 2,
				type: "toolCall",
				id: "call_1",
				name: "read",
				arguments: { path: "a.ts" },
			},
			{ ...end, stopReason: "toolUse" },
		];
		const bytes = new TextEncoder().encode(lines(frames));
		const response = new Response(
			new ReadableStream({
				start(controller) {
					for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
					controller.close();
				},
			}),
			{ headers: { "content-type": "application/x-ndjson" } },
		);
		expect(
			await readModelFrames(response, new AbortController().signal),
		).toEqual(frames);
	});
	const text = (value: string) => ({ version: 2, type: "text", text: value });
	const call = {
		version: 2,
		type: "toolCall",
		id: "c",
		name: "read",
		arguments: {},
	};
	for (const body of [
		"",
		JSON.stringify(end),
		`${JSON.stringify(end)}\n{}\n`,
		lines([end, text("after done")]),
		'{"version":2,"version":2,"type":"done"}\n',
		lines([text("x".repeat(MODEL_LIMITS_V2.frameBytes + 1))]),
		lines(Array.from({ length: MODEL_LIMITS_V2.frames + 1 }, () => text("x"))),
		lines(
			Array.from({ length: 3 }, () => text("x".repeat(250_000))).concat(
				end as never,
			),
		),
		lines([
			...Array.from({ length: MODEL_LIMITS_V2.toolCalls + 1 }, () => call),
			end,
		]),
		lines([{ ...end, stopReason: "aborted" }]),
	])
		it(`rejects malformed, truncated or oversized stream of ${body.length} bytes`, async () => {
			await expect(
				readModelFrames(stream(body), new AbortController().signal),
			).rejects.toThrow();
		});
	it("rejects redirects, encodings, extra fields and credential echoes including split frames and tool arguments", async () => {
		const rejectedHeaders: Record<string, string>[] = [
			{ location: "https://elsewhere.invalid" },
			{ "content-encoding": "gzip" },
			{ "content-type": "text/event-stream" },
		];
		for (const headers of rejectedHeaders)
			await expect(
				readModelFrames(
					stream(lines([end]), headers),
					new AbortController().signal,
				),
			).rejects.toThrow();
		const split = lines([text("private-"), text("marker"), end]);
		await expect(
			readModelFrames(stream(split), new AbortController().signal, [
				"private-marker",
			]),
		).rejects.toThrow();
		const inArguments = lines([
			{ ...call, arguments: { token: "private-marker" } },
			end,
		]);
		await expect(
			readModelFrames(stream(inArguments), new AbortController().signal, [
				"private-marker",
			]),
		).rejects.toThrow();
		const inThinking = lines([
			{ version: 2, type: "thinking", thinking: "private-marker" },
			end,
		]);
		await expect(
			readModelFrames(stream(inThinking), new AbortController().signal, [
				"private-marker",
			]),
		).rejects.toThrow();
	});
	it("cancellation remains bounded when upstream stream cleanup never acknowledges", async () => {
		const controller = new AbortController();
		const response = new Response(
			new ReadableStream({ cancel: () => new Promise<void>(() => {}) }),
			{ headers: { "content-type": "application/x-ndjson" } },
		);
		const started = Date.now();
		const reading = readModelFrames(response, controller.signal);
		controller.abort();
		await expect(reading).rejects.toThrow();
		expect(Date.now() - started).toBeLessThan(1500);
	});
	it("cancellation ends a locally held stream read", async () => {
		const controller = new AbortController();
		const response = new Response(new ReadableStream(), {
			headers: { "content-type": "application/x-ndjson" },
		});
		const reading = readModelFrames(response, controller.signal);
		controller.abort();
		await expect(reading).rejects.toThrow();
	});
});
