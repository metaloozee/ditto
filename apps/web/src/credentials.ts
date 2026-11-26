import { createAiBindingFetch } from "@earendil-works/pi-ai/api/cloudflare-ai-binding";
import { DurableObject } from "cloudflare:workers";

import type { Bot } from "./bot.ts";
import type {
	ConnectRefusal,
	CredentialsRpc,
	Fault,
	Grant,
	ModelAccessView,
} from "./credentials-rpc.ts";
import type { AuthEnv } from "./lib/auth.ts";
import { INCLUDED, OPENCODE_MODELS, type Pair } from "./lib/model-access.ts";
import { faultOf } from "./lib/provider-fault.ts";

const OPENCODE = "https://opencode.ai/inference/openai/v1";

/**
 * The included model (ADR-0011): the pinned Workers AI model, then the second choice the
 * decision record names for when Workers AI retires it. Both called tools in #35.
 */
const INCLUDED_MODELS = [
	{ id: "@cf/deepseek-ai/deepseek-v4.1-flash-1017", name: "DeepSeek V4.1 Flash" },
	{ id: "@cf/zai-org/glm-5.3", name: "GLM-5.3" },
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

const faultIn = ({ state, resetsAt }: Trouble): Fault =>
	resetsAt ? { state, resetsAt } : { state };

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
 * One per Ditto account, holding its model connections. The only reader of their keys: a key
 * enters once, when the owner connects it, and leaves only in a grant to a Bot for one call,
 * never in an answer to the owner. Every included-model request passes through it too, so it
 * is where a per-account limit would go.
 */
export class Credentials extends DurableObject<AuthEnv> implements CredentialsRpc {
	override fetch(): Response {
		return Response.json({ object: "Credentials" });
	}

	async view(): Promise<ModelAccessView> {
		const opencode = await this.ctx.storage.get<StoredConnection>("connection:opencode");
		const included = await this.#includedModel();
		const trouble = await this.ctx.storage.get<Trouble>("trouble:opencode");
		return {
			connections: opencode
				? [
						{
							id: "opencode",
							provider: "opencode",
							state: trouble?.state ?? "Connected",
							...(trouble?.resetsAt ? { resetsAt: trouble.resetsAt } : {}),
							models: OPENCODE_MODELS,
						},
					]
				: [],
			defaultPair: await this.#defaultPair(included),
			...(included ? { included: included.name } : {}),
		};
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
	 * The chosen default, or the included model while nothing is chosen. A chosen included model
	 * that is no longer offered leaves no default rather than falling to a connection.
	 */
	async #defaultPair(included: IncludedModel | null): Promise<Pair | null> {
		const chosen = await this.ctx.storage.get<Pair>("defaultPair");
		if (chosen && chosen.connectionId !== INCLUDED) return chosen;
		return included ? { connectionId: INCLUDED, model: included.name } : null;
	}

	async included(accountId: string, body: string): Promise<Response> {
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
			// Workers AI retired it (AiError 5028): every later request moves to the next choice.
			await response.body?.cancel();
			const retired = (await this.ctx.storage.get<string[]>("included:retired")) ?? [];
			await this.ctx.storage.put("included:retired", [...retired, model.id]);
		}
		return Response.json({ error: "No included model is offered" }, { status: 403 });
	}

	async offerIncluded(offered: boolean): Promise<void> {
		if (this.env.TEST_HOOKS !== "on") throw new Error("Test stage only");
		await this.ctx.storage.put("test:includedOffered", offered);
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
		if (!(await this.ctx.storage.delete(`connection:${connectionId}`))) return false;
		const defaultPair = await this.ctx.storage.get<Pair>("defaultPair");
		// Left in place, the default would come back to life with the next key connected.
		if (defaultPair?.connectionId === connectionId) await this.ctx.storage.delete("defaultPair");
		// Nothing left to probe: a key connected later starts out healthy.
		await this.ctx.storage.delete(`trouble:${connectionId}`);
		return true;
	}

	async grant(accountId: string, pair: Pair | null): Promise<Grant> {
		const included = await this.#includedModel();
		const wanted = pair ?? (await this.#defaultPair(included));
		// Never moved to another source: an included pair gets the included model or nothing.
		if (wanted?.connectionId === INCLUDED) {
			return included
				? { pair: { connectionId: INCLUDED, model: included.name }, included: included.id }
				: { refused: "no-model" };
		}
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
			trouble.state = fault.state;
			if (fault.resetsAt) trouble.resetsAt = fault.resetsAt;
		}
		if (!trouble.bots.includes(botId)) trouble.bots.push(botId);
		if (!known) trouble.probeAt = nextProbe(0, trouble.resetsAt);
		await this.ctx.storage.put(name, trouble);
		await this.#schedule();
		return faultIn(trouble);
	}

	/** Probes each connection in trouble that is due, and wakes its bots once one answers. */
	override async alarm(): Promise<void> {
		const troubles = await this.ctx.storage.list<Trouble>({ prefix: "trouble:" });
		for (const [name, trouble] of troubles) {
			if (trouble.probeAt > Date.now()) continue;
			const answer = await this.#probe(trouble);
			if (answer?.ok) {
				await this.ctx.storage.delete(name);
				await Promise.all(
					trouble.bots.map((botId) =>
						this.#bot(botId)
							.recover(trouble.accountId)
							.catch((error: unknown) => console.error("A bot didn’t recover:", error)),
					),
				);
				continue;
			}
			// No answer, or one that names no fault, keeps the state the connection had.
			const fault = faultOf(answer);
			if (fault) Object.assign(trouble, fault);
			trouble.attempt += 1;
			trouble.probeAt = nextProbe(trouble.attempt, trouble.resetsAt);
			await this.ctx.storage.put(name, trouble);
		}
		await this.#schedule();
	}

	/** Sets the alarm for the soonest probe due, while any connection is in trouble. */
	async #schedule(): Promise<void> {
		const troubles = await this.ctx.storage.list<Trouble>({ prefix: "trouble:" });
		const due = Math.min(...[...troubles.values()].map((trouble) => trouble.probeAt));
		if (Number.isFinite(due)) await this.ctx.storage.setAlarm(due);
	}

	/** Asks the provider for the smallest reply with the stored key. Null when it didn't answer. */
	async #probe(trouble: Trouble): Promise<Response | null> {
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
		}).catch(() => null);
		await response?.body?.cancel();
		return response;
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
}
