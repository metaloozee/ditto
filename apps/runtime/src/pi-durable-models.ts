import { RpcTarget } from "cloudflare:workers";
import {
	awaitWithContext,
	BACKGROUND_CONTEXT,
	withAbortSignal,
} from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
	fauxAssistantMessage,
	fauxProvider,
} from "@earendil-works/pi-ai/providers/faux";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import {
	CompactionTask,
	createRegistry,
	defineExtension,
	GenerationTask,
	hook,
} from "@earendil-works/pi-durable";
import {
	type ModelSubjectV1,
	type ModelTransportDescriptorV1,
	parseModelAttemptV1,
	parseModelSubjectV1,
	parseSyntheticModelBodyV1,
	parseSyntheticModelRequestV1,
	SYNTHETIC_MODEL_URL,
	type SyntheticModelOutcomeV1,
	syntheticModelRequestDigest,
} from "../../../packages/runtime-contracts/src/model.js";
import {
	type HostGuard,
	type ModelDispatch,
	requestDigest,
	semanticTranscript,
} from "./pi-durable-host.ts";

export type OwnedModelRequest = {
	userId: string;
	projectId: string;
	workspaceSessionId: string;
	requestDigest: string;
};

/** Only deployment-owned runtime composition creates this live RPC target. */
export class ExactModelClaim extends RpcTarget {
	#dispatch: ModelDispatch;
	#owned: Readonly<OwnedModelRequest>;
	#used = false;
	#descriptor: ModelTransportDescriptorV1 | undefined;

	static async forRequest(
		dispatch: ModelDispatch,
		subject: ModelSubjectV1,
		request: unknown,
		product: PrivateModelTransport,
	) {
		const narrowed = parseSyntheticModelRequestV1(request);
		const scope = parseModelSubjectV1(subject);
		const digest = await syntheticModelRequestDigest(narrowed);
		const target = new ExactModelClaim(dispatch, {
			userId: scope.userId,
			projectId: scope.projectId,
			workspaceSessionId: scope.workspaceSessionId,
			requestDigest: digest,
		});
		const descriptor: ModelTransportDescriptorV1 = {
			version: 1,
			subject: scope,
			attempt: dispatch.attempt,
			requestDigest: digest,
		};
		target.#descriptor = descriptor;
		dispatch.bindProductAuthority(async () => {
			const result = await product.readModelPermit(narrowed, descriptor);
			if (result.status !== "current")
				throw new Error("Fresh product authority denied");
		});
		return target;
	}

