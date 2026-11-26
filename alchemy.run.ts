import path from "node:path";

import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

import type { BotRpc } from "./apps/web/src/bot-rpc.ts";
import type { CredentialsRpc } from "./apps/web/src/credentials-rpc.ts";
import type { WorkspaceRpc } from "./apps/web/src/workspace-rpc.ts";

const AuthDatabase = Cloudflare.D1.Database("auth-db", {
	migrations: path.join(import.meta.dirname, "apps/web/drizzle"),
});

// Private: no r2.dev URL, custom domain or CORS. Only the app Worker reads it, after checking ownership.
const Files = Cloudflare.R2.Bucket("files", { publicAccess: false });

export class Website extends Cloudflare.Website.Vite<Website>()(
	"website",
	Effect.gen(function* () {
		const stage = yield* Alchemy.Stage;
		// The stage's canonical origin also fixes its local port, so callbacks match.
		const origin = new URL(yield* Effect.orDie(Config.String("BETTER_AUTH_URL")));
		// The shared computer's size and how many may run at once across the stage. There is no
		// spending cap, so an operator sets the limit; the disposable test stage keeps 2.
		const instanceType = yield* Effect.orDie(
			Config.String("COMPUTER_INSTANCE_TYPE").pipe(Config.withDefault("standard-1")),
		);
		const maxInstances =
			stage === "test"
				? 2
				: yield* Effect.orDie(Config.Int("COMPUTER_MAX_INSTANCES").pipe(Config.withDefault(2)));
		return {
			name: `ditto-app-${stage}`,
			rootDir: path.join(import.meta.dirname, "apps/web"),
			main: "src/worker.ts",
			// Matches the pinned workerd. The date alone turns on `nodejs_compat`.
			compatibility: { date: "2026-10-26" },
			dev: { port: Number(origin.port) || 1337, strictPort: true },
			env: {
				DB: AuthDatabase,
				FILES: Files,
				WORKSPACE: Cloudflare.Container<WorkspaceRpc>("workspace", {
					className: "Workspace",
					// The feasibility image: the egress filter and the shared computer (ADR-0013).
					context: path.join(import.meta.dirname, "feasibility"),
					dockerfile: path.join(import.meta.dirname, "feasibility/containers/Dockerfile"),
					instanceType: instanceType as "standard-1",
					maxInstances,
				}),
				// Seconds after a start when the instance is destroyed regardless.
				COMPUTER_LIFETIME_SECONDS: Config.String("COMPUTER_LIFETIME_SECONDS").pipe(
					Config.withDefault("3600"),
				),
				// Encrypts the shared computer's stored browser cookies (#20). Losing it loses them.
				COOKIE_ENCRYPTION_KEY: Config.Redacted("COOKIE_ENCRYPTION_KEY"),
				// Encrypts each account's stored model connections (#18). Losing it loses them.
				CREDENTIALS_ENCRYPTION_KEY: Config.Redacted("CREDENTIALS_ENCRYPTION_KEY"),
				BOT: Cloudflare.DurableObject<BotRpc>("bot", { className: "Bot" }),
				CREDENTIALS: Cloudflare.DurableObject<CredentialsRpc>("credentials", {
					className: "Credentials",
				}),
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
							// Shortens the five idle minutes before the shared computer stops.
							COMPUTER_IDLE_SECONDS: Config.String("COMPUTER_IDLE_SECONDS"),
							// Where OpenCode's OpenAI API is reached instead of opencode.ai.
							OPENCODE_BASE_URL: Config.String("OPENCODE_BASE_URL"),
							// Opens the gateway's test hooks and the interrupted-open, failed-open and failed bot-list faults.
							TEST_HOOKS: "on",
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
