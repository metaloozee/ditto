import { createAiBindingFetch } from "@earendil-works/pi-ai/api/cloudflare-ai-binding";
import { OPENCODE_MODELS as PI_OPENCODE_MODELS } from "@earendil-works/pi-ai/providers/opencode.models";
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
	INCLUDED,
	OPENCODE_MODELS,
	type Pair,
} from "./lib/model-access.ts";
import { openaiFetch } from "./lib/openai-upstream.ts";
import { faultOf } from "./lib/provider-fault.ts";
import { testStageOnly } from "./lib/test-stage.ts";

const OPENCODE = "https://opencode.ai/inference/openai/v1";
const OPENAI_RESPONSES = "https://api.openai.com/v1/responses";
const OPENAI_TOKEN = "https://auth.openai.com/api/accounts/oauth/token";
/** The resource a Sign in with ChatGPT token is for, which a refresh names again. */
const OPENAI_RESOURCE = "https://api.openai.com/v1";
const PLAN_SCOPE = "chatgpt.tokens.use.direct";
/** What every probe asks, and the key check on connect too: the smallest reply there is. */
const PROBE = "Reply with exactly one word: pong";
/** A rotated token counts as expired this long early, as Pi's own sign-in does. */
const EXPIRY_MARGIN_MS = 3 * 60_000;

/**
 * The included model (ADR-0011): the pinned Workers AI model, which called tools in #35. The
 * owner dropped the second choice, so once Workers AI retires it no included model is offered.
 */
const INCLUDED_MODELS = [
	{ id: "@cf/deepseek-ai/deepseek-v4.1-flash-1017", name: "DeepSeek V4.1 Flash" },
] as const;

type IncludedModel = (typeof INCLUDED_MODELS)[number];

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
 * A source's fault, stored under `faultKey` until a probe gets an answer. `bots` have work
 * waiting on it, and are woken on recovery.
 */
interface StoredFault extends Fault {
	accountId: string;
	/** The model the probes ask: the one the first interrupted turn was on. */
	model: string;
	/** Failed probes so far, which set the next one's delay. */
	attempt: number;
	probeAt: number;
	bots: string[];
}

const connectionKey = (connectionId: string) => `connection:${connectionId}`;
const faultKey = (connectionId: string) => `fault:${connectionId}`;

/** Probes wait a second, then twice as long after each failure, up to five minutes. */
const PROBE_BASE_MS = 1000;
const PROBE_MAX_MS = 5 * 60_000;

/** The next probe: after the backoff, and never before a limit's reset time. */
function nextProbe(attempt: number, resetsAt: string | undefined, now = Date.now()): number {
	const backoff = Math.min(PROBE_BASE_MS * 2 ** attempt, PROBE_MAX_MS);
	return Math.max(now + backoff, resetsAt ? Date.parse(resetsAt) : 0);
}

/** Whether the source is probed: a refused key waits for the owner to reconnect instead. */
const probed = (stored: StoredFault) => stored.state !== "ReconnectNeeded";

const bare = ({ state, resetsAt }: StoredFault): Fault =>
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
 * Asks OpenCode for the smallest reply on `model` with `key`, the body left unread. It goes to
 * the endpoint Pi's catalogue serves the model on, as the model's turns do.
 */
async function askOpenCode(
	base: string,
	key: string,
	model: string,
): Promise<Response | "unreachable"> {
	const responses =
		Object.values(PI_OPENCODE_MODELS).find((each) => each.id === model)?.api === "openai-responses";
	const response = await fetch(`${base}/${responses ? "responses" : "chat/completions"}`, {
		method: "POST",
		headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
		body: JSON.stringify(
			responses
				? { model, input: PROBE, store: false }
				: { model, messages: [{ role: "user", content: PROBE }] },
		),
	}).catch(() => "unreachable" as const);
	if (response !== "unreachable") await response.body?.cancel();
	return response;
}

