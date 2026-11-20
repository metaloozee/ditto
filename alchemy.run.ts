import path from "node:path";

import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

const AuthDatabase = Cloudflare.D1.Database("auth-db", {
	migrations: path.join(import.meta.dirname, "apps/web/drizzle"),
});

export class Website extends Cloudflare.Website.Vite<Website>()(
	"website",
	Effect.gen(function* () {
		const stage = yield* Alchemy.Stage;
		// The stage's canonical origin also fixes its local port, so callbacks match.
		const origin = new URL(yield* Effect.orDie(Config.String("BETTER_AUTH_URL")));
		return {
			name: `ditto-app-${stage}`,
			rootDir: path.join(import.meta.dirname, "apps/web"),
			main: "src/worker.ts",
			dev: { port: Number(origin.port) || 1337, strictPort: true },
			env: {
				DB: AuthDatabase,
				BETTER_AUTH_URL: origin.origin,
				BETTER_AUTH_SECRET: Config.Redacted("BETTER_AUTH_SECRET"),
				GITHUB_CLIENT_ID: Config.String("GITHUB_CLIENT_ID"),
				GITHUB_CLIENT_SECRET: Config.Redacted("GITHUB_CLIENT_SECRET"),
				GOOGLE_CLIENT_ID: Config.String("GOOGLE_CLIENT_ID"),
				GOOGLE_CLIENT_SECRET: Config.Redacted("GOOGLE_CLIENT_SECRET"),
				RESEND_API_KEY: Config.Redacted("RESEND_API_KEY"),
				// A sender on a Ditto-owned domain verified in Resend.
				RESEND_FROM: Config.String("RESEND_FROM"),
				// Test-only knobs: never bound outside the test stage.
				...(stage === "test"
					? {
							OAUTH_UPSTREAM: Config.String("OAUTH_UPSTREAM"),
							SESSION_EXPIRES_IN: Config.String("SESSION_EXPIRES_IN"),
							RESEND_BASE_URL: Config.String("RESEND_BASE_URL"),
							CODE_EXPIRES_IN: Config.String("CODE_EXPIRES_IN"),
							CODE_RESEND_IN: Config.String("CODE_RESEND_IN"),
						}
					: {}),
			},
		};
	}),
) {}

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
