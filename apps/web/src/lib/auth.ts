import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { betterAuth } from "better-auth";
import {
	addOAuthServerContext,
	APIError,
	createAuthMiddleware,
	getAuthoritativeSessionFromCtx,
	getOAuthState,
} from "better-auth/api";
import { lastLoginMethod } from "better-auth/plugins";
import { github } from "better-auth/social-providers";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { drizzle } from "drizzle-orm/d1";

import type { WebsiteEnv } from "../../../../alchemy.run.ts";
import * as schema from "../db/auth-schema.ts";
import { EMAIL_METHOD, emailCode, emailSignIn, type EmailCodeOptions } from "./email-code.ts";
import { sendCodeEmail } from "./email.ts";
import { redirectOAuthUpstream } from "./oauth-upstream.ts";

type TestOnly =
	| "OAUTH_UPSTREAM"
	| "SESSION_EXPIRES_IN"
	| "RESEND_BASE_URL"
	| "CODE_EXPIRES_IN"
	| "CODE_RESEND_IN"
	| "WORKSPACE_PROBE";

export type AuthEnv = Omit<WebsiteEnv, TestOnly> & Partial<Record<TestOnly, string>>;

const WEEK = 60 * 60 * 24 * 7;

export function createAuth(env: AuthEnv, waitUntil?: (task: Promise<unknown>) => void) {
	if (env.OAUTH_UPSTREAM) redirectOAuthUpstream(env.OAUTH_UPSTREAM);
	const sessionExpiresIn = Number(env.SESSION_EXPIRES_IN ?? WEEK);
	const db = drizzle(env.DB, { relations: schema.authRelations });
	const codes: EmailCodeOptions = {
		expiresIn: Number(env.CODE_EXPIRES_IN ?? 5 * 60),
		resendIn: Number(env.CODE_RESEND_IN ?? 30),
		send: (email) => sendCodeEmail(env, email),
	};

	const signUpCode = emailCode(db, codes);
	const signInOTP = emailSignIn(db, codes);
	// Both email code paths are one method to the visitor, as they are in Settings.
	const emailPaths: string[] = [
		signUpCode.endpoints.verifySignUpCode.path,
		signInOTP.endpoints.signInEmailOTP.path,
	];
	const gitHubOptions = { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET };
	const gitHubProvider = github(gitHubOptions);

	// Without email proof, only an already-linked provider identity can return.
	async function linkedEmail(providerId: "github" | "google", accountId: string) {
		const linked = await db.query.account.findFirst({
			where: { providerId, accountId },
			columns: {},
			with: { user: { columns: { email: true } } },
		});
		return linked?.user?.email ?? "";
	}

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
		disabledPaths: ["/update-user", "/unlink-account"],
		socialProviders: {
			github: {
				...gitHubOptions,
				getUserInfo: async (tokens) => {
					const info = await gitHubProvider.getUserInfo(tokens);
					if (!info || info.user.emailVerified) return info;
					return {
						...info,
						user: { ...info.user, email: await linkedEmail("github", String(info.data.id)) },
					};
				},
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

					return {
						...names,
						email: await linkedEmail("google", profile.sub),
						emailVerified: false,
					};
				},
			},
		},
		hooks: {
			before: createAuthMiddleware(async (ctx) => {
				if (ctx.path !== "/link-social") return;
				if (ctx.body?.idToken)
					throw new APIError("BAD_REQUEST", {
						message: "Use the provider’s OAuth flow to link a sign-in method.",
					});
				const session = await getAuthoritativeSessionFromCtx(ctx);
				if (session) {
					await addOAuthServerContext({
						linkSessionId: session.session.id,
						linkProvider: ctx.body?.provider,
					});
				}
			}),
		},
		user: {
			// Settable like `name`, so providers' structured names can fill them.
			additionalFields: {
				firstName: { type: "string", required: false },
				lastName: { type: "string", required: false },
			},
			validateUserInfo: async ({ user, source }, ctx) => {
				if (source.method !== "oauth") return;
				if (source.action === "link-account") {
					// The original session may still be live on another device even when
					// this browser comes back signed in to a different session.
					const state = await getOAuthState();
					const session = await getAuthoritativeSessionFromCtx(ctx);
					if (
						!session ||
						session.user.id !== user.id ||
						session.session.id !== state?.serverContext?.linkSessionId ||
						source.oauth?.providerId !== state?.serverContext?.linkProvider
					)
						return { error: "link_session_changed" };
				}
				if (
					(source.action === "create-user" || source.action === "link-account") &&
					!user.emailVerified
				)
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
			session: {
				create: {
					before: async ({ userId }, ctx) => {
						if (ctx?.path !== signInOTP.endpoints.signInEmailOTP.path) return;
						const method = await db.query.account.findFirst({
							where: { userId, providerId: EMAIL_METHOD },
							columns: { id: true },
						});
						if (!method) throw APIError.from("BAD_REQUEST", signInOTP.$ERROR_CODES.INVALID_OTP);
					},
				},
			},
			account: {
				// Better Auth encrypts access and refresh tokens. Ditto has no use for stored ID tokens.
				create: { before: async (account) => ({ data: { ...account, idToken: null } }) },
				update: { before: async (account) => ({ data: { ...account, idToken: null } }) },
			},
		},
		rateLimit: { enabled: true, storage: "database" },
		advanced: {
			backgroundTasks: waitUntil ? { handler: waitUntil } : undefined,
			useSecureCookies: env.BETTER_AUTH_URL.startsWith("https://"),
			ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
		},
		telemetry: { enabled: false },
		plugins: [
			signUpCode,
			signInOTP,
			lastLoginMethod({
				customResolveMethod: (ctx) => (emailPaths.includes(ctx.path) ? EMAIL_METHOD : null),
				// A link callback can refresh the session cookie, which the plugin
				// would read as signing in with the provider just linked.
				beforeStoreCookie: async () => !(await getOAuthState())?.link,
			}),
			tanstackStartCookies(),
		],
	});
}
