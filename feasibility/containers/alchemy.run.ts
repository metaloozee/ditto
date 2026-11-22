import path from "node:path";

import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

import type { Workspace } from "./worker.ts";

// Its own stack, run from this folder, so state lives in feasibility/containers/.alchemy and it
// shares nothing with the app stages or the other feasibility stages. Driven by owner.ts.
export default Alchemy.Stack(
	"ditto-containers-trial",
	{
		providers: Cloudflare.providers(),
		state: Alchemy.localState(),
	},
	Effect.gen(function* () {
		const stage = yield* Alchemy.Stage;
		const instanceType = yield* Config.String("INSTANCE_TYPE").pipe(
			Config.withDefault("standard-1"),
		);
		const trial = yield* Cloudflare.Worker("workspaces", {
			name: `ditto-${stage}-workspaces`,
			main: path.join(import.meta.dirname, "worker.ts"),
			// Local runs only. Dev is 1337, the auth suite 1338, verify-auth 1339, feasibility
			// 1340-1343, the paid trial 1344-1348. This stack takes 1349.
			dev: { port: 1349, strictPort: true },
			env: {
				WORKSPACE: Cloudflare.Container<Workspace>("workspace", {
					className: "Workspace",
					context: path.join(import.meta.dirname, ".."),
					dockerfile: path.join(import.meta.dirname, "Dockerfile"),
					instanceType: instanceType as "standard-1",
					// One instance per trial workspace, and no more, whatever is requested.
					maxInstances: 2,
					observability: { logs: { enabled: true } },
				}),
				INSTANCE_TYPE: instanceType,
				MAX_MINUTES: "60",
				TRIAL_RUN_KEY: Config.Redacted("TRIAL_RUN_KEY"),
			},
		});
		return { url: trial.url };
	}),
);
