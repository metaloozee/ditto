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

/** The next authorization: an identity that consents, or a cancelled consent screen. */
export type GitHubAuthorization = GitHubIdentity | { cancel: true };

async function body(req: IncomingMessage) {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString();
}

/**
 * One local server standing in for every upstream the Worker talks to in the
 * test stage. The Worker reaches it as `${url}/<host>/<path>`; tests queue
 * what the next consent screen does with `POST /__github/next`.
 */
export async function startFakeUpstream() {
	const queue: GitHubAuthorization[] = [];
	const codes = new Map<string, GitHubIdentity>();
	const tokens = new Map<string, GitHubIdentity>();

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
