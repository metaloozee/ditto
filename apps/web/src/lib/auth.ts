import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { betterAuth } from "better-auth";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { drizzle } from "drizzle-orm/d1";

import type { WebsiteEnv } from "../../../../alchemy.run.ts";
import * as schema from "../db/auth-schema.ts";
import { emailCode } from "./email-code.ts";
import { sendCodeEmail } from "./email.ts";
import { redirectOAuthUpstream } from "./oauth-upstream.ts";

type TestOnly =
	| "OAUTH_UPSTREAM"
	| "SESSION_EXPIRES_IN"
	| "RESEND_BASE_URL"
	| "CODE_EXPIRES_IN"
	| "CODE_RESEND_IN";

export type AuthEnv = Omit<WebsiteEnv, TestOnly> & Partial<Record<TestOnly, string>>;

const WEEK = 60 * 60 * 24 * 7;

export function createAuth(env: AuthEnv) {
	if (env.OAUTH_UPSTREAM) redirectOAuthUpstream(env.OAUTH_UPSTREAM);
	const sessionExpiresIn = Number(env.SESSION_EXPIRES_IN ?? WEEK);
	const db = drizzle(env.DB, { relations: schema.authRelations });

	return betterAuth({
		appName: "Ditto",
		baseURL: env.BETTER_AUTH_URL,
		secret: env.BETTER_AUTH_SECRET,
		trustedOrigins: [env.BETTER_AUTH_URL],
		database: drizzleAdapter(db, {
			provider: "sqlite",
			schema,
		}),
		emailAndPassword: { enabled: false },
		disabledPaths: ["/update-user"],
		socialProviders: {
			github: {
				clientId: env.GITHUB_CLIENT_ID,
				clientSecret: env.GITHUB_CLIENT_SECRET,
				authorizationEndpoint: env.OAUTH_UPSTREAM
					? `${env.OAUTH_UPSTREAM}/github.com/login/oauth/authorize`
					: undefined,
			},
			google: {
				clientId: env.GOOGLE_CLIENT_ID,
				clientSecret: env.GOOGLE_CLIENT_SECRET,
				disableIdTokenSignIn: true,
				authorizationEndpoint: env.OAUTH_UPSTREAM
					? `${env.OAUTH_UPSTREAM}/accounts.google.com/o/oauth2/v2/auth`
					: undefined,
				mapProfileToUser: async (profile) => {
					const names = { firstName: profile.given_name, lastName: profile.family_name };
					if (profile.email_verified === true && profile.email) return names;

					// Better Auth checks for an email match before validating registration.
					// Without email proof, only an already-linked Google identity can return.
					const linked = await db.query.account.findFirst({
						where: { providerId: "google", accountId: profile.sub },
						columns: {},
						with: { user: { columns: { email: true } } },
					});
					return { ...names, email: linked?.user?.email ?? "", emailVerified: false };
				},
			},
		},
		user: {
			// Settable like `name`, so providers' structured names can fill them.
			additionalFields: {
				firstName: { type: "string", required: false },
				lastName: { type: "string", required: false },
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
		databaseHooks: {
			account: {
				// Better Auth encrypts access and refresh tokens. Ditto has no use for stored ID tokens.
				create: { before: async (account) => ({ data: { ...account, idToken: null } }) },
				update: { before: async (account) => ({ data: { ...account, idToken: null } }) },
			},
		},
		rateLimit: { enabled: true, storage: "database" },
		advanced: {
			useSecureCookies: env.BETTER_AUTH_URL.startsWith("https://"),
			ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
		},
		telemetry: { enabled: false },
		plugins: [
			emailCode(db, {
				expiresIn: Number(env.CODE_EXPIRES_IN ?? 5 * 60),
				resendIn: Number(env.CODE_RESEND_IN ?? 30),
				send: (email) => sendCodeEmail(env, email),
			}),
			tanstackStartCookies(),
		],
	});
}
