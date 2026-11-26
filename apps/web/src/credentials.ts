import { DurableObject } from "cloudflare:workers";

import type { Bot } from "./bot.ts";
import type {
	ConnectRefusal,
	CredentialsRpc,
	Deployment,
	Fault,
	Grant,
	ModelAccessView,
} from "./credentials-rpc.ts";
import type { AuthEnv } from "./lib/auth.ts";
import {
	CHATGPT_MODELS,
	type ConnectionState,
	OPENCODE_MODELS,
	type Pair,
} from "./lib/model-access.ts";
import { openaiFetch } from "./lib/openai-upstream.ts";
import { faultOf } from "./lib/provider-fault.ts";

const OPENCODE = "https://opencode.ai/inference/openai/v1";
const OPENAI_RESPONSES = "https://api.openai.com/v1/responses";
const OPENAI_TOKEN = "https://auth.openai.com/api/accounts/oauth/token";
/** The resource a Sign in with ChatGPT token is for, which a refresh names again. */
const OPENAI_RESOURCE = "https://api.openai.com/v1";
const PLAN_SCOPE = "chatgpt.tokens.use.direct";
/** A rotated token counts as expired this long early, as Pi's own sign-in does. */
const EXPIRY_MARGIN_MS = 3 * 60_000;

/** An encrypted value: AES-GCM under the stage's key, bound to the account and provider. */
interface Sealed {
	iv: string;
	data: string;
}

interface StoredConnection {
	provider: "opencode";
	key: Sealed;
	connectedAt: string;
}

/** A Sign in with ChatGPT credential, as Pi saves one after the owner's local sign-in. */
interface SignIn {
	type: "oauth";
	access: string;
	refresh: string;
	/** When the access token expires, in epoch milliseconds. */
	expires: number;
	/** The client ID OpenAI issued at sign-in, which a refresh must send. */
	clientId: string;
	scopes: string[];
}

/** The imported sign-in, sealed whole: only this object reads or rotates its refresh token. */
interface StoredChatGPT {
	provider: "chatgpt";
	signIn: Sealed;
	/** The access token's expiry, kept in the clear so a refresh can be planned without opening it. */
	expires: number;
	connectedAt: string;
}

/** Accepts only a sign-in that carries its client ID and the plan-usage grant. */
function signIn(value: unknown): SignIn | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const { type, access, refresh, expires, clientId, scopes } = value as Record<string, unknown>;
	if (
		type !== "oauth" ||
		typeof access !== "string" ||
		!access ||
		typeof refresh !== "string" ||
		!refresh ||
		typeof expires !== "number" ||
		typeof clientId !== "string" ||
		!clientId ||
		!Array.isArray(scopes) ||
		!scopes.every((scope) => typeof scope === "string") ||
		!scopes.includes(PLAN_SCOPE)
	) {
		return undefined;
	}
	return { type, access, refresh, expires, clientId, scopes };
}

/** The sign-in a refresh answer rotates `previous` into, unless the answer isn't a whole one. */
function rotated(answer: unknown, previous: SignIn): SignIn | undefined {
	if (typeof answer !== "object" || answer === null) return undefined;
	const { access_token, refresh_token, expires_in, scope } = answer as Record<string, unknown>;
	if (
		typeof access_token !== "string" ||
		!access_token ||
		typeof refresh_token !== "string" ||
		!refresh_token ||
		typeof expires_in !== "number" ||
		!(expires_in > 0)
	) {
		return undefined;
	}
	const scopes = typeof scope === "string" ? scope.split(/\s+/).filter(Boolean) : previous.scopes;
	if (!scopes.includes(PLAN_SCOPE)) return undefined;
	return {
		type: "oauth",
		access: access_token,
		refresh: refresh_token,
		expires: Date.now() + expires_in * 1000 - EXPIRY_MARGIN_MS,
		clientId: previous.clientId,
		scopes,
	};
}

/** A usable ChatGPT access token, or the fault that kept one from being had. */
type Access = { access: string } | { fault: Fault };

/**
 * A connection in trouble, stored as `trouble:<connectionId>` until a probe gets an answer.
 * `bots` have work waiting on it, and are woken on recovery.
 */
