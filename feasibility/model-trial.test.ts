import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vite-plus/test";

import { formatEvidence, runModelTrial, type TrialRun } from "./model-trial.ts";

const ACCOUNT_ID = "9f1c2a7e-4b3d-4c55-8e21-0a6b7c8d9e10";
const EMAIL = "owner@example.org";
const API_KEY = "sk-opencode-SIMULATED-0123456789abcdefghijklmnop";

function jwt(claims: Record<string, unknown>) {
	const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, "");
	return `${encode({ alg: "none" })}.${encode(claims)}.c2lnbmF0dXJl`;
}

function accessToken(generation: number) {
	return jwt({
		sub: `auth0|user-${generation}`,
		email: EMAIL,
		"https://api.openai.com/auth": { chatgpt_account_id: ACCOUNT_ID },
		"https://api.openai.com/profile": { email: EMAIL },
		gen: generation,
	});
}

const refreshToken = (generation: number) => `rt_SIMULATED_${generation}_${"x".repeat(48)}`;

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

type Fault = { status: number; body: string };

/**
 * Simulates auth.openai.com, the ChatGPT Codex Responses endpoint and OpenCode
 * Zen's OpenAI Responses endpoint. Refresh rotates both tokens, and the old
 * access token stops working, so a turn after refresh proves the new one is used.
 */
function simulatedProvider(faults: { refresh?: Fault; responses?: (Fault | undefined)[] } = {}) {
	let generation = 1;
	let responseCalls = 0;
	const bearer = (init?: RequestInit) =>
		new Headers(init?.headers).get("authorization")?.replace(/^Bearer /, "");

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
			const token = bearer(init) ?? new Headers(request.headers).get("authorization");
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

async function chatgptCredentials() {
	const credentials = new InMemoryCredentialStore();
	await credentials.modify("openai-codex", async () => ({
		type: "oauth",
		access: accessToken(1),
		refresh: refreshToken(1),
		expires: Date.now() + 3_600_000,
	}));
	return credentials;
}

async function opencodeCredentials() {
	const credentials = new InMemoryCredentialStore();
	await credentials.modify("opencode", async () => ({ type: "api_key", key: API_KEY }));
	return credentials;
}

const allSecrets = [
	...[1, 2, 3, 4].flatMap((g) => [accessToken(g), refreshToken(g)]),
	ACCOUNT_ID,
	EMAIL,
	API_KEY,
	"SIMULATED",
];

function expectNoSecrets(entry: string) {
	for (const secret of allSecrets) expect(entry).not.toContain(secret);
}

describe("ChatGPT route", () => {
	it("passes a turn, a token refresh and a turn on the refreshed token", async () => {
		const provider = simulatedProvider();
		const run = await runModelTrial({
			route: "chatgpt",
			credentials: await chatgptCredentials(),
			fetch: provider.fetch,
		});

		expect(run.outcome).toBe("pass");
		expect(provider.generation()).toBe(2);
		const entry = formatEvidence([run], { origin: "home network" });
		expect(entry).toMatch(/^#### \d{4}-\d{2}-\d{2} · .*ChatGPT.* · pass\n/);
		expect(entry).toContain("- **Runtime:** Pi `@earendil-works/pi-ai` 1.6.0");
		expect(entry).toContain("- **Network origin:** home network");
		expect(entry).toContain("- **Expected:**");
		expect(entry).toMatch(
			/- \*\*Observed:\*\* .*refresh passed \(auth\.openai\.com\/oauth\/token 200\)/,
		);
		expect(entry).toContain("- **Retries:** none");
		expect(entry).toContain("- **Fallback:** none needed");
		expectNoSecrets(entry);
	});

	it("redacts tokens, account ids and emails that a failed refresh echoes back", async () => {
		const body = JSON.stringify({
			error: "invalid_grant",
			refresh_token: refreshToken(1),
			access_token: accessToken(1),
			account: ACCOUNT_ID,
			email: EMAIL,
			unknown_token: `rt_SIMULATED_unseen_${"y".repeat(60)}`,
		});
		const run = await runModelTrial({
			route: "chatgpt",
			credentials: await chatgptCredentials(),
			fetch: simulatedProvider({ refresh: { status: 400, body } }).fetch,
		});

		expect(run.outcome).toBe("fail");
		const entry = formatEvidence([run], { origin: "home network" });
		expect(entry).toContain("400");
		expect(entry).toContain("invalid_grant");
		expect(entry).toContain("- **Fallback:** OpenCode API key route (ADR-0003)");
		expectNoSecrets(entry);
	});

	it("keeps an intermittent failure visible across repeated runs", async () => {
		const credentials = await chatgptCredentials();
		const provider = simulatedProvider({
			responses: [undefined, undefined, { status: 503, body: "upstream overloaded" }],
		});
		const runs: TrialRun[] = [];
		for (let i = 0; i < 3; i++) {
			runs.push(await runModelTrial({ route: "chatgpt", credentials, fetch: provider.fetch }));
		}

		expect(runs.map((r) => r.outcome)).toEqual(["pass", "fail", "pass"]);
		const entry = formatEvidence(runs, { origin: "home network" });
		expect(entry).toMatch(/· fail\n/);
		expect(entry).toMatch(
			/- \*\*Retries:\*\* \d{2}:\d{2} UTC fail \(.*503.*\), \d{2}:\d{2} UTC pass\n/,
		);
		expectNoSecrets(entry);
	});
});

describe("OpenCode API key route", () => {
	it("passes two turns and records that an API key has no refresh", async () => {
		const run = await runModelTrial({
			route: "opencode",
			credentials: await opencodeCredentials(),
			fetch: simulatedProvider().fetch,
		});

		expect(run.outcome).toBe("pass");
		const entry = formatEvidence([run], { origin: "home network" });
		expect(entry).toMatch(/^#### \d{4}-\d{2}-\d{2} · .*OpenCode.* · pass\n/);
		expect(entry).toContain("refresh not applicable");
		expectNoSecrets(entry);
	});

	it("never prints the API key, even when the provider echoes it", async () => {
		const run = await runModelTrial({
			route: "opencode",
			credentials: await opencodeCredentials(),
			fetch: simulatedProvider({
				responses: [{ status: 401, body: `{"error":"invalid key ${API_KEY}"}` }],
			}).fetch,
		});

		expect(run.outcome).toBe("fail");
		const entry = formatEvidence([run], { origin: "home network" });
		expect(entry).toContain("401");
		expectNoSecrets(entry);
	});
});
