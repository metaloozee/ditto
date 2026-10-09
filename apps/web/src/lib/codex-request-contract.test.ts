import { describe, expect, it } from "vitest";
import {
	parseSyntheticAccountV1,
	SYNTHETIC_MODEL_URL,
} from "../../../../packages/runtime-contracts/src/model.js";
import {
	readSyntheticStream,
	reconstructSyntheticRequest,
	syntheticRequestDigest,
} from "./codex-request-contract";

const body = {
	version: 1,
	protocol: "ditto-synthetic-ndjson-1",
	purpose: "generation",
	model: "faux-1",
	thinking: "off",
	transcript: "Synthetic transcript",
	options: { maxTokens: 128 },
};
const request = {
	version: 1,
	method: "POST",
	url: SYNTHETIC_MODEL_URL,
	headers: [
		["content-type", "application/json"],
		["accept", "application/x-ndjson"],
	],
	body: JSON.stringify(body),
};
const end = {
	version: 1,
	type: "done",
	stopReason: "stop",
	inputTokens: 2,
	outputTokens: 3,
};
const stream = (text: string, headers: Record<string, string> = {}) =>
	new Response(text, {
		headers: { "content-type": "application/x-ndjson", ...headers },
	});

describe("strict synthetic request reconstruction", () => {
	it("reconstructs canonical body and headers rather than forwarding caller order or whitespace", async () => {
		const changed = {
			...request,
			headers: [...request.headers].reverse(),
			body: JSON.stringify(body, null, 2),
		};
		expect(reconstructSyntheticRequest(changed).request).toEqual(request);
		expect(await syntheticRequestDigest(changed)).toBe(
			await syntheticRequestDigest(request),
		);
		expect(
			await syntheticRequestDigest({
				...request,
				body: JSON.stringify({ ...body, thinking: "high" }),
			}),
		).not.toBe(await syntheticRequestDigest(request));
	});
	for (const changed of [
		{ method: "GET" },
		{ url: `${SYNTHETIC_MODEL_URL}?x=1` },
		{ url: SYNTHETIC_MODEL_URL.replace(".invalid", ".invalid:443") },
		{ url: SYNTHETIC_MODEL_URL.replace("/v1/", "/%76%31/") },
		{ url: SYNTHETIC_MODEL_URL.replace("https://", "https://user@") },
		{ url: SYNTHETIC_MODEL_URL.replace("https://", "http://") },
		{ headers: [...request.headers, ["authorization", "caller"]] },
		{ headers: [...request.headers, ["proxy-authorization", "caller"]] },
		{
			headers: [
				["content-type", "application/json"],
				["content-type", "application/json"],
			],
		},
		{
			headers: [
				["content-type", "application/json; charset=utf-8"],
				request.headers[1],
			],
		},
		{ headers: [["Content-Type", "application/json"], request.headers[1]] },
		{ body: JSON.stringify({ ...body, unknown: 1 }) },
		{
			body: JSON.stringify({
				...body,
				options: { maxTokens: 128, apiKey: "caller" },
			}),
		},
		{ body: JSON.stringify({ ...body, transcript: "x".repeat(98305) }) },
		{ body: JSON.stringify({ ...body, model: "real-provider-model" }) },
		{ body: JSON.stringify({ ...body, thinking: "unsupported" }) },
		{ body: JSON.stringify({ ...body, options: { maxTokens: 0 } }) },
		{
			body: JSON.stringify(body).replace(
				'"version":1',
				'"version":1,"version":1',
			),
		},
		{ encoding: "gzip" },
	])
		it(`rejects request variant ${JSON.stringify(changed).slice(0, 100)}`, () => {
			expect(() =>
				reconstructSyntheticRequest({ ...request, ...changed }),
			).toThrow();
		});
	it("rejects duplicate envelope fields and total encoded request overflow", () => {
		expect(() =>
			reconstructSyntheticRequest(
				JSON.stringify(request).replace(
					'"version":1',
					'"version":1,"version":1',
				),
			),
		).toThrow();
		expect(() =>
			reconstructSyntheticRequest({
				...request,
				body: JSON.stringify({ ...body, transcript: "\\".repeat(60000) }),
			}),
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

describe("bounded synthetic stream reconstruction", () => {
	it("retains exact validated frames across arbitrary chunk boundaries", async () => {
		const frames = [
			{ version: 1, type: "delta", text: "Synthetic answer" },
			end,
		];
		const encoded =
			frames.map((frame) => JSON.stringify(frame)).join("\n") + "\n";
		const bytes = new TextEncoder().encode(encoded);
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
			await readSyntheticStream(response, new AbortController().signal),
		).toEqual(frames);
	});
	for (const text of [
		"",
		JSON.stringify(end),
		`${JSON.stringify(end)}\n{}\n`,
		'{"version":1,"version":1,"type":"done"}\n',
		`${JSON.stringify({ version: 1, type: "delta", text: "x".repeat(8193) })}\n`,
		Array.from({ length: 129 }, () =>
			JSON.stringify({ version: 1, type: "delta", text: "x" }),
		).join("\n") + "\n",
		Array.from({ length: 9 }, () =>
			JSON.stringify({ version: 1, type: "delta", text: "x".repeat(8192) }),
		).join("\n") + "\n",
	])
		it(`rejects malformed or truncated stream of ${text.length} bytes`, async () => {
			await expect(
				readSyntheticStream(stream(text), new AbortController().signal),
			).rejects.toThrow();
		});
	it("rejects redirects, encodings, extra fields and credential echoes including split frames", async () => {
		const rejectedHeaders: Record<string, string>[] = [
			{ location: "https://elsewhere.invalid" },
			{ "content-encoding": "gzip" },
			{ "content-type": "text/event-stream" },
		];
		for (const headers of rejectedHeaders)
			await expect(
				readSyntheticStream(
					stream(`${JSON.stringify(end)}\n`, headers),
					new AbortController().signal,
				),
			).rejects.toThrow();
		const text =
			["private-", "marker"]
				.map((text) => JSON.stringify({ version: 1, type: "delta", text }))
				.join("\n") + `\n${JSON.stringify(end)}\n`;
		await expect(
			readSyntheticStream(stream(text), new AbortController().signal, [
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
		const reading = readSyntheticStream(response, controller.signal);
		controller.abort();
		await expect(reading).rejects.toThrow();
		expect(Date.now() - started).toBeLessThan(1500);
	});
	it("cancellation ends a locally held stream read", async () => {
		const controller = new AbortController();
		const response = new Response(new ReadableStream(), {
			headers: { "content-type": "application/x-ndjson" },
		});
		const reading = readSyntheticStream(response, controller.signal);
		controller.abort();
		await expect(reading).rejects.toThrow();
	});
});
