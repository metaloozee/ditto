import path from "node:path";

import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

// Its own stack, run from this folder, so state lives in feasibility/free-tier/.alchemy and it
// shares nothing with the app stages or the local feasibility stage. Driven by owner.ts.
const Store = Cloudflare.KV.Namespace("probe-store");

const Probe = Cloudflare.Worker("probe", {
	name: "ditto-free-tier-probe",
	main: path.join(import.meta.dirname, "worker.ts"),
	// Local smoke runs only. Dev is 1337, the auth suite 1338, verify-auth 1339, feasibility 1340.
	dev: { port: 1341, strictPort: true },
	env: {
		STORE: Store,
		PROBE_MODEL: Config.String("PROBE_MODEL"),
		PROBE_RUN_KEY: Config.Redacted("PROBE_RUN_KEY"),
		CHATGPT_ACCESS_TOKEN: Config.Redacted("CHATGPT_ACCESS_TOKEN"),
		CHATGPT_REFRESH_TOKEN: Config.Redacted("CHATGPT_REFRESH_TOKEN"),
	},
});

export default Alchemy.Stack(
	"ditto-free-tier-probe",
	{
		providers: Cloudflare.providers(),
		state: Alchemy.localState(),
	},
	Effect.gen(function* () {
		const probe = yield* Probe;
		return { url: probe.url };
	}),
);
