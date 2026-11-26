import { createModels, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { opencodeProvider } from "@earendil-works/pi-ai/providers/opencode";
import { DurableObject } from "cloudflare:workers";

import type { BotRpc, Turn, TurnEvent, TurnRefusal, TurnStatus } from "./bot-rpc.ts";
import type { CredentialsRpc, Grant } from "./credentials-rpc.ts";
import type { Credentials } from "./credentials.ts";
import type { AuthEnv } from "./lib/auth.ts";
import type { Pair } from "./lib/model-access.ts";

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
		// The pair is resolved once, here: a change to it from now on reaches only the next turn.
		const override = (await this.ctx.storage.get<Pair>("override")) ?? null;
		const grant = await this.#credentials(accountId).grant(accountId, override);
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
		void this.#run(turn, grant, running.controller.signal, emit).finally(() => {
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

	async override(): Promise<Pair | null> {
		return (await this.ctx.storage.get<Pair>("override")) ?? null;
	}

	async chooseOverride(accountId: string, pair: Pair | null): Promise<boolean> {
		if (pair === null) {
			await this.ctx.storage.delete("override");
			return true;
		}
		const { connections } = await this.#credentials(accountId).view();
		const connection = connections.find((each) => each.id === pair.connectionId);
		if (!connection?.models.includes(pair.model)) return false;
		await this.ctx.storage.put("override", { connectionId: pair.connectionId, model: pair.model });
		return true;
	}

	async stored(): Promise<Record<string, unknown>> {
		return Object.fromEntries(await this.ctx.storage.list());
	}

	evict(): void {
		this.ctx.abort("evicted by the test stage");
	}

	/**
	 * The account's Credentials object. Workers types keep only `fetch` on a stub whose shape
	 * lacks their brand, so the RPC surface is restored here.
	 */
	#credentials(accountId: string): CredentialsRpc {
		const namespace = this.env.CREDENTIALS as unknown as DurableObjectNamespace<Credentials>;
		return namespace.getByName(accountId);
	}

	async #run(turn: Turn, grant: Granted, signal: AbortSignal, emit: (event: TurnEvent) => void) {
		let status: Exclude<TurnStatus, "running">;
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
				{ signal },
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
		Object.assign(turn, { status, endedAt: new Date().toISOString() });
		await this.ctx.storage.put(`turn:${turn.id}`, turn);
		emit({ type: "end", status });
	}
}
