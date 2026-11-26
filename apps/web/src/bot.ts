import {
	type AssistantMessage,
	type Context,
	createModels,
	InMemoryCredentialStore,
	type Tool,
	type ToolResultMessage,
} from "@earendil-works/pi-ai";
import { CLOUDFLARE_GATEWAY_BINDING_AUTH_SENTINEL } from "@earendil-works/pi-ai/api/cloudflare-ai-binding";
import { cloudflareWorkersAIProvider } from "@earendil-works/pi-ai/providers/cloudflare-workers-ai";
import { opencodeProvider } from "@earendil-works/pi-ai/providers/opencode";
import { DurableObject } from "cloudflare:workers";

import type {
	BotRpc,
	Pending,
	Queued,
	Turn,
	TurnEvent,
	TurnRefusal,
	TurnStatus,
} from "./bot-rpc.ts";
import type { CredentialsRpc, Fault, Grant } from "./credentials-rpc.ts";
import type { Credentials } from "./credentials.ts";
import type { AuthEnv } from "./lib/auth.ts";
import { INCLUDED, type Pair } from "./lib/model-access.ts";
import { faultOf } from "./lib/provider-fault.ts";

type Granted = Exclude<Grant, { refused: unknown }>;
type Ended = Exclude<TurnStatus, "running">;

const encoder = new TextEncoder();

/** The tools a bot's model may call, as the model sees them. */
const TOOLS: Tool[] = [
	{
		name: "current_time",
		description: "Returns the current date and time in UTC, as ISO 8601. Takes no arguments.",
		parameters: { type: "object", properties: {}, additionalProperties: false },
	},
];

/** What each tool does, run by the Bot itself. */
const RUN: Record<string, () => string> = {
	current_time: () => new Date().toISOString(),
};

/** The most model replies one turn may take, so a model that keeps calling tools still ends. */
const TOOL_ROUNDS = 8;

/** The result of one tool call in a reply, for the model's next round. */
function toolResult(block: AssistantMessage["content"][number]): ToolResultMessage[] {
	if (block.type !== "toolCall") return [];
	const run = RUN[block.name];
	return [
		{
			role: "toolResult",
			toolCallId: block.id,
			toolName: block.name,
			content: [{ type: "text", text: run ? run() : `No tool is named ${block.name}` }],
			isError: !run,
			timestamp: Date.now(),
		},
	];
}
/** The most turns one `pending` call reads, within storage's limit on one `get`. */
const PENDING_LIMIT = 100;

/**
 * One per bot, running its turns through the pinned Pi runtime. Holds no credential: each turn
 * asks the account's Credentials object for the one its call needs, and drops it afterwards.
 *
 * A turn its connection interrupts stays stored as `unfinished`, with its pair and the reply so
 * far, and messages sent meanwhile wait in `queue`. Once Credentials sees the connection answer
 * again, `recover` resumes that turn on its own pair and then runs the queue in order.
 */
export class Bot extends DurableObject<AuthEnv> implements BotRpc {
	#running: { id: string; controller: AbortController } | null = null;
	/** Set while the bot resumes its unfinished turn and runs its queue. */
	#draining = false;
	/** A recovery that arrived while a live turn ran, started once it ends. */
	#recoverAfter: string | null = null;

	override fetch(): Response {
		return Response.json({ object: "Bot" });
	}

