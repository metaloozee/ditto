import path from "node:path";

import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";

// Port 1340: dev is 1337, the auth suite 1338, verify-auth 1339.
const Probe = Cloudflare.Worker("probe", {
	name: "ditto-feasibility-probe",
	main: path.join(import.meta.dirname, "probe.ts"),
	dev: { port: 1340, strictPort: true },
});

export default Alchemy.Stack(
	"ditto-feasibility",
	{
		providers: Cloudflare.providers(),
		state: Alchemy.localState(),
	},
	Effect.gen(function* () {
		const probe = yield* Probe;
		return { url: probe.url };
	}),
);
