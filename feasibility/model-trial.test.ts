import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vite-plus/test";

import { formatEvidence, runModelTrial, type TrialRun } from "./model-trial.ts";
import {
	ACCOUNT_ID,
	API_KEY,
	accessToken,
	EMAIL,
	refreshToken,
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
