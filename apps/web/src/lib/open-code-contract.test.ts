import { describe, expect, it, vi } from "vitest";
import {
	buildAuthenticatedOpenCodeUpstreamRequest,
	classifyOpenCodeRequest,
	MAX_OPENCODE_REQUEST_BODY_BYTES,
	OPENCODE_CONTRACT_DENIAL_LIMIT,
	OPENCODE_CONTRACT_VERSION,
	OPENCODE_PLACEHOLDER_API_KEY,
	OPENCODE_REQUEST_MODEL,
	validateOpenCodeRequest,
	wrapOpenCodeUpstreamResponse,
} from "./open-code-contract";

const BOUND = { contractVersion: OPENCODE_CONTRACT_VERSION };

const PINNED_BODY = {
	model: OPENCODE_REQUEST_MODEL,
	messages: [{ role: "user", content: "hi" }],
	stream: true,
	stream_options: { include_usage: true },
	max_tokens: 1024,
};

function validRequest(options?: {
	body?: unknown;
	rawBody?: string;
	headers?: HeadersInit;
	url?: string;
	method?: string;
}): Request {
	const body = options?.rawBody ?? JSON.stringify(options?.body ?? PINNED_BODY);
	return new Request(
		options?.url ?? "https://opencode.ai/zen/v1/chat/completions",
		{
			method: options?.method ?? "POST",
			headers: {
				authorization: `Bearer ${OPENCODE_PLACEHOLDER_API_KEY}`,
				"content-type": "application/json",
				accept: "application/json",
				...Object.fromEntries(new Headers(options?.headers ?? [])),
			},
			body,
		},
	);
}

