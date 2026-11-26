import { DurableObject } from "cloudflare:workers";

import type { Bot } from "./bot.ts";
import type { ConnectRefusal, CredentialsRpc, Grant, ModelAccessView } from "./credentials-rpc.ts";
import type { AuthEnv } from "./lib/auth.ts";
import { type ConnectionState, OPENCODE_MODELS, type Pair } from "./lib/model-access.ts";

const OPENCODE = "https://opencode.ai/inference/openai/v1";

/** Probes of an unavailable provider start this far apart and double, up to `PROBE_MAX_MS`. */
const PROBE_FIRST_MS = 10_000;
const PROBE_MAX_MS = 10 * 60_000;

/** An encrypted value: AES-GCM under the stage's key, bound to the account and provider. */
interface Sealed {
	iv: string;
	data: string;
}

interface StoredConnection {
	provider: "opencode";
	key: Sealed;
	connectedAt: string;
	/** Absent while Connected. */
	state?: "Unavailable" | "ReconnectNeeded";
	/** While Unavailable: what the next probe asks, and how many came before it. */
	probe?: { accountId: string; model: string; attempt: number };
	/** Object IDs of the Bots whose turn stopped on this connection, resumed once it is usable. */
	waiting?: string[];
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
 * One per Ditto account, holding its model connections. The only reader of their keys: a key
 * enters once, when the owner connects it, and leaves only in a grant to a Bot for one call,
 * never in an answer to the owner.
 */
export class Credentials extends DurableObject<AuthEnv> implements CredentialsRpc {
	override fetch(): Response {
		return Response.json({ object: "Credentials" });
	}

	async view(): Promise<ModelAccessView> {
		const opencode = await this.ctx.storage.get<StoredConnection>("connection:opencode");
		const defaultPair = (await this.ctx.storage.get<Pair>("defaultPair")) ?? null;
		return {
			connections: opencode
				? [
						{
							id: "opencode",
							provider: "opencode",
							state: opencode.state ?? "Connected",
							models: OPENCODE_MODELS,
						},
					]
				: [],
			defaultPair,
		};
	}

	async connectOpenCode(
		accountId: string,
		key: string,
		model: string,
	): Promise<{ connected: true } | { refused: ConnectRefusal }> {
		if (!OPENCODE_MODELS.includes(model)) return { refused: "unknown-model" };
		const refused = await checkOpenCodeKey(this.env.OPENCODE_BASE_URL ?? OPENCODE, key, model);
		if (refused) return { refused };
		const replaced = await this.ctx.storage.get<StoredConnection>("connection:opencode");
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
		// A reconnect carries on whatever the old key left interrupted.
		if (replaced?.probe) await this.ctx.storage.deleteAlarm();
		this.#resume(accountId, replaced?.waiting ?? []);
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
		const opencode = await this.ctx.storage.get<StoredConnection>("connection:opencode");
		if (
			wanted?.connectionId !== "opencode" ||
			!opencode ||
			opencode.state ||
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

	async interrupted(
		accountId: string,
		pair: Pair,
		bot: string,
		state: "Unavailable" | "ReconnectNeeded",
	): Promise<void> {
		const connection = await this.ctx.storage.get<StoredConnection>("connection:opencode");
		if (pair.connectionId !== "opencode" || !connection) return;
		const waiting = [...new Set([...(connection.waiting ?? []), bot])];
		// Revocation outranks an outage: a key the provider refused is never sent again.
		if (state === "ReconnectNeeded" || connection.state === "ReconnectNeeded") {
			await this.ctx.storage.put("connection:opencode", {
				...connection,
				state: "ReconnectNeeded",
				probe: undefined,
				waiting,
			} satisfies StoredConnection);
			await this.ctx.storage.deleteAlarm();
			return;
		}
		await this.ctx.storage.put("connection:opencode", {
			...connection,
			state: "Unavailable",
			probe: connection.probe ?? { accountId, model: pair.model, attempt: 0 },
			waiting,
		} satisfies StoredConnection);
		if (!connection.probe) await this.ctx.storage.setAlarm(Date.now() + PROBE_FIRST_MS);
	}

	async check(accountId: string, connectionId: string): Promise<ConnectionState | null> {
		const connection = await this.ctx.storage.get<StoredConnection>("connection:opencode");
		if (connectionId !== "opencode" || !connection) return null;
		if (connection.state !== "Unavailable") return connection.state ?? "Connected";
		return this.#probe(accountId);
	}

	/** The next backoff probe of an unavailable connection. */
	override async alarm(): Promise<void> {
		const connection = await this.ctx.storage.get<StoredConnection>("connection:opencode");
		if (connection?.state === "Unavailable" && connection.probe) {
			await this.#probe(connection.probe.accountId);
		}
	}

	async stored(): Promise<Record<string, unknown>> {
		return Object.fromEntries(await this.ctx.storage.list());
	}

	/**
	 * Asks the provider once whether it answers again. Recovery resumes the waiting bots, a
	 * refused key needs the owner, and anything else schedules the next probe further out.
	 */
	async #probe(accountId: string): Promise<ConnectionState> {
		const before = await this.ctx.storage.get<StoredConnection>("connection:opencode");
		if (!before?.probe) return before?.state ?? "Connected";
		const key = await open(
			this.env.CREDENTIALS_ENCRYPTION_KEY,
			before.key,
			`${accountId}:opencode`,
		);
		const refused = await checkOpenCodeKey(
			this.env.OPENCODE_BASE_URL ?? OPENCODE,
			key,
			before.probe.model,
		);
		// Re-read: a reconnect or another failure may have landed while the probe was out.
		const connection = await this.ctx.storage.get<StoredConnection>("connection:opencode");
		if (connection?.state !== "Unavailable" || !connection.probe) {
			return connection?.state ?? "Connected";
		}
		if (refused === "unavailable") {
			const attempt = connection.probe.attempt + 1;
			await this.ctx.storage.put("connection:opencode", {
				...connection,
				probe: { ...connection.probe, attempt },
			} satisfies StoredConnection);
			await this.ctx.storage.setAlarm(
				Date.now() + Math.min(PROBE_FIRST_MS * 2 ** attempt, PROBE_MAX_MS),
			);
			return "Unavailable";
		}
		await this.ctx.storage.deleteAlarm();
		if (refused === "rejected") {
			await this.ctx.storage.put("connection:opencode", {
				...connection,
				state: "ReconnectNeeded",
				probe: undefined,
			} satisfies StoredConnection);
			return "ReconnectNeeded";
		}
		const { state: _, probe: __, waiting = [], ...healthy } = connection;
		await this.ctx.storage.put("connection:opencode", healthy satisfies StoredConnection);
		this.#resume(accountId, waiting);
		return "Connected";
	}

	/** Tells each bot its connection answers again. Not awaited: a bot's turn is its own. */
	#resume(accountId: string, bots: readonly string[]) {
		const namespace = this.env.BOT as unknown as DurableObjectNamespace<Bot>;
		for (const bot of bots) {
			this.ctx.waitUntil(
				namespace
					.get(namespace.idFromString(bot))
					.resume(accountId)
					.catch((error: unknown) => console.error("A bot didn't resume:", error)),
			);
		}
	}
}
