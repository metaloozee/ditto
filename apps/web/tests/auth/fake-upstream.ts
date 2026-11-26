import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

import { fakeWorkersAi } from "./fake-workers-ai.ts";

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

/** A request OpenCode's Responses endpoint received, as the key and model it named. */
export type OpenCodeRequest = { key: string | null; model: unknown };

/** What OpenCode answers the next Responses request with, instead of serving it. */
export type OpenCodeFault = { status: number; body?: unknown };

/**
 * How OpenCode streams its reply to the next turn: these text deltas in order, then the
 * completed response. A held reply sends the deltas and then waits, until the caller hangs up
 * or the test releases it.
 * A limited reply sends the deltas, then fails on a rate limit, and limits its key from then on.
 */
export type OpenCodeReply = { deltas: string[]; hold?: boolean; limited?: boolean };

/** A key's limit: every request naming it answers 429, with `retry-after` if set, in seconds. */
export type OpenCodeLimit = { retryAfter?: number };

/** The text of what a Responses request asked: the last thing the user said in it. */
function askedText(input: unknown): string | null {
	if (typeof input === "string") return input;
	if (!Array.isArray(input)) return null;
	const last = (input as { role?: unknown; content?: unknown }[])
		.filter((item) => item.role === "user")
		.at(-1)?.content;
	if (typeof last === "string") return last;
	if (!Array.isArray(last)) return null;
	return (last as { text?: unknown }[])
		.map((part) => (typeof part.text === "string" ? part.text : ""))
		.join("");
}

/**
 * A request that reached simulated api.openai.com: its path, the bearer token, the model, the
 * top-level body fields and the roles of its input items, as the plan-usage flow checks them.
 */
export type ChatGPTRequest = {
	path: string;
	token: string | null;
	model: unknown;
	fields: string[];
	roles: string[];
};

/** A Sign in with ChatGPT token pair simulated OpenAI issued. */
export type ChatGPTTokens = { access: string; refresh: string };

/** Fields OpenAI's plan-usage docs say the Sign in with ChatGPT flow rejects. */
const SIWC_UNSUPPORTED = ["temperature", "max_output_tokens", "previous_response_id", "prompt"];

/** The plan-usage flow's admission rules, from `feasibility/simulated-provider.ts`. */
function siwcRefusal(sent: Record<string, unknown>, roles: string[]) {
	const field = SIWC_UNSUPPORTED.find((name) => name in sent);
	const param = field ?? (roles.includes("system") ? "input" : undefined);
	const unsupported = param ?? (sent.store !== false || sent.stream !== true ? "store" : undefined);
	if (!unsupported) return undefined;
	return {
		error: {
			code: "subscription_sharing_unsupported_capability",
			message: "Simulated unsupported capability",
			param: unsupported,
		},
	};
}

