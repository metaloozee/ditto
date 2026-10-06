import type { Context } from "@earendil-works/chord";
import {
	awaitWithContext,
	BACKGROUND_CONTEXT,
	withAbortSignal,
} from "@earendil-works/chord/context";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import {
	fauxAssistantMessage,
	fauxProvider,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import {
	CompactionTask,
	createRegistry,
	defineExtension,
	defineTool,
	GenerationTask,
	hook,
} from "@earendil-works/pi-durable";
import { Type } from "typebox";
import {
	type HostGuard,
	requestDigest,
	semanticTranscript,
	type ToolRequest,
} from "./pi-durable-host.ts";

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

export type FixturePhase = "request" | "stream" | "tool" | "retry" | "answer";

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
	guard?: HostGuard,
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
	let summary: "success" | "pending" | "error-once" = "success";
	let summaryErrorSent = false;
	let toolPolicy: Pick<ToolRequest, "operation" | "replay"> = {
		operation: { kind: "shell" },
		replay: "never",
	};
	const stream: typeof faux.provider.stream = (model, transcript, options) => {
		const events = createAssistantMessageEventStream();
		const context = options?.signal
			? withAbortSignal(options.signal, BACKGROUND_CONTEXT)
			: BACKGROUND_CONTEXT;
		void (async () => {
			try {
				context.abortSignal?.throwIfAborted();
				providerAttempts++;
				const start = async (): Promise<AssistantMessage> => {
					providerCalls++;
					signal = context.abortSignal;
					if (options?.maxTokens !== undefined) {
						if (summary === "pending") await local(context);
						if (summary === "error-once" && !summaryErrorSent) {
							summaryErrorSent = true;
							return fauxAssistantMessage([], {
								stopReason: "error",
								errorMessage: "503 Synthetic known summary error",
							});
						}
						return fauxAssistantMessage("Synthetic durable summary");
					}
					if (
						phase === "answer" ||
						(guard && phase === "tool" && providerCalls > 1)
					)
						return fauxAssistantMessage("Synthetic answer ".repeat(50));
					return produce();
				};
				const produce = async (): Promise<AssistantMessage> => {
					if (phase === "retry") {
						const error = fauxAssistantMessage([], {
							stopReason: "error",
							errorMessage: "503 Synthetic unavailable",
							timestamp: 1,
						});
						entered.resolve();
						return error;
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
					return message;
				};
				let effect: string | void;
				let message: AssistantMessage;
				if (guard) {
					const admitted = await guard.model(
						{
							model: { provider: model.provider, id: model.id },
							transcript,
							options: { ...options },
						},
						context,
						start,
					);
					effect = admitted.effect;
					message = await admitted.response;
				} else {
					effect = await admit("model", `model-${providerCalls + 1}`, context);
					context.abortSignal?.throwIfAborted();
					message = await start();
				}
				if (effect) await result(effect, context, JSON.stringify(message));
				context.abortSignal?.throwIfAborted();
				if (message.stopReason === "error")
					events.push({ type: "error", reason: "error", error: message });
				else
					events.push({
						type: "done",
						reason: message.stopReason === "toolUse" ? "toolUse" : "stop",
						message,
					});
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
		getModels: () =>
			faux.provider
				.getModels()
				.map((model) => (guard ? { ...model, contextWindow: 512 } : model)),
		stream,
		streamSimple: stream,
	});
	const tool = defineTool({
		name: "cooperative_remote",
		description: "Await a synthetic remote shell, never execute locally.",
		parameters: Type.Object({}),
		replay: "unsafe",
		executionMode: "sequential",
		execute: async (args, api, context) => {
			context.abortSignal?.throwIfAborted();
			executionAttempts++;
			const start = async () => {
				context.abortSignal?.throwIfAborted();
				executionCalls++;
				await local(context);
				return {
					content: [{ type: "text" as const, text: "Synthetic remote result" }],
				};
			};
			let effect: string | void;
			let value: import("@earendil-works/pi-durable").ToolExecutionResult;
			if (guard) {
				const admitted = await guard.tool(
					{
						task: api.taskId,
						conversation: Number(api.conversationId),
						call: api.callId,
						name: "cooperative_remote",
						arguments: { ...args },
						...toolPolicy,
					},
					context,
					start,
				);
				effect = admitted.effect;
				value = await admitted.response;
			} else {
				effect = await admit("tool", `${api.taskId}:${api.callId}`, context);
				context.abortSignal?.throwIfAborted();
				value = await start();
			}
			if (effect) await result(effect, context, JSON.stringify(value));
			context.abortSignal?.throwIfAborted();
			return value;
		},
	});
	const extension = defineExtension({
		name: "ditto-l1-cooperative",
		tools: [tool],
		hooks: guard
			? [
					hook(GenerationTask, {
						beforeRequest: async (request, api, context) => {
							await guard.bindGeneration(
								api,
								await requestDigest(
									semanticTranscript(
										normalizeContext({ messages: [...request.messages] }),
									),
								),
								context,
							);
							return undefined;
						},
					}),
					hook(CompactionTask, {
						beforeCompact: async (selection, api, context) => {
							await guard.bindCompaction(
								api,
								{
									firstKept: Number(selection.firstKept),
									entries: selection.entries.map((entry) => Number(entry.id)),
									digest: await requestDigest(selection.messages),
								},
								context,
							);
							return undefined;
						},
					}),
				]
			: [],
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
		set summary(value: "success" | "pending" | "error-once") {
			summary = value;
		},
		set phase(value: FixturePhase) {
			phase = value;
		},
		set toolPolicy(value: Pick<ToolRequest, "operation" | "replay">) {
			toolPolicy = value;
		},
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
