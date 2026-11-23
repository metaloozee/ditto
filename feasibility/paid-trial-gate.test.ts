import { describe, expect, it } from "vite-plus/test";

import paidWorker, { type PaidTrialEnv } from "./paid/worker.ts";
import { accessToken, refreshToken, simulatedProvider } from "./simulated-provider.ts";

const RUN_KEY = "run-key-SIMULATED-0123456789abcdefghijklmnop";
const ORIGIN = "https://ditto-paid-pi-trial.example.workers.dev";

function env(overrides: Partial<PaidTrialEnv> = {}) {
	const provider = simulatedProvider();
	const hosts: string[] = [];
	const store = new Map<string, string>();
	const bot: string[] = [];
	const value: PaidTrialEnv = {
		TRIAL_RUN_KEY: RUN_KEY,
		BOT: {
			getByName: () => ({
				fetch: async (request: Request) => {
					bot.push(new URL(request.url).pathname);
					return new Response("reached the Durable Object");
				},
			}),
		},
		PROVIDER: {
			fetch(request) {
				hosts.push(new URL(request.url).host);
				return provider.fetch(request);
			},
		},
		CPU: {
			get: async (key) => store.get(key) ?? null,
			put: async (key, v) => void store.set(key, v),
		},
		...overrides,
	};
	return { env: value, hosts, store, bot };
}

const ctx = () => {
	const pending: Promise<unknown>[] = [];
	return { pending, waitUntil: (p: Promise<unknown>) => void pending.push(p) };
};

function trialRequest(key?: string) {
	return new Request(`${ORIGIN}/model-trial`, {
		method: "POST",
		headers: key === undefined ? {} : { "x-trial-key": key },
		body: JSON.stringify({
			route: "chatgpt",
			credential: {
				type: "oauth",
				access: accessToken(1),
				refresh: refreshToken(1),
				expires: Date.now() + 3_600_000,
			},
		}),
	});
}

describe("paid model-trial Worker gate", () => {
	it.each([
		["no key", undefined],
		["a wrong key", "wrong"],
		["the key with a different suffix", `${RUN_KEY}x`],
	])("refuses a trial with %s and spends nothing", async (_, key) => {
		const { env: e, hosts } = env();
		const c = ctx();
		const response = await paidWorker.fetch(trialRequest(key), e, c);

		expect(response.status).toBe(401);
		await Promise.all(c.pending);
		expect(hosts).toEqual([]);
	});

	it("refuses every trial when no run key is configured, even one sending an empty key", async () => {
		const { env: e, hosts } = env({ TRIAL_RUN_KEY: "" });
		const response = await paidWorker.fetch(trialRequest(""), e, ctx());

		expect(response.status).toBe(401);
		expect(hosts).toEqual([]);
	});

	it.each(["/siwc/import", "/siwc/trial", "/workers-ai/trial"])(
		"keeps %s, which holds or spends the owner's plan or account, behind the key",
		async (path) => {
			const { env: e, bot } = env();
			const response = await paidWorker.fetch(
				new Request(`${ORIGIN}${path}`, { method: "POST", body: "{}" }),
				e,
				ctx(),
			);

			expect(response.status).toBe(401);
			expect(bot).toEqual([]);
		},
	);

	it("sends the Workers AI trial to the Bot Durable Object for the owner's key", async () => {
		const { env: e, bot } = env();
		const response = await paidWorker.fetch(
			new Request(`${ORIGIN}/workers-ai/trial`, {
				method: "POST",
				headers: { "x-trial-key": RUN_KEY },
				body: "{}",
			}),
			e,
			ctx(),
		);

		expect(await response.text()).toBe("reached the Durable Object");
		expect(bot).toEqual(["/workers-ai/trial"]);
	});

	it("hides the runtime report and CPU readings from callers without the key", async () => {
		const { env: e } = env();
		for (const path of ["/model-trial", "/model-trial/cpu?run=abc"]) {
			const response = await paidWorker.fetch(new Request(`${ORIGIN}${path}`), e, ctx());
			expect(response.status).toBe(401);
		}
	});

	it("runs the trial for the owner's key and reports the data centre", async () => {
		const { env: e, hosts } = env();
		const c = ctx();
		const request = trialRequest(RUN_KEY);
		Object.defineProperty(request, "cf", { value: { colo: "AMS" } });
		const response = await paidWorker.fetch(request, e, c);

		expect(response.status).toBe(200);
		expect(response.headers.get("x-trial-colo")).toBe("AMS");
		const lines = (await response.text()).trim().split("\n");
		const done = JSON.parse(lines.at(-1) ?? "{}");
		expect(done).toMatchObject({ type: "done", run: { outcome: "pass" } });
		expect(hosts).toContain("auth.openai.com");
	});

	it.each([
		["a body that is not JSON", "{"],
		[
			"an unknown route",
			JSON.stringify({ route: "gemini", credential: { type: "api_key", key: "k" } }),
		],
		["no credential", JSON.stringify({ route: "chatgpt" })],
		["a credential that is not an object", JSON.stringify({ route: "opencode", credential: "k" })],
		[
			"a model that is not a string",
			JSON.stringify({ route: "opencode", model: 5, credential: { type: "api_key", key: "k" } }),
		],
	])("answers 400 to %s before spending anything", async (_, body) => {
		const { env: e, hosts } = env();
		const c = ctx();
		const response = await paidWorker.fetch(
			new Request(`${ORIGIN}/model-trial`, {
				method: "POST",
				headers: { "x-trial-key": RUN_KEY },
				body,
			}),
			e,
			c,
		);

		expect(response.status).toBe(400);
		await Promise.all(c.pending);
		expect(hosts).toEqual([]);
	});

	it("returns the CPU reading the tail Worker stored for a run", async () => {
		const { env: e, store } = env();
		store.set("cpu:run-1", JSON.stringify({ cpuTimeMs: 41, wallTimeMs: 3200 }));
		const headers = { "x-trial-key": RUN_KEY };

		const found = await paidWorker.fetch(
			new Request(`${ORIGIN}/model-trial/cpu?run=run-1`, { headers }),
			e,
			ctx(),
		);
		const missing = await paidWorker.fetch(
			new Request(`${ORIGIN}/model-trial/cpu?run=run-2`, { headers }),
			e,
			ctx(),
		);

		expect(await found.json()).toEqual({ cpuTimeMs: 41, wallTimeMs: 3200 });
		expect(missing.status).toBe(404);
	});
});