interface Trouble extends Fault {
	accountId: string;
	/** The model the probes ask: the one the first interrupted turn was on. */
	model: string;
	/** Failed probes so far, which set the next one's delay. */
	attempt: number;
	probeAt: number;
	bots: string[];
}

/** Probes wait a second, then twice as long after each failure, up to five minutes. */
const PROBE_BASE_MS = 1000;
const PROBE_MAX_MS = 5 * 60_000;

/** The next probe: after the backoff, and never before a limit's reset time. */
function nextProbe(attempt: number, resetsAt: string | undefined, now = Date.now()): number {
	const backoff = Math.min(PROBE_BASE_MS * 2 ** attempt, PROBE_MAX_MS);
	return Math.max(now + backoff, resetsAt ? Date.parse(resetsAt) : 0);
}

/** Whether the connection is probed: a refused key waits for the owner to reconnect instead. */
const probed = (trouble: Trouble) => trouble.state !== "ReconnectNeeded";

const faultIn = ({ state, resetsAt }: Trouble): Fault =>
	resetsAt ? { state, resetsAt } : { state };

/** A probe's outcome: "ok" once the provider answers, else the fault its answer names. */
const answered = (answer: Response | "unreachable" | null): "ok" | Fault | null =>
	answer !== "unreachable" && answer?.ok ? "ok" : faultOf(answer);

const base64 = (bytes: ArrayBuffer | Uint8Array) =>
	btoa(String.fromCharCode(...new Uint8Array(bytes)));

const bytes = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

async function stageKey(secret: string, usage: "encrypt" | "decrypt") {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
	return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [usage]);
}

/** The inverse of `seal`: fails unless `scope` is the one the value was sealed under. */
async function open(secret: string, sealed: Sealed, scope: string): Promise<string> {
	const plain = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv: bytes(sealed.iv), additionalData: new TextEncoder().encode(scope) },
		await stageKey(secret, "decrypt"),
		bytes(sealed.data),
	);
	return new TextDecoder().decode(plain);
}

async function seal(secret: string, plain: string, scope: string): Promise<Sealed> {
	const key = await stageKey(secret, "encrypt");
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const data = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(scope) },
		key,
		new TextEncoder().encode(plain),
	);
	return { iv: base64(iv), data: base64(data) };
}

/**
 * Asks OpenCode for the smallest reply on `model`. Only a 401 or 403 means the key itself is
 * refused; any other failure says nothing about the key.
 */
async function checkOpenCodeKey(
	base: string,
	key: string,
	model: string,
): Promise<ConnectRefusal | null> {
	const response = await fetch(`${base}/responses`, {
		method: "POST",
		headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
		body: JSON.stringify({ model, input: "Reply with exactly one word: pong", store: false }),
	}).catch(() => null);
	if (!response) return "unavailable";
	await response.body?.cancel();
	if (response.status === 401 || response.status === 403) return "rejected";
	return response.ok ? null : "unavailable";
}

/**
 * One per Ditto account, holding its model connections. The only reader of their keys: a key or
 * ChatGPT sign-in enters once, when the owner connects or imports it, and only a key or access
 * token leaves, in a grant to a Bot for one call, never in an answer to the owner.
 */
export class Credentials extends DurableObject<AuthEnv> implements CredentialsRpc {
	/** The ChatGPT access token being read or rotated, which every caller meanwhile shares. */
	#chatgptAccess: Promise<Access | null> | null = null;
	/** Set while a rotation is out with OpenAI, so the plan shows Refreshing. */
	#rotating = false;

	override fetch(): Response {
		return Response.json({ object: "Credentials" });
	}

