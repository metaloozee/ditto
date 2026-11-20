import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

/** What simulated GitHub reports for the next person who authorizes Ditto. */
export type GitHubIdentity = {
	id: number;
	login: string;
	name: string | null;
	/** The public email; `null` when the primary address is private. */
	email: string | null;
	emails: { email: string; primary: boolean; verified: boolean }[];
};

/** An email the Worker handed to Resend. */
export type SentEmail = { from: string; to: string[]; subject: string; text: string };

/** The next authorization: an identity that consents, or a cancelled consent screen. */
export type GitHubAuthorization = GitHubIdentity | { cancel: true };

/** The ID token claims simulated Google issues for the next person who consents. */
export type GoogleIdentity = {
	sub: string;
	email: string;
	email_verified: boolean;
	name?: string;
	given_name?: string;
	family_name?: string;
};

export type GoogleAuthorization = GoogleIdentity | { cancel: true };

/** An unsigned ID token: Better Auth's Google code flow only decodes it. */
const idToken = (claims: GoogleIdentity, audience: string) => {
	const part = (data: unknown) => Buffer.from(JSON.stringify(data)).toString("base64url");
	const now = Math.floor(Date.now() / 1000);
	const payload = { iss: "https://accounts.google.com", aud: audience, iat: now, exp: now + 3600 };
	return `${part({ alg: "none", typ: "JWT" })}.${part({ ...payload, ...claims })}.`;
};

async function body(req: IncomingMessage) {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString();
}

/**
 * One local server standing in for every upstream the Worker talks to in the
 * test stage. The Worker reaches it as `${url}/<host>/<path>`; tests queue
 * what the next consent screen does with `POST /__github/next` or
 * `POST /__google/next`.
 */
export async function startFakeUpstream() {
	const queue: GitHubAuthorization[] = [];
	const codes = new Map<string, GitHubIdentity>();
	const tokens = new Map<string, GitHubIdentity>();
	const googleQueue: GoogleAuthorization[] = [];
	const googleCodes = new Map<string, { identity: GoogleIdentity; audience: string }>();
	const emails: SentEmail[] = [];
	let failNextEmail = false;

	const server = createServer(async (req, res) => {
		const url = new URL(req.url ?? "/", "http://fake");
		const json = (status: number, data: unknown) => {
			res.writeHead(status, { "content-type": "application/json" });
			res.end(JSON.stringify(data));
		};

		if (req.method === "POST" && url.pathname === "/__github/next") {
			queue.push(JSON.parse(await body(req)) as GitHubAuthorization);
			return json(204, null);
		}

		if (req.method === "POST" && url.pathname === "/__google/next") {
			googleQueue.push(JSON.parse(await body(req)) as GoogleAuthorization);
			return json(204, null);
		}

		if (url.pathname === "/accounts.google.com/o/oauth2/v2/auth") {
			const next = googleQueue.shift();
			const back = new URL(url.searchParams.get("redirect_uri") ?? "");
			back.searchParams.set("state", url.searchParams.get("state") ?? "");
			if (!next || "cancel" in next) {
				back.searchParams.set("error", "access_denied");
			} else {
				const code = randomUUID();
				googleCodes.set(code, {
					identity: next,
					audience: url.searchParams.get("client_id") ?? "",
				});
				back.searchParams.set("code", code);
			}
			res.writeHead(302, { location: back.toString() });
			return res.end();
		}

		if (req.method === "POST" && url.pathname === "/oauth2.googleapis.com/token") {
			const code = new URLSearchParams(await body(req)).get("code") ?? "";
			const grant = googleCodes.get(code);
			googleCodes.delete(code);
			if (!grant) return json(400, { error: "invalid_grant" });
			return json(200, {
				access_token: `ya29.${randomUUID()}`,
				id_token: idToken(grant.identity, grant.audience),
				token_type: "Bearer",
				expires_in: 3600,
				scope: "openid email profile",
			});
		}

		// Resend: tests read what was sent, or make the next delivery fail.
		if (req.method === "POST" && url.pathname === "/resend/emails") {
			if (req.headers.authorization !== "Bearer re_test")
				return json(401, { name: "validation_error", message: "API key is invalid" });
			const email = JSON.parse(await body(req)) as SentEmail;
			if (failNextEmail) {
				failNextEmail = false;
				return json(500, { name: "application_error", message: "Simulated outage" });
			}
			emails.push(email);
			return json(200, { id: randomUUID() });
		}
		if (req.method === "POST" && url.pathname === "/__resend/fail-next") {
			failNextEmail = true;
			return json(204, null);
		}
		if (url.pathname === "/__emails") {
			const to = url.searchParams.get("to");
			return json(
				200,
				emails.filter((e) => e.to.includes(to ?? "")),
			);
		}

		if (url.pathname === "/github.com/login/oauth/authorize") {
			const next = queue.shift();
			const back = new URL(url.searchParams.get("redirect_uri") ?? "");
			back.searchParams.set("state", url.searchParams.get("state") ?? "");
			if (!next || "cancel" in next) {
				back.searchParams.set("error", "access_denied");
			} else {
				const code = randomUUID();
				codes.set(code, next);
				back.searchParams.set("code", code);
			}
			res.writeHead(302, { location: back.toString() });
			return res.end();
		}

		if (req.method === "POST" && url.pathname === "/github.com/login/oauth/access_token") {
			const code = new URLSearchParams(await body(req)).get("code") ?? "";
			const identity = codes.get(code);
			codes.delete(code);
			if (!identity) return json(200, { error: "bad_verification_code" });
			const token = `gho_${randomUUID()}`;
			tokens.set(token, identity);
			return json(200, {
				access_token: token,
				token_type: "bearer",
				scope: "read:user,user:email",
			});
		}

		const identity = tokens.get(req.headers.authorization?.replace(/^Bearer /i, "") ?? "");
		if (url.pathname === "/api.github.com/user") {
			if (!identity) return json(401, { message: "Bad credentials" });
			const { emails: _, ...profile } = identity;
			return json(200, { ...profile, avatar_url: null });
		}
		if (url.pathname === "/api.github.com/user/emails") {
			if (!identity) return json(401, { message: "Bad credentials" });
			return json(
				200,
				identity.emails.map((e) => ({ ...e, visibility: e.primary ? "private" : null })),
			);
		}

		json(404, { message: "Not Found" });
	});

	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}`,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}
