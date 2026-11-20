import type { BetterAuthPlugin, GenericEndpointContext as Ctx } from "better-auth";
import {
	APIError,
	createAuthEndpoint,
	createAuthMiddleware,
	formCsrfMiddleware,
	isAPIError,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { constantTimeEqual, generateRandomString } from "better-auth/crypto";
import { emailOTP } from "better-auth/plugins/email-otp";
import { and, eq, gt, lte } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { account, user as userTable, verification } from "../db/auth-schema.ts";

/** The `account.providerId` that records email sign-in as enabled for a user. */
export const EMAIL_METHOD = "email";

const ATTEMPTS = 3;

export type CodeEmail = { to: string; code: string; expiresIn: number };

export type EmailCodeOptions = {
	/** Seconds a code stays valid. */
	expiresIn: number;
	/** Seconds before another code can be sent to the same address. */
	resendIn: number;
	/** Delivers a code. Throws if the provider refuses it. */
	send: (email: CodeEmail) => Promise<void>;
};

const fail = (status: "BAD_REQUEST" | "FORBIDDEN" | "BAD_GATEWAY", code: string, message: string) =>
	new APIError(status, { code, message });

async function hash(secret: string, id: string, code: string) {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(`${id}:${code}`));
	return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

function readEmail(body: unknown) {
	const email = (body as { email?: unknown } | null)?.email;
	if (
		typeof email !== "string" ||
		email.length > 254 ||
		!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
	)
		throw fail("BAD_REQUEST", "INVALID_EMAIL", "Enter a valid email address.");
	return email.trim().toLowerCase();
}

function readName(body: unknown, field: "firstName" | "lastName") {
	const value = (body as Record<string, unknown> | null)?.[field];
	if (typeof value !== "string" || !value.trim() || value.length > 100)
		throw fail(
			"BAD_REQUEST",
			"INVALID_NAME",
			`Enter your ${field === "firstName" ? "first" : "last"} name.`,
		);
	return value.trim();
}

function challenges(db: DrizzleD1Database, options: EmailCodeOptions) {
	const identifier = (purpose: string, email: string) => `${purpose}-code-${email}`;
	const read = (id: string) => db.select().from(verification).where(eq(verification.id, id)).get();
	const unchanged = (row: typeof verification.$inferSelect) =>
		and(
			eq(verification.id, row.id),
			eq(verification.value, row.value),
			eq(verification.createdAt, row.createdAt),
		);

	return {
		async issue(ctx: Ctx, purpose: string, email: string) {
			const id = identifier(purpose, email);
			// The primary key and conditional update let one request rotate the challenge.
			for (;;) {
				const live = await read(id);
				const now = Date.now();
				const [previousHash, previousState] = live?.value.split(":") ?? [];
				if (live && previousState !== "spent") {
					const wait = Math.ceil((live.createdAt.getTime() + options.resendIn * 1000 - now) / 1000);
					if (wait > 0)
						throw new APIError(
							"TOO_MANY_REQUESTS",
							{
								code: "CODE_RECENTLY_SENT",
								message: "A code was just sent. Wait to send another.",
							},
							{ "X-Retry-After": String(wait) },
						);
				}

				const code = generateRandomString(6, "0-9");
				const digest = await hash(ctx.context.secret, id, code);
				if (digest === previousHash) continue;
				const next = {
					value: `${digest}:0`,
					expiresAt: new Date(now + options.expiresIn * 1000),
					createdAt: new Date(now),
					updatedAt: new Date(now),
				};
				const [issued] = await (live
					? db.update(verification).set(next).where(unchanged(live)).returning()
					: db
							.insert(verification)
							.values({ id, identifier: id, ...next })
							.onConflictDoNothing()
							.returning());
				if (!issued) continue;

				try {
					await options.send({ to: email, code, expiresIn: options.expiresIn });
				} catch {
					if (live) {
						await db.update(verification).set(live).where(unchanged(issued));
					} else {
						await db.delete(verification).where(unchanged(issued));
					}
					ctx.context.logger.error("Sending an email code failed");
					throw fail("BAD_GATEWAY", "DELIVERY_FAILED", "We couldn’t send your code.");
				}
				return { resendIn: options.resendIn };
			}
		},

		async verify(ctx: Ctx, purpose: string, email: string, code: string) {
			const id = identifier(purpose, email);
			const digest = /^\d{6}$/.test(code) ? await hash(ctx.context.secret, id, code) : "";
			// Consume the code or count a miss on the same row. Keeping the row
			// preserves the resend wait even when the last incorrect try locks it.
			for (;;) {
				const live = await read(id);
				const [stored, state] = live?.value.split(":") ?? [];
				const attempts = Number(state);
				if (
					!live ||
					live.expiresAt.getTime() <= Date.now() ||
					state === "spent" ||
					attempts >= ATTEMPTS
				)
					throw fail("BAD_REQUEST", "CODE_EXPIRED", "This code has expired.");

				const correct = constantTimeEqual(digest, stored ?? "");
				const wrong = attempts + 1;
				const [updated] = await db
					.update(verification)
					.set({ value: `${stored}:${correct ? "spent" : wrong}` })
					.where(and(unchanged(live), gt(verification.expiresAt, new Date())))
					.returning({ id: verification.id });
				if (!updated) continue;
				if (correct) return;
				if (wrong === ATTEMPTS)
					throw fail("FORBIDDEN", "TOO_MANY_ATTEMPTS", "Too many incorrect codes.");
				throw new APIError("BAD_REQUEST", {
					code: "INVALID_CODE",
					message: "That code isn’t right.",
					attemptsLeft: ATTEMPTS - wrong,
				});
			}
		},
	};
}

function existingOutcome(accounts: { providerId: string }[]) {
	return accounts.some((account) => account.providerId === EMAIL_METHOD)
		? "account-exists"
		: "wrong-method";
}

/**
 * Email registration by one-time code. The account, its email sign-in method
 * and a session are created only once the code is verified; an address that
 * already has an account gets no session and is sent to sign in.
 */
export function emailCode(db: DrizzleD1Database, options: EmailCodeOptions) {
	const codes = challenges(db, options);
	return {
		id: "email-code",
		endpoints: {
			sendSignUpCode: createAuthEndpoint(
				"/email-code/sign-up/send",
				{ method: "POST", use: [formCsrfMiddleware] },
				async (ctx) => ctx.json(await codes.issue(ctx, "sign-up", readEmail(ctx.body))),
			),
			verifySignUpCode: createAuthEndpoint(
				"/email-code/sign-up/verify",
				{ method: "POST", use: [formCsrfMiddleware] },
				async (ctx) => {
					const email = readEmail(ctx.body);
					const firstName = readName(ctx.body, "firstName");
					const lastName = readName(ctx.body, "lastName");
					const code = (ctx.body as { code?: unknown }).code;
					await codes.verify(ctx, "sign-up", email, typeof code === "string" ? code : "");

					const adapter = ctx.context.internalAdapter;
					const findExisting = () => adapter.findUserByEmail(email, { includeAccounts: true });
					const existing = await findExisting();
					if (existing) return ctx.json({ outcome: existingOutcome(existing.accounts) });

					const id = crypto.randomUUID();
					const user = {
						id,
						email,
						emailVerified: true,
						name: `${firstName} ${lastName}`,
						firstName,
						lastName,
						createdAt: new Date(),
						updatedAt: new Date(),
					};
					try {
						// A failed insert rolls back both the user and the email method in D1.
						await db.batch([
							db.insert(userTable).values(user),
							db.insert(account).values({
								id: crypto.randomUUID(),
								userId: id,
								providerId: EMAIL_METHOD,
								accountId: id,
							}),
						]);
					} catch (error) {
						const registeredMeanwhile = await findExisting();
						if (!registeredMeanwhile) throw error;
						return ctx.json({ outcome: existingOutcome(registeredMeanwhile.accounts) });
					}
					const session = await adapter.createSession(user.id);
					await setSessionCookie(ctx, { session, user });
					return ctx.json({ outcome: "signed-in" });
				},
			),
		},
		rateLimit: [
			{ pathMatcher: (path) => path === "/email-code/sign-up/send", window: 60, max: 5 },
			{ pathMatcher: (path) => path === "/email-code/sign-up/verify", window: 60, max: 10 },
		],
	} satisfies BetterAuthPlugin;
}

export function emailSignIn(db: DrizzleD1Database, options: EmailCodeOptions) {
	const plugin = emailOTP({
		disableSignUp: true,
		expiresIn: options.expiresIn,
		allowedAttempts: ATTEMPTS,
		storeOTP: "hashed",
		async sendVerificationOTP({ email, otp }, ctx) {
			try {
				await options.send({ to: email, code: otp, expiresIn: options.expiresIn });
			} catch {
				ctx?.context.logger.error("Sending a sign-in code failed");
			}
		},
	});
	const { sendVerificationOTP, signInEmailOTP } = plugin.endpoints;
	const invalidOTP = () => APIError.from("BAD_REQUEST", plugin.$ERROR_CODES.INVALID_OTP);
	const emailEnabled = async (ctx: Ctx, email: string) => {
		const match = await ctx.context.internalAdapter.findUserByEmail(email, {
			includeAccounts: true,
		});
		return match?.accounts.some((account) => account.providerId === EMAIL_METHOD);
	};

	return {
		...plugin,
		endpoints: {
			signInEmailOTP,
			sendVerificationOTP: createAuthEndpoint(
				sendVerificationOTP.path,
				sendVerificationOTP.options,
				async (ctx) => {
					if (ctx.body.type !== "sign-in") throw new APIError("NOT_FOUND");
					const email = readEmail(ctx.body);
					const now = new Date();
					const expiresAt = new Date(now.getTime() + options.resendIn * 1000);
					const id = `sign-in-cooldown-${email}`;
					const [reserved] = await db
						.insert(verification)
						.values({ id, identifier: id, value: "", expiresAt })
						.onConflictDoUpdate({
							target: verification.id,
							set: { expiresAt },
							setWhere: lte(verification.expiresAt, now),
						})
						.returning({ id: verification.id });
					if (reserved) {
						// Eligibility and delivery run after the same public response for every address.
						const send = async () => {
							if (!(await emailEnabled(ctx, email))) return;
							await sendVerificationOTP({
								context: ctx.context,
								body: { email, type: "sign-in" },
							});
						};
						ctx.context.runInBackground(
							send().catch(() => {
								ctx.context.logger.error("Issuing a sign-in code failed");
							}),
						);
					}
					ctx.setHeader("X-Resend-In", String(options.resendIn));
					return ctx.json({ success: true });
				},
			),
		},
		hooks: {
			before: [
				{
					matcher: (ctx) => ctx.path === signInEmailOTP.path,
					handler: createAuthMiddleware({ use: [formCsrfMiddleware] }, async (ctx) => {
						const email =
							typeof ctx.body?.email === "string" && ctx.body.email.trim().toLowerCase();
						if (!email || !/^\d{6}$/.test(ctx.body?.otp) || !(await emailEnabled(ctx, email)))
							throw invalidOTP();
						return { context: { body: { ...ctx.body, email } } };
					}),
				},
			],
			after: [
				{
					matcher: (ctx) => ctx.path === signInEmailOTP.path,
					handler: createAuthMiddleware(async (ctx) => {
						const result = ctx.context.returned;
						if (
							isAPIError(result) &&
							(result.body?.code === "OTP_EXPIRED" || result.body?.code === "TOO_MANY_ATTEMPTS")
						) {
							const error = invalidOTP();
							return Response.json(error.body, {
								status: error.statusCode,
								statusText: String(error.status),
							});
						}
					}),
				},
			],
		},
	} satisfies BetterAuthPlugin;
}