describe("open-code-contract", () => {
	it("exports a public placeholder and denial limit", () => {
		expect(OPENCODE_PLACEHOLDER_API_KEY).toBe(
			"ditto-public-opencode-placeholder",
		);
		expect(OPENCODE_CONTRACT_DENIAL_LIMIT).toBe(3);
		expect(OPENCODE_CONTRACT_VERSION).toBe(1);
	});

	it("classifies the exact OpenCode contract as model", () => {
		const classified = classifyOpenCodeRequest(validRequest());
		expect(classified).toEqual({ kind: "model", host: "opencode.ai" });
	});

	it("classifies OpenCode-shaped misses as near-miss", () => {
		expect(
			classifyOpenCodeRequest(
				new Request("https://api.opencode.ai/chat/completions"),
			).kind,
		).toBe("model_near_miss");
		expect(
			classifyOpenCodeRequest(new Request("https://opencode.ai/v1/chat")).kind,
		).toBe("model_near_miss");
		expect(
			classifyOpenCodeRequest(
				new Request("https://opencode.ditto.invalid/zen/v1/chat/completions"),
			).kind,
		).toBe("model_near_miss");
	});

	it("passes a pinned PI OpenCode request", async () => {
		const result = await validateOpenCodeRequest(validRequest(), BOUND);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.method).toBe("POST");
			expect(result.upstreamUrl.href).toBe(
				"https://opencode.ai/zen/v1/chat/completions",
			);
			expect(JSON.parse(result.body)).toMatchObject({
				model: OPENCODE_REQUEST_MODEL,
				stream: true,
			});
		}
	});

	it("fails wrong placeholder", async () => {
		const result = await validateOpenCodeRequest(
			validRequest({
				headers: { authorization: "Bearer stolen-key" },
			}),
			BOUND,
		);
		expect(result).toMatchObject({ ok: false, code: "invalid_placeholder" });
	});

	it("fails wrong model", async () => {
		const result = await validateOpenCodeRequest(
			validRequest({
				body: { ...PINNED_BODY, model: "gpt-4" },
			}),
			BOUND,
		);
		expect(result).toMatchObject({ ok: false, code: "invalid_model" });
	});

	it("fails malformed JSON", async () => {
		const result = await validateOpenCodeRequest(
			validRequest({ rawBody: "{not json" }),
			BOUND,
		);
		expect(result).toMatchObject({ ok: false, code: "malformed_json" });
	});

	it("fails duplicate JSON fields", async () => {
		const result = await validateOpenCodeRequest(
			validRequest({
				rawBody:
					'{"model":"deepseek-v4-flash-free","model":"other","messages":[{"role":"user","content":"hi"}],"stream":true}',
			}),
			BOUND,
		);
		expect(result).toMatchObject({ ok: false, code: "duplicate_field" });
	});

	it("fails unknown body fields", async () => {
		const result = await validateOpenCodeRequest(
			validRequest({
				body: { ...PINNED_BODY, api_key: "secret" },
			}),
			BOUND,
		);
		expect(result).toMatchObject({ ok: false, code: "unknown_field" });
	});

	it("fails oversized bodies", async () => {
		const huge = "x".repeat(MAX_OPENCODE_REQUEST_BODY_BYTES + 1);
		const result = await validateOpenCodeRequest(
			validRequest({
				rawBody: JSON.stringify({
					...PINNED_BODY,
					messages: [{ role: "user", content: huge }],
				}),
			}),
			BOUND,
		);
		expect(result).toMatchObject({ ok: false, code: "body_too_large" });
	});

	it("fails wrong streaming mode", async () => {
		const result = await validateOpenCodeRequest(
			validRequest({
				body: { ...PINNED_BODY, stream: false },
			}),
			BOUND,
		);
		expect(result).toMatchObject({ ok: false, code: "invalid_stream" });
	});

	it("fails cookies, extra authorization, and forwarding headers", async () => {
		const cookie = await validateOpenCodeRequest(
			validRequest({ headers: { cookie: "session=1" } }),
			BOUND,
		);
		expect(cookie).toMatchObject({ ok: false, code: "forbidden_header" });
		const forwarded = await validateOpenCodeRequest(
			validRequest({ headers: { forwarded: "for=1.1.1.1" } }),
			BOUND,
		);
		expect(forwarded).toMatchObject({ ok: false, code: "forbidden_header" });
	});

	it("fails query strings and wrong method", async () => {
		const query = await validateOpenCodeRequest(
			validRequest({
				url: "https://opencode.ai/zen/v1/chat/completions?foo=1",
			}),
			BOUND,
		);
		expect(query).toMatchObject({ ok: false, code: "invalid_query" });
		const method = await validateOpenCodeRequest(
			new Request("https://opencode.ai/zen/v1/chat/completions", {
				method: "GET",
				headers: {
					authorization: `Bearer ${OPENCODE_PLACEHOLDER_API_KEY}`,
					"content-type": "application/json",
				},
			}),
			BOUND,
		);
		expect(method).toMatchObject({ ok: false, code: "invalid_method" });
	});

	it("fails the wrong contract version", async () => {
		const result = await validateOpenCodeRequest(validRequest(), {
			contractVersion: 2,
		});
		expect(result).toMatchObject({ ok: false, code: "contract_version" });
	});

	it("builds a fresh upstream request with the Worker key and redirect manual", async () => {
		const validated = await validateOpenCodeRequest(validRequest(), BOUND);
		expect(validated.ok).toBe(true);
		if (!validated.ok) return;
		const controller = new AbortController();
		const upstream = buildAuthenticatedOpenCodeUpstreamRequest({
			validated,
			apiKey: "sk-real-opencode-key",
			signal: controller.signal,
		});
		expect(upstream.headers.get("Authorization")).toBe(
			"Bearer sk-real-opencode-key",
		);
		expect(upstream.redirect).toBe("manual");
		expect(upstream.signal.aborted).toBe(false);
		expect(upstream.url).toBe("https://opencode.ai/zen/v1/chat/completions");
		expect(await upstream.text()).not.toContain(OPENCODE_PLACEHOLDER_API_KEY);
		controller.abort();
		expect(upstream.signal.aborted).toBe(true);
	});

	it("streams the upstream response without buffering the body", async () => {
		const chunks: string[] = [];
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode("data: 1\n\n"));
				controller.enqueue(new TextEncoder().encode("data: 2\n\n"));
				controller.close();
			},
		});
		const textSpy = vi.spyOn(Response.prototype, "text");
		const arrayBufferSpy = vi.spyOn(Response.prototype, "arrayBuffer");
		const wrapped = wrapOpenCodeUpstreamResponse(
			new Response(body, {
				status: 200,
				headers: { "content-type": "text/event-stream" },
			}),
		);
		expect(textSpy).not.toHaveBeenCalled();
		expect(arrayBufferSpy).not.toHaveBeenCalled();
		expect(wrapped.body).toBeTruthy();
		const reader = wrapped.body?.getReader();
		expect(reader).toBeTruthy();
		if (!reader) return;
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(new TextDecoder().decode(value));
		}
		expect(chunks.join("")).toBe("data: 1\n\ndata: 2\n\n");
		textSpy.mockRestore();
		arrayBufferSpy.mockRestore();
	});

	it("rejects upstream redirects", () => {
		expect(() =>
			wrapOpenCodeUpstreamResponse(
				new Response(null, {
					status: 302,
					headers: { location: "https://evil.example/" },
				}),
			),
		).toThrow(/redirect/i);
	});
});
