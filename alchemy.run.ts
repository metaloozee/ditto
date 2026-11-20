import path from "node:path";

import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";

export default Alchemy.Stack(
	"ditto",
	{
		providers: Cloudflare.providers(),
		state: Alchemy.localState(),
	},
	Effect.gen(function* () {
		const stage = yield* Alchemy.Stage;
		const website = yield* Cloudflare.Website.Vite("website", {
			name: `ditto-app-${stage}`,
			rootDir: path.join(import.meta.dirname, "apps/web"),
			main: "src/worker.ts",
		});
		return { url: website.url };
	}),
);