	async send(
		accountId: string,
		message: string,
	): Promise<
		{ stream: ReadableStream<Uint8Array> } | { queued: string } | { refused: TurnRefusal }
	> {
		// Storage reads hold other calls back, so a second send can't slip in before the claim.
		if (this.#draining || (await this.#waiting())) return this.#enqueue(accountId, message);
		if (this.#running) return { refused: "busy" };
		// Claimed before the first call out, so a second send can't start beside this one.
		const running = { id: crypto.randomUUID(), controller: new AbortController() };
		this.#running = running;
		// The pair is resolved once, here: a change to it from now on reaches only the next turn.
		const override = (await this.ctx.storage.get<Pair>("override")) ?? null;
		const grant = await this.#credentials(accountId).grant(accountId, override);
		if ("refused" in grant) {
			this.#running = null;
			if (grant.refused === "no-model") return { refused: "no-model" };
			return this.#enqueue(accountId, message);
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
			const recovering = this.#recoverAfter;
			this.#recoverAfter = null;
			if (recovering) void this.recover(recovering);
		});
		return { stream: readable };
	}

	async recover(accountId: string): Promise<void> {
		if (this.#draining) return;
		if (this.#running) {
			this.#recoverAfter = accountId;
			return;
		}
		this.#draining = true;
		try {
			await this.#drain(accountId);
		} finally {
			this.#draining = false;
		}
	}

	async pending(ids: string[]): Promise<Pending> {
		const names = ids.slice(0, PENDING_LIMIT).map((id) => `turn:${id}`);
		const unfinished = (await this.ctx.storage.get<string>("unfinished")) ?? null;
		if (unfinished && !names.includes(`turn:${unfinished}`)) names.push(`turn:${unfinished}`);
		const turns = await this.ctx.storage.get<Turn>(names);
		return {
			turns: [...turns.values()],
			unfinished,
			queue: (await this.ctx.storage.get<Queued[]>("queue")) ?? [],
		};
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
		const { connections, included } = await this.#credentials(accountId).view();
		const connection = connections.find((each) => each.id === pair.connectionId);
		const offered =
			pair.connectionId === INCLUDED
				? pair.model === included
				: Boolean(connection?.models.includes(pair.model));
		if (!offered) return false;
		await this.ctx.storage.put("override", { connectionId: pair.connectionId, model: pair.model });
		return true;
	}

	async stored(): Promise<Record<string, unknown>> {
		return Object.fromEntries(await this.ctx.storage.list());
	}

	evict(): void {
		this.ctx.abort("evicted by the test stage");
	}

	/** This bot's ID: the name its object was reached by. */
	get #botId(): string {
		return this.ctx.id.name ?? this.ctx.id.toString();
	}

	/**
	 * The account's Credentials object. Workers types keep only `fetch` on a stub whose shape
	 * lacks their brand, so the RPC surface is restored here.
	 */
	#credentials(accountId: string): CredentialsRpc {
		const namespace = this.env.CREDENTIALS as unknown as DurableObjectNamespace<Credentials>;
		return namespace.getByName(accountId);
	}

