import path from "node:path";

import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";

import { COMPATIBILITY } from "./compatibility.ts";

const TEST_STAGE = "feasibility-test";

export default Alchemy.Stack(
	"ditto-feasibility",
	{
		providers: Cloudflare.providers(),
		state: Alchemy.localState(),
	},
	Effect.gen(function* () {
		const stage = yield* Alchemy.Stage;
		// Ports 1340-1341, or 1342-1343 for the test stage: dev is 1337, the auth suite 1338,
		// verify-auth 1339.
		const port = stage === TEST_STAGE ? 1342 : 1340;
		const probe = yield* Cloudflare.Worker("probe", {
			name: `ditto-${stage}-probe`,
			main: path.join(import.meta.dirname, "probe.ts"),
			dev: { port, strictPort: true },
		});
		// Test-only: the simulated provider is never bound outside the test stage.
		const env: Cloudflare.WorkerBindingProps =
			stage === TEST_STAGE
				? {
						PROVIDER: Cloudflare.Worker("simulated-provider", {
							name: `ditto-${stage}-simulated-provider`,
							main: path.join(import.meta.dirname, "simulated-provider-worker.ts"),
						}),
					}
				: {};
		const modelTrial = yield* Cloudflare.Worker("model-trial", {
			name: `ditto-${stage}-model-trial`,
			main: path.join(import.meta.dirname, "model-worker.ts"),
			compatibility: COMPATIBILITY,
			dev: { port: port + 1, strictPort: true },
			env,
		});
		return { url: probe.url, modelTrial: modelTrial.url };
	}),
);