	async view(): Promise<ModelAccessView> {
		const opencode = await this.ctx.storage.get<StoredConnection>("connection:opencode");
		const chatgpt = await this.ctx.storage.get<StoredChatGPT>("connection:chatgpt");
		const defaultPair = (await this.ctx.storage.get<Pair>("defaultPair")) ?? null;
		const troubled = async (id: string) => {
			const trouble = await this.ctx.storage.get<Trouble>(`trouble:${id}`);
			return {
				state: trouble?.state ?? ("Connected" as const),
				...(trouble?.resetsAt ? { resetsAt: trouble.resetsAt } : {}),
			};
		};
		const connections: ModelAccessView["connections"] = [];
		if (opencode) {
			connections.push({
				id: "opencode",
				provider: "opencode",
				...(await troubled("opencode")),
				models: OPENCODE_MODELS,
			});
		}
		if (chatgpt) {
			const health = await troubled("chatgpt");
			connections.push({
				id: "chatgpt",
				provider: "chatgpt",
				...(this.#rotating && health.state === "Connected" ? { state: "Refreshing" } : health),
				models: CHATGPT_MODELS,
			});
		}
		return { connections, defaultPair };
	}

	async offersChatGPT(): Promise<boolean> {
		const tested =
			this.env.TEST_HOOKS === "on"
				? await this.ctx.storage.get<Deployment>("test:deployment")
				: undefined;
		const { mode, license, approval } = tested ?? {
			mode: this.env.DEPLOYMENT_MODE,
			license: this.env.OPEN_SOURCE_LICENSE,
			approval: this.env.OPENAI_HOSTED_APPROVAL,
		};
		// Any mode but self-deployed takes the hosted rule, which asks more.
		return Boolean(license) && (mode === "self-deployed" || Boolean(approval));
	}

	async deployAs(deployment: Deployment): Promise<void> {
		if (this.env.TEST_HOOKS !== "on") throw new Error("Test stage only");
		await this.ctx.storage.put("test:deployment", deployment);
	}

	async importChatGPT(
		accountId: string,
		credential: unknown,
	): Promise<"imported" | "malformed" | "not-offered"> {
		if (!(await this.offersChatGPT())) return "not-offered";
		const imported = signIn(credential);
		if (!imported) return "malformed";
		const connection: StoredChatGPT = {
			provider: "chatgpt",
			signIn: await seal(
				this.env.CREDENTIALS_ENCRYPTION_KEY,
				JSON.stringify(imported),
				`${accountId}:chatgpt`,
			),
			expires: imported.expires,
			connectedAt: new Date().toISOString(),
		};
		// A second import replaces the first whole, its refresh token included.
		await this.ctx.storage.put("connection:chatgpt", connection);
		// A fresh sign-in, so whatever the old one left waiting carries on.
		const trouble = await this.ctx.storage.get<Trouble>("trouble:chatgpt");
		if (trouble) {
			await this.ctx.storage.delete("trouble:chatgpt");
			void this.#wake({ ...trouble, accountId });
		}
		if (!(await this.ctx.storage.get("defaultPair"))) {
			await this.ctx.storage.put("defaultPair", {
				connectionId: "chatgpt",
				model: CHATGPT_MODELS[0],
			});
		}
		return "imported";
	}

	async connectOpenCode(
		accountId: string,
		key: string,
		model: string,
	): Promise<{ connected: true } | { refused: ConnectRefusal }> {
		if (!OPENCODE_MODELS.includes(model)) return { refused: "unknown-model" };
		const refused = await checkOpenCodeKey(this.env.OPENCODE_BASE_URL ?? OPENCODE, key, model);
		if (refused) return { refused };
		const connection: StoredConnection = {
			provider: "opencode",
			key: await seal(this.env.CREDENTIALS_ENCRYPTION_KEY, key, `${accountId}:opencode`),
			connectedAt: new Date().toISOString(),
		};
		await this.ctx.storage.put("connection:opencode", connection);
		// The first pair chosen becomes the default.
		if (!(await this.ctx.storage.get("defaultPair"))) {
			await this.ctx.storage.put("defaultPair", { connectionId: "opencode", model });
		}
		// A new key answered, so whatever the old one left waiting carries on.
		const trouble = await this.ctx.storage.get<Trouble>("trouble:opencode");
		if (trouble) {
			await this.ctx.storage.delete("trouble:opencode");
			void this.#wake({ ...trouble, accountId });
		}
		return { connected: true };
	}

	async chooseDefault(pair: Pair): Promise<boolean> {
		const { connections } = await this.view();
		const connection = connections.find((each) => each.id === pair.connectionId);
		if (!connection?.models.includes(pair.model)) return false;
		await this.ctx.storage.put("defaultPair", {
			connectionId: pair.connectionId,
			model: pair.model,
		});
		return true;
	}

	async disconnect(connectionId: string): Promise<boolean> {
		if (!(await this.ctx.storage.delete(`connection:${connectionId}`))) return false;
		const defaultPair = await this.ctx.storage.get<Pair>("defaultPair");
		// Left in place, the default would come back to life with the next key connected.
		if (defaultPair?.connectionId === connectionId) await this.ctx.storage.delete("defaultPair");
		// Nothing left to probe: a key connected later starts out healthy.
		await this.ctx.storage.delete(`trouble:${connectionId}`);
		return true;
	}

	async grant(accountId: string, pair: Pair | null): Promise<Grant> {
		const wanted = pair ?? (await this.ctx.storage.get<Pair>("defaultPair"));
		if (wanted?.connectionId === "chatgpt") return this.#grantChatGPT(accountId, wanted);
		const opencode = await this.ctx.storage.get<StoredConnection>("connection:opencode");
		if (
			wanted?.connectionId !== "opencode" ||
			!opencode ||
			!OPENCODE_MODELS.includes(wanted.model)
		) {
			return { refused: "no-model" };
		}
		const granted = { connectionId: wanted.connectionId, model: wanted.model };
		const trouble = await this.ctx.storage.get<Trouble>(`trouble:${granted.connectionId}`);
		if (trouble) return { refused: "interrupted", pair: granted, fault: faultIn(trouble) };
		const key = await open(
			this.env.CREDENTIALS_ENCRYPTION_KEY,
			opencode.key,
			`${accountId}:opencode`,
		);
		return { pair: granted, credential: { type: "api_key", key } };
	}

	async interrupted(
		accountId: string,
		botId: string,
		pair: Pair,
		fault?: Fault,
	): Promise<Fault | null> {
		return this.#troubled(accountId, botId, pair, fault);
	}

	/** Records `fault` on `pair`'s connection, and `botId` as waiting on it when one is given. */
	async #troubled(
		accountId: string,
		botId: string | null,
		pair: Pair,
		fault?: Fault,
	): Promise<Fault | null> {
		const name = `trouble:${pair.connectionId}`;
		const known = await this.ctx.storage.get<Trouble>(name);
		if (!known && !fault) return null;
		const trouble: Trouble = known ?? {
			state: "Throttled",
			accountId,
			model: pair.model,
			attempt: 0,
			probeAt: 0,
			bots: [],
		};
		if (fault) {
			// A reset time belongs to the limit that gave it.
			if (fault.state !== trouble.state) delete trouble.resetsAt;
			trouble.state = fault.state;
			if (fault.resetsAt) trouble.resetsAt = fault.resetsAt;
		}
		if (botId && !trouble.bots.includes(botId)) trouble.bots.push(botId);
		if (!known) trouble.probeAt = nextProbe(0, trouble.resetsAt);
		await this.ctx.storage.put(name, trouble);
		await this.#schedule();
		return faultIn(trouble);
	}

