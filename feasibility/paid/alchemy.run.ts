import path from "node:path";

import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

import { COMPATIBILITY } from "../compatibility.ts";
import type { Bot } from "./bot.ts";

// Its own stack, run from this folder, so state lives in feasibility/paid/.alchemy and it shares
// nothing with the app stages, the local feasibility stage or the free-tier probe. Driven by owner.ts.
const TEST_STAGE = "paid-pi-trial-test";

export default Alchemy.Stack(
	"ditto-paid-pi-trial",
	{
		providers: Cloudflare.providers(),
		state: Alchemy.localState(),
	},
	Effect.gen(function* () {
		const stage = yield* Alchemy.Stage;
		// Local runs only. Dev is 1337, the auth suite 1338, verify-auth 1339, feasibility 1340-1343.
		// This stack takes 1344 and 1346, or 1345, 1347, 1348 and 1351 for the test stage (1349 and
		// 1350 belong to the Containers trial and the free-tier probe).
		const port = stage === TEST_STAGE ? 1345 : 1344;
		const cpu = yield* Cloudflare.KV.Namespace("cpu");
		const tail = yield* Cloudflare.Worker("cpu-tail", {
			name: `ditto-${stage}-cpu-tail`,
			main: path.join(import.meta.dirname, "cpu-tail.ts"),
			dev: { port: port + 2, strictPort: true },
			env: { CPU: cpu },
		});
		// Test-only: the simulated provider and AI binding are never bound outside the test stage.
		// The owner's stage binds Workers AI and the AI Gateway its requests go through (#35).
		const provider: Cloudflare.WorkerBindingProps =
			stage === TEST_STAGE
				? {
						PROVIDER: Cloudflare.Worker("simulated-provider", {
							name: `ditto-${stage}-simulated-provider`,
							main: path.join(import.meta.dirname, "..", "simulated-provider-worker.ts"),
							dev: { port: port + 3, strictPort: true },
						}),
						AI: Cloudflare.Worker("simulated-workers-ai", {
							name: `ditto-${stage}-simulated-workers-ai`,
							main: path.join(import.meta.dirname, "..", "simulated-workers-ai-worker.ts"),
							dev: { port: 1351, strictPort: true },
						}),
						AI_GATEWAY_ID: "simulated-gateway",
					}
				: {
						AI: Cloudflare.Workers.AI(),
						AI_GATEWAY_ID: (yield* Cloudflare.AI.Gateway("gateway", { collectLogs: true }))
							.gatewayId,
					};
		const trial = yield* Cloudflare.Worker("model-trial", {
			name: `ditto-${stage}-model-trial`,
			main: path.join(import.meta.dirname, "worker.ts"),
			compatibility: COMPATIBILITY,
			dev: { port, strictPort: true },
			tailConsumers: [tail],
			env: {
				...provider,
				CPU: cpu,
				BOT: Cloudflare.DurableObject<Bot>("bot", { className: "Bot" }),
				TRIAL_RUN_KEY: Config.Redacted("TRIAL_RUN_KEY"),
			},
		});
		return { url: trial.url };
	}),
);
