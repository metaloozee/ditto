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

/** OpenCode's two OpenAI-style endpoints: Pi's catalogue says which one serves a model. */
export type OpenCodeApi = "responses" | "chat-completions";

const OPENCODE_APIS: Record<string, OpenCodeApi> = {
	"/opencode.ai/inference/openai/v1/responses": "responses",
	"/opencode.ai/inference/openai/v1/chat/completions": "chat-completions",
};

/**
 * A request OpenCode received: the endpoint, the key and model it named, and what it asked,
 * the last thing the user said in it.
 */
export type OpenCodeRequest = {
	api: OpenCodeApi;
	key: string | null;
	model: unknown;
	asked: string | null;
};

/**
 * What OpenCode answers a request with instead of serving it: once, for the next
 * request, or for every request naming a key until the test clears it. A `retryAfter` in
 * seconds goes out as `retry-after`.
 */
export type OpenCodeFault = { status: number; body?: unknown; retryAfter?: number };

/** What OpenCode says alongside a fault's status, unless the fault sets its own body. */
const OPENCODE_ERRORS: Record<number, unknown> = {
	401: { error: { type: "AuthError", message: "Invalid API key." } },
	429: { error: { type: "rate_limit_exceeded", message: "Rate limit reached." } },
	503: { error: { type: "server_error", message: "Service unavailable." } },
};

/**
 * How OpenCode streams its reply to the next turn: these text deltas in order, then the
 * completed response. A held reply sends the deltas and then waits, until the caller hangs up
 * or the test releases it.
 * A limited reply sends the deltas, then fails on a rate limit, and limits its key from then on.
 * Held and limited, it fails only when released, so several turns can be mid-reply at the limit.
 */
export type OpenCodeReply = { deltas: string[]; hold?: boolean; limited?: boolean };

/** What a request asked, from Responses `input` or chat `messages`: the user's last words. */
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

/**
 * What simulated OpenAI does with its next good refresh, beyond rotating the pair: a held one
 * answers once released; a lost one drops the connection without an answer, and the old
 * refresh token keeps working only if `oldStillAccepted`.
 */
export type ChatGPTRefreshPlan = { hold: true } | { lose: true; oldStillAccepted?: boolean };

/** What every refresh meets until it ends: this status, with `retry-after` in seconds if set. */
export type ChatGPTRefreshFault = { status: number; retryAfter?: number };

/** A refresh request simulated OpenAI received, and the pair it issued if it rotated. */
export type ChatGPTRefresh = {
	presented: string | null;
	clientId: string | null;
	resource: string | null;
	issued?: ChatGPTTokens;
};

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

const chatChunk = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;

