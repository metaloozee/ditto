import { DurableObject } from "cloudflare:workers";

import type { ConnectRefusal, CredentialsRpc, Grant, ModelAccessView } from "./credentials-rpc.ts";
import type { AuthEnv } from "./lib/auth.ts";
import { CHATGPT_MODELS, OPENCODE_MODELS, type Pair } from "./lib/model-access.ts";

const OPENCODE = "https://opencode.ai/inference/openai/v1";

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
		!scopes.includes("chatgpt.tokens.use.direct")
	) {
		return undefined;
	}
	return { type, access, refresh, expires, clientId, scopes };
}

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
	override fetch(): Response {
		return Response.json({ object: "Credentials" });
	}

	async view(): Promise<ModelAccessView> {
		const opencode = await this.ctx.storage.get<StoredConnection>("connection:opencode");
		const chatgpt = await this.ctx.storage.get<StoredChatGPT>("connection:chatgpt");
		const defaultPair = (await this.ctx.storage.get<Pair>("defaultPair")) ?? null;
		const connections: ModelAccessView["connections"] = [];
		if (opencode) {
			connections.push({
				id: "opencode",
				provider: "opencode",
				state: "Connected",
				models: OPENCODE_MODELS,
			});
		}
		if (chatgpt) {
			connections.push({
				id: "chatgpt",
				provider: "chatgpt",
				state: "Connected",
				models: CHATGPT_MODELS,
			});
		}
		return { connections, defaultPair };
	}

	async importChatGPT(accountId: string, credential: unknown): Promise<boolean> {
		const imported = signIn(credential);
		if (!imported) return false;
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
		if (!(await this.ctx.storage.get("defaultPair"))) {
			await this.ctx.storage.put("defaultPair", {
				connectionId: "chatgpt",
				model: CHATGPT_MODELS[0],
			});
		}
		return true;
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
		const { connections } = await this.view();
		const connection = connections.find((each) => each.id === pair.connectionId);
		if (!connection?.models.includes(pair.model)) return false;
		await this.ctx.storage.put("defaultPair", {
			connectionId: pair.connectionId,
			model: pair.model,
		});
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
		const key = await open(
			this.env.CREDENTIALS_ENCRYPTION_KEY,
			opencode.key,
			`${accountId}:opencode`,
		);
		return {
			pair: { connectionId: wanted.connectionId, model: wanted.model },
			credential: { type: "api_key", key },
		};
	}

	async stored(): Promise<Record<string, unknown>> {
		return Object.fromEntries(await this.ctx.storage.list());
	}

	/** Hands out the access token alone: the refresh token never leaves this object. */
	async #grantChatGPT(accountId: string, wanted: Pair): Promise<Grant> {
		const chatgpt = await this.ctx.storage.get<StoredChatGPT>("connection:chatgpt");
		if (!chatgpt || !CHATGPT_MODELS.includes(wanted.model)) return { refused: "no-model" };
		const opened = await open(
			this.env.CREDENTIALS_ENCRYPTION_KEY,
			chatgpt.signIn,
			`${accountId}:chatgpt`,
		);
		const { access } = JSON.parse(opened) as SignIn;
		return {
			pair: { connectionId: wanted.connectionId, model: wanted.model },
			credential: { type: "api_key", key: access },
		};
	}
}