const sseEvent = (event: { type: string } & Record<string, unknown>) =>
	`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

/** The Responses stream events that carry `deltas` as one assistant message. */
function replyEvents(id: string, model: unknown, deltas: string[]) {
	const text = deltas.join("");
	return {
		head: [
			sseEvent({ type: "response.created", response: { id, model, status: "in_progress" } }),
			sseEvent({
				type: "response.output_item.added",
				output_index: 0,
				item: { type: "message", id: `msg_${id}`, role: "assistant", content: [] },
			}),
			...deltas.map((delta) =>
				sseEvent({ type: "response.output_text.delta", output_index: 0, content_index: 0, delta }),
			),
		],
		tail: [
			sseEvent({
				type: "response.output_item.done",
				output_index: 0,
				item: {
					type: "message",
					id: `msg_${id}`,
					role: "assistant",
					status: "completed",
					content: [{ type: "output_text", text, annotations: [] }],
				},
			}),
			sseEvent({
				type: "response.completed",
				response: {
					id,
					model,
					status: "completed",
					usage: { input_tokens: 5, output_tokens: deltas.length, total_tokens: 5 + deltas.length },
				},
			}),
		],
	};
}

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
 * `POST /__google/next`, and control OpenCode under `/__opencode/`.
 */
export async function startFakeUpstream() {
	const queue: GitHubAuthorization[] = [];
	const codes = new Map<string, GitHubIdentity>();
	const tokens = new Map<string, GitHubIdentity>();
	const googleQueue: GoogleAuthorization[] = [];
	const googleCodes = new Map<string, { identity: GoogleIdentity; audience: string }>();
	const emails: SentEmail[] = [];
	let failNextEmail = false;
	const openCodeKeys = new Set<string>();
	const openCodeFaults: OpenCodeFault[] = [];
	const openCodeRequests: OpenCodeRequest[] = [];
	const openCodeReplies: OpenCodeReply[] = [];
	// Keys whose streamed turn the caller hung up on before it completed.
	const openCodeHungUp: string[] = [];
	const openCodeLimits = new Map<string, OpenCodeLimit>();
	// Keys whose every request meets an outage: 503 until it ends.
	const openCodeDown = new Set<string>();
	// What each Responses request asked, beside the key it named.
	const openCodeAsked: { key: string | null; text: string | null }[] = [];
	// Held turns by key, each finishing its stream when released.
	const openCodeHeld = new Map<string, () => void>();
	const workersAi = fakeWorkersAi();
	const chatgptTokens: ChatGPTTokens[] = [];
	const chatgptRequests: ChatGPTRequest[] = [];

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

		// OpenCode: tests issue keys, queue faults and read which key and model each request named.
		if (req.method === "POST" && url.pathname === "/__opencode/keys") {
			openCodeKeys.add((JSON.parse(await body(req)) as { key: string }).key);
			return json(204, null);
		}
		if (req.method === "POST" && url.pathname === "/__opencode/fail-next") {
			openCodeFaults.push(JSON.parse(await body(req)) as OpenCodeFault);
			return json(204, null);
		}
		if (req.method === "POST" && url.pathname === "/__opencode/reply-next") {
			openCodeReplies.push(JSON.parse(await body(req)) as OpenCodeReply);
			return json(204, null);
		}
		if (url.pathname === "/__opencode/requests") return json(200, openCodeRequests);
		if (url.pathname === "/__opencode/hung-up") return json(200, openCodeHungUp);
		if (url.pathname === "/__opencode/asked") return json(200, openCodeAsked);
		if (
			url.pathname === "/__opencode/limit" &&
			(req.method === "POST" || req.method === "DELETE")
		) {
			const { key, ...limit } = JSON.parse(await body(req)) as { key: string } & OpenCodeLimit;
			if (req.method === "POST") openCodeLimits.set(key, limit);
			else openCodeLimits.delete(key);
			return json(204, null);
		}
		if (url.pathname === "/__opencode/down" && (req.method === "POST" || req.method === "DELETE")) {
			const { key } = JSON.parse(await body(req)) as { key: string };
			if (req.method === "POST") openCodeDown.add(key);
			else openCodeDown.delete(key);
			return json(204, null);
		}
		if (req.method === "POST" && url.pathname === "/__opencode/revoke") {
			openCodeKeys.delete((JSON.parse(await body(req)) as { key: string }).key);
			return json(204, null);
		}
		if (req.method === "POST" && url.pathname === "/__opencode/release") {
			const { key } = JSON.parse(await body(req)) as { key: string };
			const finish = openCodeHeld.get(key);
			openCodeHeld.delete(key);
			finish?.();
			return json(finish ? 204 : 404, null);
		}
		if (req.method === "POST" && url.pathname === "/opencode.ai/inference/openai/v1/responses") {
			const key = req.headers.authorization?.replace(/^Bearer /i, "") ?? null;
			const { model, stream, input } = JSON.parse(await body(req)) as {
				model?: unknown;
				stream?: unknown;
				input?: unknown;
			};
			openCodeRequests.push({ key, model });
			openCodeAsked.push({ key, text: askedText(input) });
			const fault = openCodeFaults.shift();
			if (fault) return json(fault.status, fault.body ?? { error: { message: "Simulated" } });
			if (key && openCodeDown.has(key)) {
				return json(503, { error: { type: "server_error", message: "Service unavailable." } });
			}
			if (!key || !openCodeKeys.has(key)) {
				return json(401, { error: { type: "AuthError", message: "Invalid API key." } });
			}
			const limit = openCodeLimits.get(key);
			if (limit) {
				res.writeHead(429, {
					"content-type": "application/json",
					...(limit.retryAfter === undefined ? {} : { "retry-after": String(limit.retryAfter) }),
				});
				return res.end(
					JSON.stringify({
						error: { type: "rate_limit_exceeded", message: "Rate limit reached." },
					}),
				);
			}
			if (stream === true) {
				const reply = openCodeReplies.shift() ?? { deltas: ["pong"] };
				const { head, tail } = replyEvents(`resp_${randomUUID()}`, model, reply.deltas);
				res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
				res.on("close", () => {
					if (!res.writableEnded) openCodeHungUp.push(key);
				});
				for (const event of head) res.write(event);
				if (reply.limited) {
					openCodeLimits.set(key, {});
					return res.end(
						sseEvent({
							type: "response.failed",
							response: {
								id: `resp_${randomUUID()}`,
								model,
								status: "failed",
								error: { code: "rate_limit_exceeded", message: "Rate limit reached." },
							},
						}),
					);
				}
				if (reply.hold) openCodeHeld.set(key, () => res.end(tail.join("")));
				else res.end(tail.join(""));
				return;
			}
			return json(200, {
				id: `resp_${randomUUID()}`,
				object: "response",
				status: "completed",
				model,
				output: [
					{
						type: "message",
						role: "assistant",
						content: [{ type: "output_text", text: "pong", annotations: [] }],
					},
				],
				usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 },
			});
		}

		// Sign in with ChatGPT: tests issue token pairs and read every request api.openai.com got.
		if (req.method === "POST" && url.pathname === "/__chatgpt/tokens") {
			chatgptTokens.push(JSON.parse(await body(req)) as ChatGPTTokens);
			return json(204, null);
		}
		if (url.pathname === "/__chatgpt/requests") return json(200, chatgptRequests);
		if (url.pathname.startsWith("/api.openai.com/")) {
			const token = req.headers.authorization?.replace(/^Bearer /i, "") ?? null;
			const parsed: unknown = JSON.parse((await body(req)) || "{}");
			const sent = (typeof parsed === "object" && parsed ? parsed : {}) as Record<string, unknown>;
			const input = Array.isArray(sent.input) ? (sent.input as { role?: unknown }[]) : [];
			const roles = input.flatMap((item) => (typeof item.role === "string" ? [item.role] : []));
			chatgptRequests.push({
				path: url.pathname,
				token,
				model: sent.model,
				fields: Object.keys(sent),
				roles,
			});
			if (req.method !== "POST" || url.pathname !== "/api.openai.com/v1/responses") {
				return json(404, { error: { message: "Not the plan-usage endpoint" } });
			}
			if (!chatgptTokens.some((issued) => issued.access === token)) {
				return json(401, { error: { code: "subscription_sharing_invalid_user" } });
			}
			const refused = siwcRefusal(sent, roles);
			if (refused) return json(400, refused);
			const { head, tail } = replyEvents(`resp_${randomUUID()}`, sent.model, ["pong"]);
			res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
			return res.end([...head, ...tail].join(""));
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

		if (await workersAi(req, res, url)) return;

		json(404, { message: "Not Found" });
	});

	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}`,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}
