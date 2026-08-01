import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { betterAuth } from "better-auth/minimal";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { createDb } from "#/db";
import * as schema from "#/db/schema";

export function createAuth(env: Env) {
	const db = createDb(env);

	return betterAuth({
		secret: env.BETTER_AUTH_SECRET,
		baseURL: env.BETTER_AUTH_URL || undefined,
		// Local vite + Tailscale Serve can both hit the same worker.
		trustedOrigins: ["http://localhost:5173", "http://127.0.0.1:5173"],
		database: drizzleAdapter(db, {
			provider: "sqlite",
			schema,
		}),
		socialProviders: {
			github: {
				clientId: env.GITHUB_CLIENT_ID,
				clientSecret: env.GITHUB_CLIENT_SECRET,
			},
		},
		plugins: [tanstackStartCookies()],
	});
}
