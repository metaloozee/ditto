// A simulated ChatGPT and OpenCode provider: Web APIs only, so it serves both the
// Node tests and the simulated-provider Worker in the feasibility-test stage.
export const ACCOUNT_ID = "9f1c2a7e-4b3d-4c55-8e21-0a6b7c8d9e10";
export const EMAIL = "owner@example.org";
export const API_KEY = "sk-opencode-SIMULATED-0123456789abcdefghijklmnop";

export function jwt(claims: Record<string, unknown>) {
	const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, "");
	return `${encode({ alg: "none" })}.${encode(claims)}.c2lnbmF0dXJl`;
}

export function accessToken(generation: number) {
	return jwt({
		sub: `auth0|user-${generation}`,
		email: EMAIL,
		"https://api.openai.com/auth": { chatgpt_account_id: ACCOUNT_ID },
		"https://api.openai.com/profile": { email: EMAIL },
		gen: generation,
	});
}

export const refreshToken = (generation: number) => `rt_SIMULATED_${generation}_${"x".repeat(48)}`;

function sse(text: string) {
	const events = [
		{ type: "response.created", response: { id: "resp_sim" } },
		{
			type: "response.output_item.added",
			output_index: 0,
			item: { type: "message", id: "msg_sim", role: "assistant", content: [] },
		},
		{ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: text },
		{
			type: "response.output_item.done",
			output_index: 0,
			item: {
				type: "message",
				id: "msg_sim",
				role: "assistant",
				status: "completed",
				content: [{ type: "output_text", text }],
			},
		},
		{
			type: "response.completed",
			response: {
				id: "resp_sim",
				status: "completed",
				usage: { input_tokens: 12, output_tokens: 2, total_tokens: 14 },
			},
		},
	];
	const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
	return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

export type Fault = { status: number; body: string };

/**
 * Simulates auth.openai.com, the ChatGPT Codex Responses endpoint and OpenCode
 * Zen's OpenAI Responses endpoint. Refresh rotates both tokens, and the old
 * access token stops working, so a turn after refresh proves the new one is used.
 */
export function simulatedProvider(
	faults: { refresh?: Fault; responses?: (Fault | undefined)[] } = {},
) {
	let generation = 1;
	let responseCalls = 0;
	const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const request = new Request(input, init);
		const url = new URL(request.url);
		if (url.href === "https://auth.openai.com/oauth/token") {
			if (faults.refresh)
				return new Response(faults.refresh.body, { status: faults.refresh.status });
			const form = new URLSearchParams(await request.text());
			if (form.get("refresh_token") !== refreshToken(generation)) {
				return new Response('{"error":"invalid_grant"}', { status: 400 });
			}
			generation += 1;
			return Response.json({
				access_token: accessToken(generation),
				refresh_token: refreshToken(generation),
				id_token: jwt({ email: EMAIL }),
				expires_in: 864_000,
			});
		}
		const isCodex = url.href === "https://chatgpt.com/backend-api/codex/responses";
		const isOpenCode = url.href === "https://opencode.ai/inference/openai/v1/responses";
		if (isCodex || isOpenCode) {
			const fault = faults.responses?.[responseCalls++];
			if (fault) return new Response(fault.body, { status: fault.status });
			const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
			const expected = isCodex ? accessToken(generation) : API_KEY;
			if (token !== expected) return new Response('{"error":"unauthorized"}', { status: 401 });
			if (isCodex && request.headers.get("chatgpt-account-id") !== ACCOUNT_ID) {
				return new Response('{"error":"missing account"}', { status: 401 });
			}
			return sse("pong");
		}
		return new Response("unexpected host", { status: 599 });
	};
	return { fetch, generation: () => generation };
}