	/** Pi set up for the granted pair, holding only what the grant gave it. */
	async #model(accountId: string, grant: Granted) {
		const credentials = new InMemoryCredentialStore();
		const models = createModels({
			credentials,
			// No ambient env or files: the call uses only the credential it was granted.
			authContext: { env: async () => undefined, fileExists: async () => false },
		});
		if ("included" in grant) {
			// Pi wants a Cloudflare key and account before it sends. Neither is sent: each request
			// goes to the account's Credentials object, which adds what the gateway needs.
			await credentials.modify("cloudflare-workers-ai", async () => ({
				type: "api_key",
				key: CLOUDFLARE_GATEWAY_BINDING_AUTH_SENTINEL,
				env: { CLOUDFLARE_ACCOUNT_ID: "binding" },
			}));
			models.setProvider(cloudflareWorkersAIProvider());
			const model = models.getModel("cloudflare-workers-ai", grant.included);
			if (!model) throw new Error(`Pi has no Workers AI model ${grant.included}`);
			const through = this.#credentials(accountId);
			const fetch: typeof globalThis.fetch = async (_url, init) =>
				through.included(accountId, typeof init?.body === "string" ? init.body : "");
			return { models, model, fetch };
		}
		await credentials.modify("opencode", async () => grant.credential);
		models.setProvider(opencodeProvider());
		const catalogued = models.getModel("opencode", grant.pair.model);
		if (!catalogued) throw new Error(`Pi has no OpenCode model ${grant.pair.model}`);
		const model = { ...catalogued, baseUrl: this.env.OPENCODE_BASE_URL ?? catalogued.baseUrl };
		return { models, model, fetch: undefined };
	}

	/** Whether earlier work still waits: an unfinished turn, or anything queued. */
	async #waiting(): Promise<boolean> {
		const stored = await this.ctx.storage.get<unknown>(["unfinished", "queue"]);
		const queue = stored.get("queue") as Queued[] | undefined;
		return stored.has("unfinished") || Boolean(queue?.length);
	}

	/**
	 * Queues `message` behind the waiting work, then tries to recover: that registers the bot
	 * with Credentials if the connection is still in trouble, and runs the work if it isn't.
	 */
	async #enqueue(accountId: string, message: string): Promise<{ queued: string }> {
		const queued: Queued = { id: crypto.randomUUID(), message, queuedAt: new Date().toISOString() };
		const queue = (await this.ctx.storage.get<Queued[]>("queue")) ?? [];
		await this.ctx.storage.put("queue", [...queue, queued]);
		void this.recover(accountId);
		return { queued: queued.id };
	}

	/**
	 * Resumes the unfinished turn on its own pair, then starts each queued message as a turn on
	 * the pair the bot uses now, in order. Stops at the first turn its connection interrupts.
	 */
	async #drain(accountId: string): Promise<void> {
		const credentials = this.#credentials(accountId);
		for (;;) {
			const unfinishedId = await this.ctx.storage.get<string>("unfinished");
			const unfinished = unfinishedId
				? await this.ctx.storage.get<Turn>(`turn:${unfinishedId}`)
				: undefined;
			const next = unfinished ? undefined : (await this.ctx.storage.get<Queued[]>("queue"))?.[0];
			if (!unfinished && !next) return;

			// An unfinished turn keeps its pair; a queued message takes the pair the bot uses now.
			const pair = unfinished?.pair ?? (await this.ctx.storage.get<Pair>("override")) ?? null;
			const grant = await credentials.grant(accountId, pair);
			if ("refused" in grant) {
				// Still in trouble: Credentials wakes the bot again. Without a model, the work waits.
				if (grant.refused === "interrupted") {
					await credentials.interrupted(accountId, this.#botId, grant.pair);
				}
				return;
			}
			let turn: Turn;
			if (unfinished) {
				turn = { ...unfinished, status: "running" };
				await this.ctx.storage.put(`turn:${turn.id}`, turn);
			} else if (next) {
				turn = {
					id: next.id,
					pair: grant.pair,
					message: next.message,
					reply: "",
					status: "running",
					startedAt: new Date().toISOString(),
				};
				// Read again: a message may have been queued while the grant was out.
				const queue = (await this.ctx.storage.get<Queued[]>("queue")) ?? [];
				await this.ctx.storage.put({
					[`turn:${turn.id}`]: turn,
					unfinished: turn.id,
					queue: queue.filter((queued) => queued.id !== next.id),
				});
			} else return;

			const running = { id: turn.id, controller: new AbortController() };
			this.#running = running;
			try {
				const status = await this.#run(accountId, turn, grant, running.controller.signal, () => {});
				if (status === "interrupted") return;
			} finally {
				if (this.#running === running) this.#running = null;
			}
		}
	}

	/**
	 * Runs `turn` on its granted pair, continuing from the reply so far when it resumes. Saves
	 * the reply as it streams, so an interruption or an eviction keeps it.
	 */
	async #run(
		accountId: string,
		turn: Turn,
		grant: Granted,
		signal: AbortSignal,
		emit: (event: TurnEvent) => void,
	): Promise<Ended> {
		let status: Ended;
		let fault: Fault | null = null;
		// The provider's last answer, which says whether a failed call met a limit.
		const seen: { answer: Response | null } = { answer: null };
		try {
			const route = await this.#model(accountId, grant);
			const { models, model } = route;
			const observed = async (input: RequestInfo | URL, init?: RequestInit) => {
				const response = await (route.fetch ?? fetch)(input, init);
				seen.answer = response;
				return response;
			};
			const now = Date.now();
			const context: Context = {
				messages: [
					{ role: "user", content: turn.message, timestamp: now },
					// A resumed turn continues from what it already said.
					...(turn.reply
						? [
								{
									role: "assistant" as const,
									content: [{ type: "text" as const, text: turn.reply }],
									api: model.api,
									provider: model.provider,
									model: model.id,
									usage: {
										input: 0,
										output: 0,
										cacheRead: 0,
										cacheWrite: 0,
										totalTokens: 0,
										cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
									},
									stopReason: "stop" as const,
									timestamp: now,
								},
							]
						: []),
				],
				tools: TOOLS,
			};
			// Each round streams one reply; one that calls tools gets their results and goes again.
			let reply: AssistantMessage;
			for (let round = 1; ; round++) {
				const events = models.stream(model, context, { signal, fetch: observed });
				for await (const event of events) {
					if (event.type !== "text_delta") continue;
					turn.reply += event.delta;
					void this.ctx.storage.put(`turn:${turn.id}`, turn).catch(() => {});
					emit({ type: "delta", text: event.delta });
				}
				reply = await events.result();
				if (reply.stopReason !== "toolUse" || round === TOOL_ROUNDS) break;
				context.messages.push(reply, ...reply.content.flatMap(toolResult));
			}
			const errored = reply.stopReason === "error" || reply.stopReason === "aborted";
			// A connection's limit holds the turn for it; the included model has no connection to wait on.
			if (errored && !signal.aborted && !("included" in grant)) {
				fault = faultOf(seen.answer, reply.errorMessage);
			}
			status = signal.aborted
				? "stopped"
				: fault
					? "interrupted"
					: errored
						? "failed"
						: "completed";
			if (status === "failed") console.error("A turn failed:", reply.errorMessage);
		} catch (error) {
			if (!signal.aborted && !("included" in grant)) fault = faultOf(seen.answer, String(error));
			status = signal.aborted ? "stopped" : fault ? "interrupted" : "failed";
			if (status === "failed") console.error("A turn failed:", error);
		}
		if (fault) turn.interruption = fault.state;
		Object.assign(turn, { status, endedAt: new Date().toISOString() });
		await this.ctx.storage.put(`turn:${turn.id}`, turn);
		if (fault) {
			await this.ctx.storage.put("unfinished", turn.id);
			await this.#credentials(accountId).interrupted(accountId, this.#botId, turn.pair, fault);
		} else {
			await this.ctx.storage.delete("unfinished");
		}
		emit({ type: "end", status });
		return status;
	}
}