	async check(accountId: string, connectionId: string): Promise<ConnectionState | null> {
		if (!(await this.ctx.storage.get(`connection:${connectionId}`))) return null;
		const name = `trouble:${connectionId}`;
		const trouble = await this.ctx.storage.get<Trouble>(name);
		if (!trouble) return "Connected";
		// A refused key stays refused: asking again would only send it once more.
		if (trouble.state === "ReconnectNeeded") return trouble.state;
		const { state } = await this.#probeOnce(name, { ...trouble, accountId });
		await this.#schedule();
		return state;
	}

	/** Probes each connection in trouble that is due, and wakes its bots once one answers. */
	override async alarm(): Promise<void> {
		const troubles = await this.ctx.storage.list<Trouble>({ prefix: "trouble:" });
		for (const [name, trouble] of troubles) {
			if (!probed(trouble) || trouble.probeAt > Date.now()) continue;
			const { woken } = await this.#probeOnce(name, trouble);
			await woken;
		}
		await this.#schedule();
	}

	/**
	 * Asks the provider once. An answer clears the trouble and wakes its bots; otherwise the
	 * fault it names, if any, replaces the old one and the next probe moves further out.
	 */
	async #probeOnce(
		name: string,
		trouble: Trouble,
	): Promise<{ state: ConnectionState; woken?: Promise<void> }> {
		const fault =
			name === "trouble:chatgpt"
				? await this.#probeChatGPT(trouble)
				: answered(await this.#probe(trouble));
		if (fault === "ok") {
			await this.ctx.storage.delete(name);
			return { state: "Connected", woken: this.#wake(trouble) };
		}
		if (fault && fault.state !== trouble.state) delete trouble.resetsAt;
		if (fault) Object.assign(trouble, fault);
		trouble.attempt += 1;
		trouble.probeAt = nextProbe(trouble.attempt, trouble.resetsAt);
		await this.ctx.storage.put(name, trouble);
		return { state: trouble.state };
	}

	/** Tells each bot with work waiting on the connection that it answers again. */
	#wake(trouble: Trouble): Promise<void> {
		const woken = Promise.all(
			trouble.bots.map((botId) =>
				this.#bot(botId)
					.recover(trouble.accountId)
					.catch((error: unknown) => console.error("A bot didn’t recover:", error)),
			),
		).then(() => {});
		this.ctx.waitUntil(woken);
		return woken;
	}

	/** Sets the alarm for the soonest probe due, while any connection is in trouble. */
	async #schedule(): Promise<void> {
		const troubles = await this.ctx.storage.list<Trouble>({ prefix: "trouble:" });
		const due = Math.min(
			...[...troubles.values()].filter(probed).map((trouble) => trouble.probeAt),
		);
		if (Number.isFinite(due)) await this.ctx.storage.setAlarm(due);
		else await this.ctx.storage.deleteAlarm();
	}

	/** Asks the provider for the smallest reply with the stored key. Null without a key to send. */
	async #probe(trouble: Trouble): Promise<Response | "unreachable" | null> {
		const opencode = await this.ctx.storage.get<StoredConnection>("connection:opencode");
		if (!opencode) return null;
		const key = await open(
			this.env.CREDENTIALS_ENCRYPTION_KEY,
			opencode.key,
			`${trouble.accountId}:opencode`,
		);
		const response = await fetch(`${this.env.OPENCODE_BASE_URL ?? OPENCODE}/responses`, {
			method: "POST",
			headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
			body: JSON.stringify({
				model: trouble.model,
				input: "Reply with exactly one word: pong",
				store: false,
			}),
		}).catch(() => "unreachable" as const);
		if (response !== "unreachable") await response.body?.cancel();
		return response;
	}

	/**
	 * The same probe on the ChatGPT plan, within the flow's rules: stored nowhere, streamed. An
	 * expired token is rotated first, so a failed rotation is retried by these probes too.
	 */
	async #probeChatGPT(trouble: Trouble): Promise<"ok" | Fault | null> {
		const token = await this.#chatgptToken(trouble.accountId);
		if (!token) return null;
		if ("fault" in token) return token.fault;
		const response = await openaiFetch(this.env.OAUTH_UPSTREAM)(OPENAI_RESPONSES, {
			method: "POST",
			headers: { authorization: `Bearer ${token.access}`, "content-type": "application/json" },
			body: JSON.stringify({
				model: trouble.model,
				input: [{ role: "user", content: "Reply with exactly one word: pong" }],
				store: false,
				stream: true,
			}),
		}).catch(() => "unreachable" as const);
		if (response !== "unreachable") await response.body?.cancel();
		return answered(response);
	}

	/**
	 * The ChatGPT access token, rotated first once it has expired. Callers meanwhile share the
	 * one read or rotation in flight, and each starts by reading storage again, so no caller can
	 * present a refresh token a rotation already spent. Null without a ChatGPT connection.
	 */
	#chatgptToken(accountId: string): Promise<Access | null> {
		this.#chatgptAccess ??= this.#currentChatGPT(accountId).finally(() => {
			this.#chatgptAccess = null;
		});
		return this.#chatgptAccess;
	}

	async #currentChatGPT(accountId: string): Promise<Access | null> {
		const chatgpt = await this.ctx.storage.get<StoredChatGPT>("connection:chatgpt");
		if (!chatgpt) return null;
		const scope = `${accountId}:chatgpt`;
		const signIn = JSON.parse(
			await open(this.env.CREDENTIALS_ENCRYPTION_KEY, chatgpt.signIn, scope),
		) as SignIn;
		if (chatgpt.expires > Date.now()) return { access: signIn.access };

		this.#rotating = true;
		try {
			const answer = await openaiFetch(this.env.OAUTH_UPSTREAM)(OPENAI_TOKEN, {
				method: "POST",
				headers: {
					accept: "application/json",
					"content-type": "application/x-www-form-urlencoded",
				},
				body: new URLSearchParams({
					grant_type: "refresh_token",
					client_id: signIn.clientId,
					refresh_token: signIn.refresh,
					resource: OPENAI_RESOURCE,
				}),
			}).catch(() => "unreachable" as const);
			const next =
				answer !== "unreachable" && answer.ok
					? rotated(await answer.json().catch(() => null), signIn)
					: undefined;
			if (!next) {
				if (answer !== "unreachable") await answer.body?.cancel().catch(() => {});
				// A limit or an outage is retried; a refused or malformed rotation needs the owner.
				return { fault: faultOf(answer) ?? { state: "ReconnectNeeded" } };
			}
			// The old refresh token is spent now, so the replacement is saved before anyone hears.
			await this.ctx.storage.put("connection:chatgpt", {
				...chatgpt,
				signIn: await seal(this.env.CREDENTIALS_ENCRYPTION_KEY, JSON.stringify(next), scope),
				expires: next.expires,
			} satisfies StoredChatGPT);
			// Durable, not just queued: an object reset now must not lose the only valid pair.
			await this.ctx.storage.sync();
			if (
				this.env.TEST_HOOKS === "on" &&
				(await this.ctx.storage.delete("test:evictAfterRotation"))
			) {
				this.ctx.abort("evicted by the test stage between a rotation and its answer");
			}
			return { access: next.access };
		} finally {
			this.#rotating = false;
		}
	}

	async evictAfterRotation(): Promise<void> {
		if (this.env.TEST_HOOKS === "on") await this.ctx.storage.put("test:evictAfterRotation", true);
	}

	/**
	 * A bot's Bot object. Workers types keep only `fetch` on a stub whose shape lacks their
	 * brand, so the RPC surface is restored here.
	 */
	#bot(botId: string): DurableObjectStub<Bot> {
		const namespace = this.env.BOT as unknown as DurableObjectNamespace<Bot>;
		return namespace.getByName(botId);
	}

	async stored(): Promise<Record<string, unknown>> {
		return Object.fromEntries(await this.ctx.storage.list());
	}

	/**
	 * Hands out the access token alone, rotated first if it expired: the refresh token never
	 * leaves this object. A failed rotation puts the plan in trouble, as a failed turn would.
	 */
	async #grantChatGPT(accountId: string, wanted: Pair): Promise<Grant> {
		const chatgpt = await this.ctx.storage.get<StoredChatGPT>("connection:chatgpt");
		// A gate that closed after the import closes the plan too.
		if (!chatgpt || !CHATGPT_MODELS.includes(wanted.model) || !(await this.offersChatGPT())) {
			return { refused: "no-model" };
		}
		const granted = { connectionId: wanted.connectionId, model: wanted.model };
		const trouble = await this.ctx.storage.get<Trouble>("trouble:chatgpt");
		if (trouble) return { refused: "interrupted", pair: granted, fault: faultIn(trouble) };
		const token = await this.#chatgptToken(accountId);
		if (!token) return { refused: "no-model" };
		if ("fault" in token) {
			const fault = (await this.#troubled(accountId, null, granted, token.fault)) ?? token.fault;
			return { refused: "interrupted", pair: granted, fault };
		}
		return { pair: granted, credential: { type: "api_key", key: token.access } };
	}
}
