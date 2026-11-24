import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vite-plus/test";

import { formatEvidence, runModelTrial, type TrialRun } from "./model-trial.ts";
import {
	ACCOUNT_ID,
	API_KEY,
	accessToken,
	EMAIL,
	refreshToken,
	SIWC_CLIENT_ID,
	SIWC_SCOPE,
	simulatedProvider,
} from "./simulated-provider.ts";

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

describe("deployed Worker route (#31)", () => {
	const origin = "deployed Worker (Cloudflare network, Workers Paid, data centre AMS)";

	it("names the container route as the fallback when the provider blocks Cloudflare", async () => {
		const run = await runModelTrial({
			route: "chatgpt",
			credentials: await chatgptCredentials(),
			fetch: simulatedProvider({
				responses: [
					{
						status: 403,
						body: `<html>\n  <head><style>body{font-family:Arial}</style></head>\n  <body><svg><path d="M37.5 16.8"/></svg>\n    <p>Sorry, you have been blocked</p>\n  </body>\n</html>`,
					},
				],
			}).fetch,
		});

		const entry = formatEvidence([{ ...run, request: { cpuMs: 41.2, wallMs: 3200 } }], {
			origin,
			deployed: true,
		});
		expect(entry).toMatch(/· fail\n/);
		expect(entry).toMatch(/- \*\*Fallback:\*\* .*container route/);
		expect(entry).toContain("403): Sorry, you have been blocked");
		expect(entry).toContain(
			"- **CPU time:** whole trial request 41ms CPU, 3200ms wall, from the Worker's tail event. Worst 41ms: over the Workers free plan (10ms per request), within the paid plan default",
		);
		expectNoSecrets(entry);
	});
});

async function siwcCredentials() {
	const credentials = new InMemoryCredentialStore();
	await credentials.modify("openai", async () => ({
		type: "oauth",
		access: accessToken(1),
		refresh: refreshToken(1),
		expires: Date.now() + 3_600_000,
		clientId: SIWC_CLIENT_ID,
		scopes: SIWC_SCOPE.split(" "),
	}));
	return credentials;
}

describe("ChatGPT plan through Sign in with ChatGPT (#34)", () => {
	it("passes a turn, a refresh and a turn on api.openai.com, with the refreshed lifetime and scopes", async () => {
		const provider = simulatedProvider();
		const run = await runModelTrial({
			route: "siwc",
			credentials: await siwcCredentials(),
			fetch: provider.fetch,
		});

		expect(run.outcome).toBe("pass");
		expect(provider.generation("siwc")).toBe(2);
		const entry = formatEvidence([run], { origin: "home network" });
		expect(entry).toMatch(
			/^#### .* · OpenAI Responses on ChatGPT plan through Sign in with ChatGPT/,
		);
		expect(entry).toContain(
			"one turn at https://api.openai.com/v1/responses, expire the stored access token and refresh it at https://auth.openai.com/api/accounts/oauth/token, then one more turn",
		);
		expect(entry).toMatch(
			/refresh passed \(auth\.openai\.com\/api\/accounts\/oauth\/token 200\): expires_in 3600s \(1h\), granted scope `chatgpt\.tokens\.use\.direct email offline_access openid profile resource\.invoke`, a new refresh token/,
		);
		expectNoSecrets(entry);
		expect(entry).not.toContain(SIWC_CLIENT_ID);
	});

	it("lists the request fields Pi sent and confirms none the flow rejects", async () => {
		const run = await runModelTrial({
			route: "siwc",
			credentials: await siwcCredentials(),
			fetch: simulatedProvider().fetch,
		});

		const entry = formatEvidence([run], { origin: "home network" });
		expect(entry).toMatch(
			/- \*\*Request fields:\*\* Pi sent `model`, `input`, `stream`, .*`store`.*; input roles `user`\. None of the fields the flow rejects \(`temperature`, `max_output_tokens`, `previous_response_id`, `prompt`, system-role items\)\. The trial sends no system prompt, so system-role items are not exercised\./,
		);
		expect(entry).toContain("- **Plan-usage error codes:** none");
	});

	it("records a subscription_sharing error code the endpoint returns", async () => {
		const run = await runModelTrial({
			route: "siwc",
			credentials: await siwcCredentials(),
			fetch: simulatedProvider({
				responses: [
					{
						status: 403,
						body: JSON.stringify({
							error: {
								code: "subscription_sharing_user_not_eligible",
								message: `Plan use is unavailable for ${EMAIL}`,
							},
						}),
					},
				],
			}).fetch,
		});

		expect(run.outcome).toBe("fail");
		const entry = formatEvidence([run], { origin: "home network" });
		expect(entry).toContain(
			"- **Plan-usage error codes:** `subscription_sharing_user_not_eligible`",
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