/**
 * One per Ditto account, holding its model connections. The only reader of their keys: a key
 * or ChatGPT sign-in enters once, when the owner connects or imports it, and only a key or
 * access token leaves, in a grant to a Bot for one call, never in an answer to the owner.
 * Every included-model request passes through it too, so it is where a per-account limit
 * would go.
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
		const opencode = await this.ctx.storage.get<StoredConnection>(connectionKey("opencode"));
		const chatgpt = await this.ctx.storage.get<StoredChatGPT>(connectionKey("chatgpt"));
		const included = await this.#includedModel();
		const health = async (connectionId: string) => {
			const stored = await this.ctx.storage.get<StoredFault>(faultKey(connectionId));
			return {
				state: stored?.state ?? ("Connected" as const),
				...(stored?.resetsAt ? { resetsAt: stored.resetsAt } : {}),
			};
		};
		const connections: ModelAccessView["connections"] = [];
		if (opencode) {
			connections.push({
				id: "opencode",
				provider: "opencode",
				...(await health("opencode")),
				models: OPENCODE_MODELS,
			});
		}
		// A gate that closed after the import shows the plan as not offered, as before it.
		if (chatgpt && (await this.offersChatGPT())) {
			const plan = await health("chatgpt");
			connections.push({
				id: "chatgpt",
				provider: "chatgpt",
				...(this.#rotating && plan.state === "Connected" ? { state: "Refreshing" } : plan),
				models: CHATGPT_MODELS,
			});
		}
		const defaultPair = await this.#defaultPair(included);
		const shown =
			defaultPair?.connectionId === INCLUDED ||
			connections.some((each) => each.id === defaultPair?.connectionId);
		return {
			connections,
			defaultPair: shown ? defaultPair : null,
			...(included ? { included: included.name } : {}),
		};
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
		testStageOnly(this.env);
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
		await this.ctx.storage.put(connectionKey("chatgpt"), connection);
		// A fresh sign-in, so whatever the old one left waiting carries on.
		await this.#clearFault("chatgpt");
		const [model] = CHATGPT_MODELS;
		if (model) await this.#defaultIfNone({ connectionId: "chatgpt", model });
		return "imported";
	}

	/**
	 * The included model this account is offered: none unless the stage turns it on, else the
	 * first of `INCLUDED_MODELS` Workers AI hasn't retired.
	 */
	async #includedModel(): Promise<IncludedModel | null> {
		const override =
			this.env.TEST_HOOKS === "on"
				? await this.ctx.storage.get<boolean>("test:includedOffered")
				: undefined;
		if (!(override ?? this.env.INCLUDED_MODEL === "on") || !this.env.AI) return null;
		const retired = (await this.ctx.storage.get<string[]>("included:retired")) ?? [];
		return INCLUDED_MODELS.find((model) => !retired.includes(model.id)) ?? null;
	}

	/**
	 * The default the owner chose, if any: the included model only once chosen, under its
	 * current name. One no longer offered leaves no default rather than falling to a connection.
	 */
	async #defaultPair(included: IncludedModel | null): Promise<Pair | null> {
		const chosen = await this.ctx.storage.get<Pair>("defaultPair");
		if (chosen?.connectionId !== INCLUDED) return chosen ?? null;
		return included ? { connectionId: INCLUDED, model: included.name } : null;
	}

	/** The first pair connected becomes the default. */
	async #defaultIfNone(pair: Pair): Promise<void> {
		if (!(await this.ctx.storage.get("defaultPair"))) {
			await this.ctx.storage.put("defaultPair", pair);
		}
	}

	async included(body: string): Promise<Response> {
		// Billed to the account this object belongs to, the name it was reached by, never to one
		// a caller names.
		const accountId = this.ctx.id.name;
		if (!accountId) throw new Error("Credentials is reached by its account ID");
		return this.#sendIncluded(accountId, body);
	}

	async #sendIncluded(accountId: string, body: string): Promise<Response> {
		const request = JSON.parse(body) as Record<string, unknown>;
		const send = this.env.AI && createAiBindingFetch(this.env.AI);
		for (
			let model = await this.#includedModel();
			send && model;
			model = await this.#includedModel()
		) {
			const response = await send(
				`https://workers-binding.ai/ai-gateway/gateways/${this.env.AI_GATEWAY_ID}/workers-ai/v1/chat/completions`,
				{
					method: "POST",
					// Built here, never taken from the Bot: the gateway bills the metadata's account, and
					// a provider key in the request would be used instead of the operator's.
					headers: {
						"content-type": "application/json",
						"cf-aig-metadata": JSON.stringify({ dittoAccount: accountId }),
					},
					body: JSON.stringify({ ...request, model: model.id }),
				},
			);
			if (response.status !== 410) return response;
			// Workers AI retired it (AiError 5028): it is never asked again, and with no other choice left, nothing is.
			await response.body?.cancel();
			const retired = (await this.ctx.storage.get<string[]>("included:retired")) ?? [];
			await this.ctx.storage.put("included:retired", [...retired, model.id]);
		}
		return Response.json({ error: "No included model is offered" }, { status: 403 });
	}

	async offerIncluded(offered: boolean): Promise<void> {
		testStageOnly(this.env);
		await this.ctx.storage.put("test:includedOffered", offered);
	}

	async connectOpenCode(
		accountId: string,
		key: string,
		model: string,
	): Promise<{ connected: true } | { refused: ConnectRefusal }> {
		if (!OPENCODE_MODELS.includes(model)) return { refused: "unknown-model" };
		const answer = await askOpenCode(this.env.OPENCODE_BASE_URL ?? OPENCODE, key, model);
		// Only a 401 or 403 means the key itself is refused; any other failure says nothing of it.
		if (answer !== "unreachable" && (answer.status === 401 || answer.status === 403)) {
			return { refused: "rejected" };
		}
		if (answer === "unreachable" || !answer.ok) return { refused: "unavailable" };
		const connection: StoredConnection = {
			provider: "opencode",
			key: await seal(this.env.CREDENTIALS_ENCRYPTION_KEY, key, `${accountId}:opencode`),
			connectedAt: new Date().toISOString(),
		};
		await this.ctx.storage.put(connectionKey("opencode"), connection);
		await this.#defaultIfNone({ connectionId: "opencode", model });
		// A new key answered, so whatever the old one left waiting carries on.
		await this.#clearFault("opencode");
		return { connected: true };
	}

	async chooseDefault(pair: Pair): Promise<boolean> {
		if (pair.connectionId === INCLUDED) {
			const included = await this.#includedModel();
			if (pair.model !== included?.name) return false;
			await this.ctx.storage.put("defaultPair", { connectionId: INCLUDED, model: included.name });
			return true;
		}
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
		if (!(await this.ctx.storage.delete(connectionKey(connectionId)))) return false;
		const defaultPair = await this.ctx.storage.get<Pair>("defaultPair");
		// Left in place, the default would come back to life with the next key connected.
		if (defaultPair?.connectionId === connectionId) await this.ctx.storage.delete("defaultPair");
		// Nothing left to probe, and the bots' unfinished turns stop holding their queues.
		await this.#clearFault(connectionId);
		return true;
	}

	/** Forgets the source's fault, and wakes the bots that waited on it. */
	async #clearFault(connectionId: string): Promise<void> {
		const stored = await this.ctx.storage.get<StoredFault>(faultKey(connectionId));
		if (!stored) return;
		await this.ctx.storage.delete(faultKey(connectionId));
		void this.#wake(stored);
	}

	async grant(accountId: string, pair: Pair | null): Promise<Grant> {
		const included = await this.#includedModel();
		const wanted = pair ?? (await this.#defaultPair(included));
		// Never moved to another source: an included pair gets the included model or nothing.
		if (wanted?.connectionId === INCLUDED) {
			if (!included) return { refused: "no-model" };
			const granted = { connectionId: INCLUDED, model: included.name };
			const stored = await this.ctx.storage.get<StoredFault>(faultKey(INCLUDED));
			if (stored) return { refused: "interrupted", pair: granted, fault: bare(stored) };
			return { pair: granted, included: included.id };
		}
		if (wanted?.connectionId === "chatgpt") return this.#grantChatGPT(accountId, wanted);
		const opencode = await this.ctx.storage.get<StoredConnection>(connectionKey("opencode"));
		if (
			wanted?.connectionId !== "opencode" ||
			!opencode ||
			!OPENCODE_MODELS.includes(wanted.model)
		) {
			return { refused: "no-model" };
		}
		const granted = { connectionId: wanted.connectionId, model: wanted.model };
		const stored = await this.ctx.storage.get<StoredFault>(faultKey(granted.connectionId));
		if (stored) return { refused: "interrupted", pair: granted, fault: bare(stored) };
		const key = await open(
			this.env.CREDENTIALS_ENCRYPTION_KEY,
			opencode.key,
			`${accountId}:opencode`,
		);
		return { pair: granted, credential: { type: "api_key", key } };
	}

	async recordFault(
		accountId: string,
		botId: string | null,
		pair: Pair,
		fault?: Fault,
	): Promise<Fault | null> {
		const known = await this.ctx.storage.get<StoredFault>(faultKey(pair.connectionId));
		if (!known && !fault) return null;
		const stored: StoredFault = known ?? {
			state: "Throttled",
			accountId,
			model: pair.model,
			attempt: 0,
			probeAt: 0,
			bots: [],
		};
		if (fault) {
			// A reset time belongs to the limit that gave it.
			if (fault.state !== stored.state) delete stored.resetsAt;
			stored.state = fault.state;
			if (fault.resetsAt) stored.resetsAt = fault.resetsAt;
		}
		if (botId && !stored.bots.includes(botId)) stored.bots.push(botId);
		if (!known) stored.probeAt = nextProbe(0, stored.resetsAt);
		await this.ctx.storage.put(faultKey(pair.connectionId), stored);
		await this.#schedule();
		return bare(stored);
	}

	async check(accountId: string, connectionId: string): Promise<ConnectionState | null> {
		const exists =
			connectionId === INCLUDED
				? await this.#includedModel()
				: await this.ctx.storage.get(connectionKey(connectionId));
		if (!exists) return null;
		const stored = await this.ctx.storage.get<StoredFault>(faultKey(connectionId));
		if (!stored) return "Connected";
		// A refused key stays refused: asking again would only send it once more.
		if (stored.state === "ReconnectNeeded") return stored.state;
		const { state } = await this.#probeOnce(connectionId, { ...stored, accountId });
		await this.#schedule();
		return state;
	}

	/** Probes each source with a fault that is due, and wakes its bots once one answers. */
	override async alarm(): Promise<void> {
		const faults = await this.ctx.storage.list<StoredFault>({ prefix: faultKey("") });
		for (const [name, stored] of faults) {
			if (!probed(stored) || stored.probeAt > Date.now()) continue;
			const { woken } = await this.#probeOnce(name.slice(faultKey("").length), stored);
			await woken;
		}
		await this.#schedule();
	}

	/**
	 * Asks the provider once. An answer clears the fault and wakes its bots; otherwise the
	 * fault it names, if any, replaces the old one and the next probe moves further out.
	 */
	async #probeOnce(
		connectionId: string,
		stored: StoredFault,
	): Promise<{ state: ConnectionState; woken?: Promise<void> }> {
		const outcome =
			connectionId === "chatgpt"
				? await this.#probeChatGPT(stored)
				: answered(
						connectionId === INCLUDED
							? await this.#probeIncluded(stored)
							: await this.#probeOpenCode(stored),
					);
		if (outcome === "ok") {
			await this.ctx.storage.delete(faultKey(connectionId));
			return { state: "Connected", woken: this.#wake(stored) };
		}
		if (outcome && outcome.state !== stored.state) delete stored.resetsAt;
		if (outcome) Object.assign(stored, outcome);
		stored.attempt += 1;
		stored.probeAt = nextProbe(stored.attempt, stored.resetsAt);
		await this.ctx.storage.put(faultKey(connectionId), stored);
		return { state: stored.state };
	}

	/** Tells each bot with work waiting on the source that it answers again. */
	#wake(stored: StoredFault): Promise<void> {
		const woken = Promise.all(
			stored.bots.map((botId) =>
				this.#bot(botId)
					.recover(stored.accountId)
					.catch((error: unknown) => console.error("A bot didn’t recover:", error)),
			),
		).then(() => {});
		this.ctx.waitUntil(woken);
		return woken;
	}

	/** Sets the alarm for the soonest probe due, while any source has a fault. */
	async #schedule(): Promise<void> {
		const faults = await this.ctx.storage.list<StoredFault>({ prefix: faultKey("") });
		const due = Math.min(...[...faults.values()].filter(probed).map((stored) => stored.probeAt));
		if (Number.isFinite(due)) await this.ctx.storage.setAlarm(due);
		else await this.ctx.storage.deleteAlarm();
	}

	/** The probe on OpenCode, with the stored key. Null without a key to send. */
	async #probeOpenCode(stored: StoredFault): Promise<Response | "unreachable" | null> {
		const opencode = await this.ctx.storage.get<StoredConnection>(connectionKey("opencode"));
		if (!opencode) return null;
		const key = await open(
			this.env.CREDENTIALS_ENCRYPTION_KEY,
			opencode.key,
			`${stored.accountId}:opencode`,
		);
		return askOpenCode(this.env.OPENCODE_BASE_URL ?? OPENCODE, key, stored.model);
	}

	/** The same probe on the included model, through the account's own gateway route. */
	async #probeIncluded(stored: StoredFault): Promise<Response | "unreachable" | null> {
		if (!(await this.#includedModel())) return null;
		const body = JSON.stringify({ messages: [{ role: "user", content: PROBE }] });
		const response = await this.#sendIncluded(stored.accountId, body).catch(
			() => "unreachable" as const,
		);
		if (response !== "unreachable") await response.body?.cancel();
		return response;
	}

	/**
	 * The same probe on the ChatGPT plan, within the flow's rules: stored nowhere, streamed. An
	 * expired token is rotated first, so a failed rotation is retried by these probes too.
	 */
	async #probeChatGPT(stored: StoredFault): Promise<"ok" | Fault | null> {
		// Not offered any more: nothing goes to OpenAI until the gate opens again.
		if (!(await this.offersChatGPT())) return null;
		let refused: string | undefined;
		for (;;) {
			const token = await this.#chatgptToken(stored.accountId, refused);
			if (!token) return null;
			if ("fault" in token) return token.fault;
			const response = await openaiFetch(this.env.OAUTH_UPSTREAM)(OPENAI_RESPONSES, {
				method: "POST",
				headers: { authorization: `Bearer ${token.access}`, "content-type": "application/json" },
				body: JSON.stringify({
					model: stored.model,
					input: [{ role: "user", content: PROBE }],
					store: false,
					stream: true,
				}),
			}).catch(() => "unreachable" as const);
			if (response !== "unreachable") await response.body?.cancel();
			// A token refused before it expired gets one rotation, as a turn's does.
			if (response === "unreachable" || response.status !== 401 || refused) {
				return answered(response);
			}
			refused = token.access;
		}
	}

	async replaceAccess(
		accountId: string,
		refused: string,
	): Promise<{ key: string } | { fault: Fault } | null> {
		if (!(await this.offersChatGPT())) return null;
		const token = await this.#chatgptToken(accountId, refused);
		return token && ("fault" in token ? token : { key: token.access });
	}

	/**
	 * The ChatGPT access token, rotated first once it has expired or OpenAI `refused` it.
	 * Callers meanwhile share the one read or rotation in flight, and each starts by reading
	 * storage again, so no caller can present a refresh token a rotation already spent. Null
	 * without a ChatGPT connection.
	 */
	async #chatgptToken(accountId: string, refused?: string): Promise<Access | null> {
		this.#chatgptAccess ??= this.#currentChatGPT(accountId, refused).finally(() => {
			this.#chatgptAccess = null;
		});
		const token = await this.#chatgptAccess;
		// Joined a read that answered the refused token itself: that one needs its rotation.
		const stale = refused && token && "access" in token && token.access === refused;
		return stale ? this.#chatgptToken(accountId, refused) : token;
	}

	async #currentChatGPT(accountId: string, refused?: string): Promise<Access | null> {
		const chatgpt = await this.ctx.storage.get<StoredChatGPT>(connectionKey("chatgpt"));
		if (!chatgpt) return null;
		const scope = `${accountId}:chatgpt`;
		const signIn = JSON.parse(
			await open(this.env.CREDENTIALS_ENCRYPTION_KEY, chatgpt.signIn, scope),
		) as SignIn;
		if (chatgpt.expires > Date.now() && signIn.access !== refused) {
			return { access: signIn.access };
		}

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
			// A disconnect or a newer import while the rotation was out wins over its answer.
			const current = await this.ctx.storage.get<StoredChatGPT>(connectionKey("chatgpt"));
			if (current?.signIn.iv !== chatgpt.signIn.iv) {
				if (answer !== "unreachable") await answer.body?.cancel().catch(() => {});
				return current ? this.#currentChatGPT(accountId, refused) : null;
			}
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
			await this.ctx.storage.put(connectionKey("chatgpt"), {
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
		testStageOnly(this.env);
		await this.ctx.storage.put("test:evictAfterRotation", true);
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
		testStageOnly(this.env);
		return Object.fromEntries(await this.ctx.storage.list());
	}

	/**
	 * Hands out the access token alone, rotated first if it expired: the refresh token never
	 * leaves this object. A failed rotation is the plan's fault, as a failed turn's would be.
	 */
	async #grantChatGPT(accountId: string, wanted: Pair): Promise<Grant> {
		const chatgpt = await this.ctx.storage.get<StoredChatGPT>(connectionKey("chatgpt"));
		// A gate that closed after the import closes the plan too.
		if (!chatgpt || !CHATGPT_MODELS.includes(wanted.model) || !(await this.offersChatGPT())) {
			return { refused: "no-model" };
		}
		const granted = { connectionId: wanted.connectionId, model: wanted.model };
		const stored = await this.ctx.storage.get<StoredFault>(faultKey("chatgpt"));
		if (stored) return { refused: "interrupted", pair: granted, fault: bare(stored) };
		const token = await this.#chatgptToken(accountId);
		if (!token) return { refused: "no-model" };
		if ("fault" in token) {
			const fault = (await this.recordFault(accountId, null, granted, token.fault)) ?? token.fault;
			return { refused: "interrupted", pair: granted, fault };
		}
		return { pair: granted, credential: { type: "api_key", key: token.access } };
	}
}
