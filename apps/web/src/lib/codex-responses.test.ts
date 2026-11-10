import { describe, expect, it } from "vitest";
import type { ModelRequestV2 } from "../../../../packages/runtime-contracts/src/model.js";
import {
	buildCodexUpstream,
	CODEX_STREAM_LIMITS,
	codexAccountId,
	readCodexFrames,
	selectUpstream,
} from "./codex-responses";

const jwt = (payload: unknown) =>
	`e30.${btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.sig`;
const claim = (id: unknown) =>
	jwt({ "https://api.openai.com/auth": { chatgpt_account_id: id } });

const request: ModelRequestV2 = {
	version: 2,
	purpose: "generation",
	provider: "openai-codex",
	model: "gpt-6.1-sol",
	thinking: "high",
	maxTokens: 4096,
	transcript: {
		messages: [
			{
				role: "system",
				content: "Base rules",
				toolsAdded: [
					{ name: "read", description: "Read", parameters: { type: "object" } },
					{ name: "bash", description: "Run", parameters: { type: "object" } },
				],
			},
			{ role: "user", content: "Hello" },
			{
				role: "assistant",
				content: [
					{
						type: "thinking",
						thinking: "hmm",
						thinkingSignature: JSON.stringify({
							type: "reasoning",
							id: "rs_1",
							summary: [],
							encrypted_content: "enc",
							planted: "bad",
						}),
					},
					{ type: "text", text: "Looking" },
					{
						type: "toolCall",
						id: "call_1|fc_1",
						name: "read",
						arguments: { path: "a" },
					},
				],
			},
			{
				role: "toolResult",
				toolCallId: "call_1|fc_1",
				toolName: "read",
				content: [{ type: "text", text: "contents" }],
				isError: false,
			},
			{
				role: "system",
				content: "",
				sections: { extra: "Section body" },
				toolsRemoved: [{ name: "bash" }],
			},
		],
	},
};

const sse = (events: unknown[], headers: Record<string, string> = {}) =>
	new Response(
		events.map((e) => `event: x\ndata: ${JSON.stringify(e)}\n\n`).join(""),
		{ headers: { "content-type": "text/event-stream", ...headers } },
	);
const completed = (response: unknown = {}) => ({
	type: "response.completed",
	response,
});
const signal = () => AbortSignal.timeout(5000);

describe("codexAccountId", () => {
	it("reads the account claim and rejects malformed tokens", () => {
		expect(codexAccountId(claim("acct_123"))).toBe("acct_123");
		expect(codexAccountId("a.b")).toBeNull();
		expect(codexAccountId("a.!!!.c")).toBeNull();
		expect(codexAccountId(jwt({}))).toBeNull();
		expect(codexAccountId(claim("a/b"))).toBeNull();
	});
});

describe("selectUpstream", () => {
	it("keeps providers and model ids aligned", () => {
		expect(selectUpstream(request, false)).toBe("codex");
		const faux = { ...request, provider: "faux", model: "faux-1" };
		expect(selectUpstream(faux, false)).toBeNull();
		expect(selectUpstream(faux, true)).toBe("fixture");
		expect(selectUpstream({ ...request, model: "faux-1" }, true)).toBeNull();
	});
});

describe("buildCodexUpstream", () => {
	const context = { accountId: "acct_123", promptCacheKey: "session-1" };
	it("builds the request itself from the normalized transcript", () => {
		const upstream = buildCodexUpstream(request, context);
		expect(upstream.url).toBe(
			"https://chatgpt.com/backend-api/codex/responses",
		);
		expect(Object.keys(upstream.headers).sort()).toEqual(
			[
				"accept",
				"chatgpt-account-id",
				"content-type",
				"openai-beta",
				"originator",
			].sort(),
		);
		const body = JSON.parse(upstream.body);
		expect(body.instructions).toContain("Section body");
		expect(body.instructions).toContain("Base rules");
		expect(body.tools.map((t: { name: string }) => t.name)).toEqual(["read"]);
		expect(body.input.some((i: { role?: string }) => i.role === "system")).toBe(
			false,
		);
		expect(body.input[1]).toEqual({
			type: "reasoning",
			id: "rs_1",
			summary: [],
			encrypted_content: "enc",
		});
		const call = body.input.find(
			(i: { type?: string }) => i.type === "function_call",
		);
		expect(call.call_id).toBe("call_1");
		expect("id" in call).toBe(false);
		expect(call.arguments).toBe('{"path":"a"}');
		expect(body.input.at(-1)).toEqual({
			type: "function_call_output",
			call_id: "call_1",
			output: "contents",
		});
		expect(body.reasoning.effort).toBe("high");
		expect(body.store).toBe(false);
		expect("max_output_tokens" in body).toBe(false);
		expect(body.prompt_cache_key).toBe("session-1");
	});
	it("refuses a non-codex provider", () => {
		expect(() =>
			buildCodexUpstream(
				{ ...request, provider: "faux", model: "faux-1" },
				context,
			),
		).toThrow("codex_request_contract");
	});
});