/** The chat completion chunks that carry `deltas` as one assistant message. */
function chatEvents(id: string, model: unknown, deltas: string[]) {
	const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
		chatChunk({
			id,
			object: "chat.completion.chunk",
			model,
			choices: [{ index: 0, delta, finish_reason: finish }],
		});
	return {
		head: [
			chunk({ role: "assistant", content: "" }),
			...deltas.map((delta) => chunk({ content: delta })),
		],
		tail: [
			chunk({}, "stop"),
			chatChunk({
				id,
				object: "chat.completion.chunk",
				model,
				choices: [],
				usage: {
					prompt_tokens: 5,
					completion_tokens: deltas.length,
					total_tokens: 5 + deltas.length,
				},
			}),
			"data: [DONE]\n\n",
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
	// Keys whose every request meets a fault: a limit, an outage or a revoked key.
	const openCodeKeyFaults = new Map<string, OpenCodeFault>();
	const openCodeRequests: OpenCodeRequest[] = [];
	const openCodeReplies: OpenCodeReply[] = [];
	// Keys whose streamed turn the caller hung up on before it completed.
	const openCodeHungUp: string[] = [];
	// Held turns by key, each finishing its stream when released.
	const openCodeHeld = new Map<string, (() => void)[]>();
	const workersAi = fakeWorkersAi();
	const chatgptTokens: ChatGPTTokens[] = [];
	const chatgptRequests: ChatGPTRequest[] = [];
	const chatgptRefreshes: ChatGPTRefresh[] = [];
	const chatgptRefreshPlans: ChatGPTRefreshPlan[] = [];
	const chatgptHeldRefreshes: (() => void)[] = [];
	let chatgptRefreshFault: ChatGPTRefreshFault | null = null;

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
		if (
			url.pathname === "/__opencode/fault" &&
			(req.method === "POST" || req.method === "DELETE")
		) {
			const { key, ...fault } = JSON.parse(await body(req)) as { key: string } & OpenCodeFault;
			if (req.method === "POST") openCodeKeyFaults.set(key, fault);
			else openCodeKeyFaults.delete(key);
			return json(204, null);
		}
		if (req.method === "POST" && url.pathname === "/__opencode/release") {
			const { key } = JSON.parse(await body(req)) as { key: string };
			const held = openCodeHeld.get(key) ?? [];
			openCodeHeld.delete(key);
			for (const finish of held) finish();
			return json(held.length ? 204 : 404, null);
		}
		const api = OPENCODE_APIS[url.pathname];
		if (req.method === "POST" && api) {
			const key = req.headers.authorization?.replace(/^Bearer /i, "") ?? null;
			const { model, stream, input, messages } = JSON.parse(await body(req)) as {
				model?: unknown;
				stream?: unknown;
				input?: unknown;
				messages?: unknown;
			};
			const chat = api === "chat-completions";
			openCodeRequests.push({ api, key, model, asked: askedText(chat ? messages : input) });
			// A queued fault first, then the key's own; a key OpenCode never issued is refused.
			const fault =
				openCodeFaults.shift() ??
				(key && openCodeKeys.has(key) ? openCodeKeyFaults.get(key) : { status: 401 });
			if (fault || !key) {
				const { status, body: answer, retryAfter } = fault ?? { status: 401 };
				res.writeHead(status, {
					"content-type": "application/json",
					...(retryAfter === undefined ? {} : { "retry-after": String(retryAfter) }),
				});
				const error = answer ?? OPENCODE_ERRORS[status] ?? { error: { message: "Simulated" } };
				return res.end(JSON.stringify(error));
			}
			if (stream === true) {
				const reply = openCodeReplies.shift() ?? { deltas: ["pong"] };
				const { head, tail } = (chat ? chatEvents : replyEvents)(
					`resp_${randomUUID()}`,
					model,
					reply.deltas,
				);
				res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
				res.on("close", () => {
					if (!res.writableEnded) openCodeHungUp.push(key);
				});
				for (const event of head) res.write(event);
				const finish = reply.limited
					? () => {
							openCodeKeyFaults.set(key, { status: 429 });
							const error = { code: "rate_limit_exceeded", message: "Rate limit reached." };
							// Chat completions has no failed event: the error rides in a chunk of its own.
							if (chat) return res.end(chatChunk({ error: { ...error, type: error.code } }));
							res.end(
								sseEvent({
									type: "response.failed",
									response: { id: `resp_${randomUUID()}`, model, status: "failed", error },
								}),
							);
						}
					: () => res.end(tail.join(""));
				if (reply.hold) openCodeHeld.set(key, [...(openCodeHeld.get(key) ?? []), finish]);
				else finish();
				return;
			}
			if (chat) {
				return json(200, {
					id: `chatcmpl_${randomUUID()}`,
					object: "chat.completion",
					model,
					choices: [
						{ index: 0, message: { role: "assistant", content: "pong" }, finish_reason: "stop" },
					],
					usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
				});
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
		if (url.pathname === "/__chatgpt/refreshes") return json(200, chatgptRefreshes);
		if (req.method === "POST" && url.pathname === "/__chatgpt/refresh-next") {
			chatgptRefreshPlans.push(JSON.parse(await body(req)) as ChatGPTRefreshPlan);
			return json(204, null);
		}
		if (req.method === "POST" && url.pathname === "/__chatgpt/refresh-release") {
			const held = chatgptHeldRefreshes.splice(0);
			for (const answer of held) answer();
			return json(held.length ? 204 : 404, null);
		}
		if (url.pathname === "/__chatgpt/refresh-fault") {
			chatgptRefreshFault =
				req.method === "POST" ? (JSON.parse(await body(req)) as ChatGPTRefreshFault) : null;
			return json(204, null);
		}
		if (req.method === "POST" && url.pathname === "/__chatgpt/revoke") {
			const { refresh } = JSON.parse(await body(req)) as { refresh: string };
			const index = chatgptTokens.findIndex((issued) => issued.refresh === refresh);
			if (index !== -1) chatgptTokens.splice(index, 1);
			return json(204, null);
		}
		// OpenAI refusing an access token before it expires; its refresh token still works.
		if (req.method === "POST" && url.pathname === "/__chatgpt/reject-access") {
			const { access } = JSON.parse(await body(req)) as { access: string };
			const issued = chatgptTokens.find((each) => each.access === access);
			if (issued) issued.access = `rejected-${randomUUID()}`;
			return json(204, null);
		}
		// Each good refresh rotates the pair: the old access and refresh tokens stop working.
		if (req.method === "POST" && url.pathname === "/auth.openai.com/api/accounts/oauth/token") {
			const form = new URLSearchParams(await body(req));
			const refresh: ChatGPTRefresh = {
				presented: form.get("refresh_token"),
				clientId: form.get("client_id"),
				resource: form.get("resource"),
			};
			chatgptRefreshes.push(refresh);
			if (chatgptRefreshFault) {
				const { status, retryAfter } = chatgptRefreshFault;
				res.writeHead(status, {
					"content-type": "application/json",
					...(retryAfter === undefined ? {} : { "retry-after": String(retryAfter) }),
				});
				return res.end(JSON.stringify({ error: { message: "Simulated" } }));
			}
			const index = chatgptTokens.findIndex((issued) => issued.refresh === refresh.presented);
			if (
				index === -1 ||
				form.get("grant_type") !== "refresh_token" ||
				!refresh.clientId ||
				refresh.resource !== "https://api.openai.com/v1"
			) {
				return json(400, { error: "invalid_grant" });
			}
			const plan = chatgptRefreshPlans.shift();
			const issued = { access: `at-MARKER-${randomUUID()}`, refresh: `rt-MARKER-${randomUUID()}` };
			const keepOld = plan && "lose" in plan && plan.oldStillAccepted;
			chatgptTokens.splice(index, keepOld ? 0 : 1, issued);
			refresh.issued = issued;
			if (plan && "lose" in plan) return void req.socket.destroy();
			res.writeHead(200, { "content-type": "application/json" });
			// A response can be in flight after fetch resolves but before the token body arrives.
			res.write(" ");
			const answer = () =>
				res.end(
					JSON.stringify({
						access_token: issued.access,
						refresh_token: issued.refresh,
						id_token: "simulated.id.token",
						token_type: "Bearer",
						expires_in: 3600,
						scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
					}),
				);
			if (plan && "hold" in plan) return void chatgptHeldRefreshes.push(answer);
			return answer();
		}
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
