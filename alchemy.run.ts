import path from "node:path";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { config } from "dotenv";
import * as Effect from "effect/Effect";
import type { AppState, Sandbox } from "./apps/web/src/worker.ts";

const repoRoot = import.meta.dirname;
config({
	path: [path.join(repoRoot, ".env.local"), path.join(repoRoot, ".env")],
});

export const Website = Cloudflare.Website.Vite("website", {
	name: "ditto-website-ayan",
	rootDir: path.join(repoRoot, "apps/web"),
	main: "src/worker.ts",
	env: {
		DB: Cloudflare.D1.Database("database", { name: "ditto-ayan-db" }),
		BACKUP_BUCKET: Cloudflare.R2.Bucket("sandbox-backups", {
			name: "ditto-ayan-sandbox-backups",
		}),
		Sandbox: Cloudflare.Container<Sandbox>("sandbox", {
			name: "ditto-sandbox-ayan",
			className: "Sandbox",
			image: "docker.io/cloudflare/sandbox:0.12.3",
			instanceType: "lite",
			maxInstances: 1,
		}),
		AppState: Cloudflare.DurableObject<AppState>("AppState"),
	},
});

export type WebsiteEnv = Cloudflare.InferEnv<typeof Website>;

export default Alchemy.Stack(
	"ditto",
	{
		providers: Cloudflare.providers(),
		state: Alchemy.localState(),
	},
	Effect.gen(function* () {
		const website = yield* Website;
		return { url: website.url };
	}),
);
