import { createModels, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { opencodeProvider } from "@earendil-works/pi-ai/providers/opencode";
import { DurableObject } from "cloudflare:workers";

import type { BotRpc, Turn, TurnEvent, TurnRefusal, TurnStatus } from "./bot-rpc.ts";
import type { CredentialsRpc, Grant } from "./credentials-rpc.ts";
import type { Credentials } from "./credentials.ts";
import type { AuthEnv } from "./lib/auth.ts";

type Granted = Exclude<Grant, { refused: unknown }>;

const encoder = new TextEncoder();

/** The bot's instructions, sent with every turn until bots carry their own. */
const INSTRUCTIONS = "You are Ditto, the owner's Chief of Staff. Reply plainly and briefly.";

const OPENAI = "https://api.openai.com/";

/**
 * Sends api.openai.com requests to the test stage's fake upstream, as `${upstream}/<host>/<path>`,
 * passed to Pi for one call rather than patched into the global fetch. Undefined off the test stage.
 */
function openaiUpstream(upstream: string | undefined): typeof fetch | undefined {
	if (!upstream) return undefined;
	return (input, init) => {
		const request = new Request(input, init);
		if (!request.url.startsWith(OPENAI)) return fetch(request);
		return fetch(
			new Request(`${upstream}/api.openai.com/${request.url.slice(OPENAI.length)}`, request),
		);
	};
}

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

	async #run(turn: Turn, grant: Granted, signal: AbortSignal, emit: (event: TurnEvent) => void) {
		let status: Exclude<TurnStatus, "running">;
		try {
			// A ChatGPT plan pair runs on Pi's `openai` provider against the plan-usage Responses
			// endpoint, never the Codex backend. Its grant is the access token alone, which Pi sends
			// as a bearer token exactly as it would an OAuth credential's.
			const chatgpt = turn.pair.connectionId === "chatgpt";
			const provider = chatgpt ? "openai" : "opencode";
			const credentials = new InMemoryCredentialStore();
			await credentials.modify(provider, async () => grant.credential);
			const models = createModels({
				credentials,
				// No ambient env or files: the call uses only the credential it was granted.
				authContext: { env: async () => undefined, fileExists: async () => false },
			});
			models.setProvider(chatgpt ? openaiProvider() : opencodeProvider());
			const catalogued = models.getModel(provider, turn.pair.model);
			if (!catalogued) throw new Error(`Pi has no ${provider} model ${turn.pair.model}`);
			// Pi drops the fields the plan-usage flow rejects only for api.openai.com itself, so that
			// base URL stays as catalogued and the test stage reroutes through `fetch` instead.
			const model = chatgpt
				? catalogued
				: { ...catalogued, baseUrl: this.env.OPENCODE_BASE_URL ?? catalogued.baseUrl };
			const events = models.stream(
				model,
				{
					systemPrompt: INSTRUCTIONS,
					messages: [{ role: "user", content: turn.message, timestamp: Date.now() }],
				},
				{ signal, fetch: chatgpt ? openaiUpstream(this.env.OAUTH_UPSTREAM) : undefined },
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