	async describe(): Promise<ModelTransportDescriptorV1> {
		if (!this.#descriptor)
			throw new Error("Test-only unbound claim has no product descriptor");
		return structuredClone(this.#descriptor);
	}

	async halt(attempt: unknown): Promise<{ status: "halted" | "denied" }> {
		try {
			if (
				!this.#descriptor ||
				JSON.stringify(parseModelAttemptV1(attempt)) !==
					JSON.stringify(this.#dispatch.attempt)
			)
				return { status: "denied" };
			await this.#dispatch.halt();
			return { status: "halted" };
		} catch {
			return { status: "denied" };
		}
	}

	constructor(dispatch: ModelDispatch, owned: OwnedModelRequest) {
		super();
		if (
			!Object.values(owned).every(
				(value) =>
					typeof value === "string" && value.length > 0 && value.length <= 512,
			) ||
			!/^[a-f0-9]{64}$/.test(owned.requestDigest)
		)
			throw new Error("Invalid owned model request");
		this.#dispatch = dispatch;
		this.#owned = Object.freeze({ ...owned });
	}

	async claim(
		attempt: unknown,
		owned: unknown,
	): Promise<{ status: "admitted" | "denied" }> {
		try {
			const parsed = parseModelAttemptV1(attempt);
			if (
				!owned ||
				typeof owned !== "object" ||
				Array.isArray(owned) ||
				Object.keys(owned).length !== 4 ||
				Object.entries(this.#owned).some(
					([key, value]) =>
						!Object.hasOwn(owned, key) || Reflect.get(owned, key) !== value,
				) ||
				JSON.stringify(parsed) !== JSON.stringify(this.#dispatch.attempt) ||
				this.#used
			)
				return { status: "denied" };
			this.#used = true;
			await this.#dispatch.claim(parsed);
			return { status: "admitted" };
		} catch {
			return { status: "denied" };
		}
	}
}

export interface PrivateModelTransport {
	requestModel(
		request: unknown,
		capability: ExactModelClaim,
	): Promise<SyntheticModelOutcomeV1>;
	readModelPermit(
		request: unknown,
		descriptor: ModelTransportDescriptorV1,
	): Promise<{ status: "current" | "denied" }>;
}

/** Mandatory guarded composition for the synthetic private product protocol, never live Codex. */
export function createPrivateModelAdapter(
	guard: HostGuard,
	product: PrivateModelTransport,
	owned: ModelSubjectV1,
	generationPurpose: "generation" | "git_metadata" = "generation",
) {
	const subject = Object.freeze(parseModelSubjectV1(owned));
	const faux = fauxProvider({ tokensPerSecond: 0 });
	const stream: typeof faux.provider.stream = (model, transcript, options) => {
		const events = createAssistantMessageEventStream();
		const context = options?.signal
			? withAbortSignal(options.signal, BACKGROUND_CONTEXT)
			: BACKGROUND_CONTEXT;
		void (async () => {
			try {
				context.abortSignal?.throwIfAborted();
				const admitted = await guard.model(
					{
						model: { provider: model.provider, id: model.id },
						transcript,
						options: { ...options },
					},
					context,
					async (dispatch) => {
						const body = parseSyntheticModelBodyV1({
							version: 1,
							protocol: "ditto-synthetic-ndjson-1",
							purpose:
								dispatch.attempt.kind === "custom_summary"
									? "custom_summary"
									: generationPurpose,
							model: model.id,
							thinking:
								options && "reasoning" in options
									? (options.reasoning ?? "off")
									: "off",
							transcript: JSON.stringify(semanticTranscript(transcript)),
							options: { maxTokens: options?.maxTokens ?? 4096 },
						});
						const request = parseSyntheticModelRequestV1({
							version: 1,
							method: "POST",
							url: SYNTHETIC_MODEL_URL,
							headers: [
								["content-type", "application/json"],
								["accept", "application/x-ndjson"],
							],
							body: JSON.stringify(body),
						});
						const claim = await awaitWithContext(
							ExactModelClaim.forRequest(dispatch, subject, request, product),
							context,
						);
						const outcome = await awaitWithContext(
							product.requestModel(request, claim),
							context,
						);
						context.abortSignal?.throwIfAborted();
						if (
							outcome.version !== 1 ||
							!["complete", "failed_known"].includes(outcome.status)
						)
							throw new Error("Private model transport denied or uncertain");
						if (outcome.status === "failed_known")
							return {
								...fauxAssistantMessage([], {
									stopReason: "error",
									errorMessage: "503 Synthetic known model rejection",
								}),
								model: model.id,
								provider: model.provider,
							};
						if (outcome.status !== "complete")
							throw new Error("Private model outcome denied");
						const final = outcome.frames.at(-1);
						if (!final || final.type !== "done")
							throw new Error("Missing synthetic completion");
						const text = outcome.frames
							.flatMap((frame) => (frame.type === "delta" ? [frame.text] : []))
							.join("");
						const response = fauxAssistantMessage(text, {
							stopReason: final.stopReason,
							...(final.stopReason === "error"
								? { errorMessage: "503 Synthetic known model rejection" }
								: {}),
						});
						response.model = model.id;
						response.provider = model.provider;
						response.usage = {
							...response.usage,
							input: final.inputTokens,
							output: final.outputTokens,
							totalTokens: final.inputTokens + final.outputTokens,
						};
						return response;
					},
				);
				const message = await admitted.response;
				await guard.result(admitted.effect, context, JSON.stringify(message));
				context.abortSignal?.throwIfAborted();
				if (message.stopReason === "error")
					events.push({ type: "error", reason: "error", error: message });
				else events.push({ type: "done", reason: "stop", message });
			} catch {
				const error = {
					...fauxAssistantMessage([], {
						stopReason: context.abortSignal?.aborted ? "aborted" : "error",
						errorMessage: "Private model operation unavailable",
					}),
					model: model.id,
					provider: model.provider,
				};
				events.push({
					type: "error",
					reason: error.stopReason === "aborted" ? "aborted" : "error",
					error,
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
		name: "Private synthetic product transport",
		auth: faux.provider.auth,
		getModels: () => {
			const first = faux.provider
				.getModels()
				.find((model) => model.id === "faux-1");
			return first
				? [first, { ...first, id: "faux-2", name: "Synthetic faux-2" }]
				: [];
		},
		stream,
		streamSimple: stream,
	});
	const extension = defineExtension({
		name: "ditto-private-model-transport-v1",
		hooks: [
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
				beforeCompact: (selection, api, context) =>
					guard.summarize(api, selection, context),
			}),
		],
	});
	const registry = createRegistry();
	registry.install(extension);
	return { models, registry, extension };
}
