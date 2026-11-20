import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { betterAuth } from "better-auth";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { drizzle } from "drizzle-orm/d1";

import type { WebsiteEnv } from "../../../../alchemy.run.ts";
import * as schema from "../db/auth-schema.ts";
import { redirectOAuthUpstream } from "./oauth-upstream.ts";

export type AuthEnv = Omit<WebsiteEnv, "OAUTH_UPSTREAM" | "SESSION_EXPIRES_IN"> & {
	OAUTH_UPSTREAM?: string;
	SESSION_EXPIRES_IN?: string;
};

const WEEK = 60 * 60 * 24 * 7;

export function createAuth(env: AuthEnv) {
	if (env.OAUTH_UPSTREAM) redirectOAuthUpstream(env.OAUTH_UPSTREAM);
	const sessionExpiresIn = Number(env.SESSION_EXPIRES_IN ?? WEEK);

	return betterAuth({
		appName: "Ditto",
		baseURL: env.BETTER_AUTH_URL,
		secret: env.BETTER_AUTH_SECRET,
		trustedOrigins: [env.BETTER_AUTH_URL],
		database: drizzleAdapter(drizzle(env.DB, { relations: schema.authRelations }), {
			provider: "sqlite",
			schema,
		}),
		emailAndPassword: { enabled: false },
		socialProviders: {
			github: {
				clientId: env.GITHUB_CLIENT_ID,
				clientSecret: env.GITHUB_CLIENT_SECRET,
				authorizationEndpoint: env.OAUTH_UPSTREAM
					? `${env.OAUTH_UPSTREAM}/github.com/login/oauth/authorize`
					: undefined,
			},
		},
		user: {
			additionalFields: {
				firstName: { type: "string", required: false, input: false },
				lastName: { type: "string", required: false, input: false },
			},
			validateUserInfo: ({ user, source }) => {
				if (source.method === "oauth" && source.action === "create-user" && !user.emailVerified)
					return { error: "email_not_verified" };
			},
		},
		// Expiry slides forward with use, so an idle week ends the session.
		session: { expiresIn: sessionExpiresIn, updateAge: sessionExpiresIn / 168 },
		account: {
			encryptOAuthTokens: true,
			accountLinking: { enabled: true, disableImplicitLinking: true },
		},
		rateLimit: { enabled: true, storage: "database" },
		advanced: {
			useSecureCookies: env.BETTER_AUTH_URL.startsWith("https://"),
			ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
		},
		telemetry: { enabled: false },
		plugins: [tanstackStartCookies()],
	});
}
