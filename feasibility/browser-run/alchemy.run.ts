import path from "node:path";

import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

import { COMPATIBILITY } from "../compatibility.ts";
import type { Workspace } from "./worker.ts";

// Its own stack, run from this folder, so state lives in feasibility/browser-run/.alchemy and it
// shares nothing with the app stages or the other feasibility stages. Driven by owner.ts.
export default Alchemy.Stack(
	"ditto-browser-run-trial",
	{
		providers: Cloudflare.providers(),
		state: Alchemy.localState(),
	},
	Effect.gen(function* () {
		const stage = yield* Alchemy.Stage;
		const trial = yield* Cloudflare.Worker("workspaces", {
			name: `ditto-${stage}-workspaces`,
			main: path.join(import.meta.dirname, "worker.ts"),
			compatibility: COMPATIBILITY,
			// Local runs only. Dev is 1337, the auth suite 1338, verify-auth 1339, feasibility
			// 1340-1343, the paid trial 1344-1348, the Containers trial 1349. This stack takes 1350.
			dev: { port: 1350, strictPort: true },
			env: {
				BROWSER: Cloudflare.Browser(),
				WORKSPACE: Cloudflare.DurableObject<Workspace>("workspace", { className: "Workspace" }),
				TRIAL_RUN_KEY: Config.Redacted("TRIAL_RUN_KEY"),
				COOKIE_KEY: Config.Redacted("COOKIE_KEY"),
			},
		});
		return { url: trial.url };
	}),
);