describe("readCodexFrames", () => {
	const item = (value: unknown) => ({
		type: "response.output_item.done",
		item: value,
	});
	it("maps reasoning, text and tool calls into ordered frames", async () => {
		const result = await readCodexFrames(
			sse([
				{ type: "response.created" },
				{ type: "response.output_text.delta", delta: "x" },
				item({
					type: "reasoning",
					id: "rs_1",
					summary: [{ type: "summary_text", text: "thought" }],
				}),
				item({
					type: "message",
					id: "msg_1",
					content: [{ type: "output_text", text: "hi" }],
				}),
				item({
					type: "function_call",
					call_id: "call_1",
					id: "fc_1",
					name: "read",
					arguments: '{"path":"a"}',
				}),
				completed({
					usage: {
						input_tokens: 100,
						output_tokens: 20,
						input_tokens_details: { cached_tokens: 30 },
						output_tokens_details: { reasoning_tokens: 5 },
					},
				}),
			]),
			signal(),
			[],
		);
		expect(result.status).toBe("complete");
		if (result.status !== "complete") return;
		expect(result.frames.map((f) => f.type)).toEqual([
			"thinking",
			"text",
			"toolCall",
			"done",
		]);
		expect(result.frames[0]).toMatchObject({ thinking: "thought" });
		expect(result.frames[2]).toMatchObject({
			id: "call_1|fc_1",
			arguments: { path: "a" },
		});
		expect(result.frames[3]).toEqual({
			version: 2,
			type: "done",
			stopReason: "toolUse",
			usage: { input: 70, output: 20, cacheRead: 30, reasoning: 5 },
		});
	});
	const rejects = (response: Response, values: string[] = []) =>
		expect(readCodexFrames(response, signal(), values)).rejects.toThrow();
	it("rejects contract violations", async () => {
		await rejects(
			new Response("{}", { headers: { "content-type": "application/json" } }),
		);
		await rejects(sse([{ type: "response.created" }]));
		await rejects(sse([completed(), completed()]));
		await rejects(sse([item({ type: "web_search_call" }), completed()]));
		await rejects(
			sse([
				item({
					type: "function_call",
					call_id: "c",
					id: "f",
					name: "n",
					arguments: "[1]",
				}),
				completed(),
			]),
		);
		await rejects(
			sse([
				item({
					type: "message",
					id: "m",
					content: [{ type: "output_text", text: "token-secret" }],
				}),
				completed(),
			]),
			["token-secret"],
		);
	});
	it("rejects a stream over the response bound", async () => {
		const chunk = `data: ${JSON.stringify({ type: "x", pad: "a".repeat(1_048_000) })}\n\n`;
		const parts = Array.from(
			{ length: CODEX_STREAM_LIMITS.responseBytes / 1_048_000 + 2 },
			() => chunk,
		);
		await rejects(
			new Response(parts.join(""), {
				headers: { "content-type": "text/event-stream" },
			}),
		);
	});
	it("maps response.failed to a failed result", async () => {
		await expect(
			readCodexFrames(sse([{ type: "response.failed" }]), signal(), []),
		).resolves.toEqual({ status: "failed" });
	});
	it("drops a reasoning signature over the cap", async () => {
		const result = await readCodexFrames(
			sse([
				item({
					type: "reasoning",
					id: "rs",
					summary: [],
					encrypted_content: "e".repeat(70_000),
				}),
				completed(),
			]),
			signal(),
			[],
		);
		if (result.status !== "complete") throw new Error("expected complete");
		expect(result.frames[0]).toEqual({
			version: 2,
			type: "thinking",
			thinking: "",
		});
	});
});
