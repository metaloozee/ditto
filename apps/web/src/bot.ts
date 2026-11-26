import { createModels, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { opencodeProvider } from "@earendil-works/pi-ai/providers/opencode";
import { DurableObject } from "cloudflare:workers";

import type { BotRpc, Turn, TurnEvent, TurnRefusal, TurnStatus } from "./bot-rpc.ts";
import type { CredentialsRpc, Grant } from "./credentials-rpc.ts";
import type { Credentials } from "./credentials.ts";
import type { AuthEnv } from "./lib/auth.ts";

type Granted = Exclude<Grant, { refused: unknown }>;

const encoder = new TextEncoder();

/**
 * One per bot, running its turns through the pinned Pi runtime. Holds no credential: each turn
 * asks the account's Credentials object for the one its call needs, and drops it afterwards.
 */
export class Bot extends DurableObject<AuthEnv> implements BotRpc {
	#running: { id: string; controller: AbortController } | null = null;

	override fetch(): Response {
		return Response.json({ object: "Bot" });
	}

	async send(
		accountId: string,
		message: string,
	): Promise<{ stream: ReadableStream<Uint8Array> } | { refused: TurnRefusal }> {
		if (this.#running) return { refused: "busy" };
		// Claimed before the first await, so a second send can't start beside this one.
		const running = { id: crypto.randomUUID(), controller: new AbortController() };
		this.#running = running;
		const grant = await this.#credentials(accountId).grant(accountId, null);
		if ("refused" in grant) {
			this.#running = null;
			return { refused: grant.refused };
		}
		const turn: Turn = {
			id: running.id,
			pair: grant.pair,
			message,
			reply: "",
			status: "running",
			startedAt: new Date().toISOString(),
		};
		await this.ctx.storage.put(`turn:${turn.id}`, turn);

		const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
		const writer = writable.getWriter();
		// Never awaited: a reader that went away must not hold up the turn or its record.
		const emit = (event: TurnEvent) => {
			writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)).catch(() => {});
		};
		emit({ type: "start", turnId: turn.id, pair: turn.pair });
		void this.#run(accountId, turn, grant, running.controller.signal, emit).finally(() => {
			if (this.#running === running) this.#running = null;
			writer.close().catch(() => {});
		});
		return { stream: readable };
	}

	stop(): boolean {
		if (!this.#running) return false;
		this.#running.controller.abort();
		return true;
	}

	async turn(turnId: string): Promise<Turn | null> {
		return (await this.ctx.storage.get<Turn>(`turn:${turnId}`)) ?? null;
	}

	async resume(accountId: string): Promise<void> {
		if (this.#running) return;
		const turns = await this.ctx.storage.list<Turn>({ prefix: "turn:" });
		const turn = [...turns.values()].find((each) => each.status === "interrupted");
		if (!turn) return;
		const running = { id: turn.id, controller: new AbortController() };
		this.#running = running;
		// The pair it started with, never the default: a failure doesn't move a turn.
		const grant = await this.#credentials(accountId).grant(accountId, turn.pair);
		if ("refused" in grant) {
			this.#running = null;
			return;
		}
		delete turn.interruption;
		Object.assign(turn, { status: "running", reply: "" });
		await this.ctx.storage.put(`turn:${turn.id}`, turn);
		// Nobody reads a resumed turn's stream: the owner sees it through its record.
		this.ctx.waitUntil(
			this.#run(accountId, turn, grant, running.controller.signal, () => {}).finally(() => {
				if (this.#running === running) this.#running = null;
			}),
		);
	}

	async stored(): Promise<Record<string, unknown>> {
		return Object.fromEntries(await this.ctx.storage.list());
	}

	/**
	 * The account's Credentials object. Workers types keep only `fetch` on a stub whose shape
	 * lacks their brand, so the RPC surface is restored here.
	 */
	#credentials(accountId: string): CredentialsRpc {
		const namespace = this.env.CREDENTIALS as unknown as DurableObjectNamespace<Credentials>;
		return namespace.getByName(accountId);
	}

	async #run(
		accountId: string,
		turn: Turn,
		grant: Granted,
		signal: AbortSignal,
		emit: (event: TurnEvent) => void,
	) {
		let status: Exclude<TurnStatus, "running">;
		// What the provider last answered, so a failure can say whether to wait or reconnect.
		let answered: number | "unreachable" | undefined;
		const observed: typeof fetch = async (input, init) => {
			try {
				const response = await fetch(input, init);
				answered = response.status;
				return response;
			} catch (error) {
				if (!signal.aborted) answered = "unreachable";
				throw error;
			}
		};
		try {
			const credentials = new InMemoryCredentialStore();
			await credentials.modify("opencode", async () => grant.credential);
			const models = createModels({
				credentials,
				// No ambient env or files: the call uses only the credential it was granted.
				authContext: { env: async () => undefined, fileExists: async () => false },
			});
			models.setProvider(opencodeProvider());
			const catalogued = models.getModel("opencode", turn.pair.model);
			if (!catalogued) throw new Error(`Pi has no OpenCode model ${turn.pair.model}`);
			const model = { ...catalogued, baseUrl: this.env.OPENCODE_BASE_URL ?? catalogued.baseUrl };
			const events = models.stream(
				model,
				{ messages: [{ role: "user", content: turn.message, timestamp: Date.now() }] },
				// One request per attempt: the Credentials object backs off, not Pi.
				{ signal, fetch: observed, maxRetries: 0 },
			);
			for await (const event of events) {
				if (event.type !== "text_delta") continue;
				turn.reply += event.delta;
				emit({ type: "delta", text: event.delta });
			}
			const reply = await events.result();
			status = signal.aborted
				? "stopped"
				: reply.stopReason === "error" || reply.stopReason === "aborted"
					? "failed"
					: "completed";
			if (status === "failed") console.error("A turn failed:", reply.errorMessage);
		} catch (error) {
			status = signal.aborted ? "stopped" : "failed";
			if (status === "failed") console.error("A turn failed:", error);
		}
		const interruption = status === "failed" ? interruptionOf(answered) : undefined;
		if (interruption) {
			Object.assign(turn, { status: "interrupted", interruption });
			await this.ctx.storage.put(`turn:${turn.id}`, turn);
			await this.#credentials(accountId).interrupted(
				accountId,
				turn.pair,
				this.ctx.id.toString(),
				interruption,
			);
			emit({ type: "end", status: "interrupted", interruption });
			return;
		}
		Object.assign(turn, { status, endedAt: new Date().toISOString() });
		await this.ctx.storage.put(`turn:${turn.id}`, turn);
		emit({ type: "end", status });
	}
}

/** A refused credential needs the owner; an outage passes. Other failures just end the turn. */
function interruptionOf(
	answered: number | "unreachable" | undefined,
): "Unavailable" | "ReconnectNeeded" | undefined {
	if (answered === 401 || answered === 403) return "ReconnectNeeded";
	if (answered === "unreachable" || (typeof answered === "number" && answered >= 500)) {
		return "Unavailable";
	}
	return undefined;
}
