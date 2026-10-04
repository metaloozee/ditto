import type { Context } from "@earendil-works/chord";
import {
	awaitWithContext,
	BACKGROUND_CONTEXT,
	withAbortSignal,
} from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
	fauxAssistantMessage,
	fauxProvider,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import {
	createRegistry,
	defineExtension,
	defineTool,
} from "@earendil-works/pi-durable";
import { Type } from "typebox";

export function pendingRemote<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	let settled = false;
	const observed: ("resolved" | "rejected")[] = [];
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	void promise.then(
		() => {
			settled = true;
			observed.push("resolved");
		},
		() => {
			settled = true;
			observed.push("rejected");
		},
	);
	return {
		promise,
		resolve,
		reject,
		observed,
		get settled() {
			return settled;
		},
	};
}

export type FixturePhase = "request" | "stream" | "tool" | "retry";

/** Synthetic remote work ignores cancellation. Only these adapter-local waits cooperate. */
export function cooperativeFixture(
	phase: FixturePhase,
	admit: (
		kind: "model" | "tool",
		id: string,
		context: Context,
	) => void | string | Promise<string | void>,
	result: (
		effect: string,
		context: Context,
		evidence: string,
	) => Promise<void> = async () => {},
) {
	const remote = pendingRemote<void>();
	const entered = pendingRemote<void>();
	const localEnded = pendingRemote<void>();
	const faux = fauxProvider({ tokensPerSecond: 0 });
	let providerCalls = 0;
	let executionCalls = 0;
	let providerAttempts = 0;
	let executionAttempts = 0;
	let signal: AbortSignal | undefined;
	const local = async (context: Context) => {
		signal = context.abortSignal;
		entered.resolve();
		try {
			await awaitWithContext(remote.promise, context);
			context.abortSignal?.throwIfAborted();
		} finally {
			localEnded.resolve();
		}
	};
	const stream: typeof faux.provider.stream = (_model, _context, options) => {
		const events = createAssistantMessageEventStream();
		const context = options?.signal
			? withAbortSignal(options.signal, BACKGROUND_CONTEXT)
			: BACKGROUND_CONTEXT;
		void (async () => {
			try {
				context.abortSignal?.throwIfAborted();
				providerAttempts++;
				const effect = await admit(
					"model",
					`model-${providerCalls + 1}`,
					context,
				);
				context.abortSignal?.throwIfAborted();
				providerCalls++;
				signal = context.abortSignal;
				if (phase === "retry") {
					const error = fauxAssistantMessage([], {
						stopReason: "error",
						errorMessage: "503 Synthetic unavailable",
						timestamp: 1,
					});
					if (effect) await result(effect, context, JSON.stringify(error));
					events.push({ type: "error", reason: "error", error });
					entered.resolve();
					return;
				}
				if (phase === "request") await local(context);
				if (phase === "stream") {
					const partial = fauxAssistantMessage("Synthetic partial", {
						timestamp: 1,
					});
					events.push({
						type: "text_delta",
						contentIndex: 0,
						delta: "Synthetic partial",
						partial,
					});
					await local(context);
				}
				context.abortSignal?.throwIfAborted();
				const message = fauxAssistantMessage(
					[
						fauxToolCall("cooperative_remote", {}, { id: "shell-original" }),
						fauxToolCall(
							"cooperative_remote",
							{},
							{ id: "shell-never-admitted" },
						),
					],
					{ stopReason: "toolUse", timestamp: 2 },
				);
				if (effect) await result(effect, context, JSON.stringify(message));
				context.abortSignal?.throwIfAborted();
				events.push({ type: "done", reason: "toolUse", message });
			} catch (error) {
				const message = fauxAssistantMessage([], {
					stopReason: context.abortSignal?.aborted ? "aborted" : "error",
					errorMessage:
						error instanceof Error ? error.message : "Fixture error",
					timestamp: 3,
				});
				events.push({
					type: "error",
					reason: message.stopReason === "aborted" ? "aborted" : "error",
					error: message,
				});
			} finally {
				events.end();
			}
		})();
		return events;
	};
	const models = createModels({
		authContext: { env: async () => undefined, fileExists: async () => false },
	});
	models.setProvider({
		id: faux.provider.id,
		name: faux.provider.name,
		auth: faux.provider.auth,
		getModels: () => faux.provider.getModels(),
		stream,
		streamSimple: stream,
	});
	const tool = defineTool({
		name: "cooperative_remote",
		description: "Await a synthetic remote shell, never execute locally.",
		parameters: Type.Object({}),
		replay: "unsafe",
		executionMode: "sequential",
		execute: async (_args, api, context) => {
			context.abortSignal?.throwIfAborted();
			executionAttempts++;
			const effect = await admit(
				"tool",
				`${api.taskId}:${api.callId}`,
				context,
			);
			context.abortSignal?.throwIfAborted();
			executionCalls++;
			await local(context);
			const value = {
				content: [{ type: "text" as const, text: "Synthetic remote result" }],
			};
			if (effect) await result(effect, context, JSON.stringify(value));
			context.abortSignal?.throwIfAborted();
			return value;
		},
	});
	const extension = defineExtension({
		name: "ditto-l1-cooperative",
		tools: [tool],
	});
	const registry = createRegistry();
	registry.install(extension);
	return {
		models,
		registry,
		extension,
		tool,
		remote,
		entered,
		localEnded,
		get signal() {
			return signal;
		},
		get providerCalls() {
			return providerCalls;
		},
		get executionCalls() {
			return executionCalls;
		},
		get providerAttempts() {
			return providerAttempts;
		},
		get executionAttempts() {
			return executionAttempts;
		},
	};
}
