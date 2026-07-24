import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CheckIcon, CornerDownLeftIcon, SquareIcon } from "lucide-react";
import {
	type Dispatch,
	type FormEvent,
	type KeyboardEvent,
	type SetStateAction,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import {
	ModelSelector,
	ModelSelectorContent,
	ModelSelectorEmpty,
	ModelSelectorGroup,
	ModelSelectorInput,
	ModelSelectorItem,
	ModelSelectorList,
	ModelSelectorLogo,
	ModelSelectorLogoGroup,
	ModelSelectorName,
	ModelSelectorTrigger,
} from "#/components/ai-elements/model-selector";
import { Button } from "#/components/ui/button";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { Spinner } from "#/components/ui/spinner";
import { Textarea } from "#/components/ui/textarea";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/ui/tooltip";
import { useTRPC } from "#/integrations/trpc/react";
import {
	type AssistantMessagePart,
	appendAssistantTextDelta,
	applyAgentToolEventToParts,
	finalizeAssistantParts,
	partsToText,
	partsToTools,
	type StreamToolCall,
} from "#/lib/agent-message-parts";
import {
	DEFAULT_PROJECT_CODER_MODEL,
	effectiveThinkingLevel,
	isPiThinkingLevel,
	PI_THINKING_LEVEL_LABELS,
	type PiThinkingLevel,
	PROJECT_CODER_MODELS,
} from "#/lib/agent-models";
import {
	type DonePayload,
	sendAgentControl,
	streamAgentRun,
} from "#/lib/agent-stream-client";
import { useUserPreferencesStore } from "#/lib/user-preferences-store";
import { cn } from "#/lib/utils";

interface Model {
	chef: string;
	chefSlug: string;
	id: string;
	name: string;
	providers: string[];
	thinkingLevels?: readonly PiThinkingLevel[];
}

interface ModelItemProps {
	model: Model;
	onSelect: (id: string) => void;
	selectedModel: string;
}

function handleTextareaKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
	if (
		event.key === "Enter" &&
		!event.shiftKey &&
		!event.nativeEvent.isComposing
	) {
		event.preventDefault();
		event.currentTarget.form?.requestSubmit();
	}
}

function ModelItem({ model, onSelect, selectedModel }: ModelItemProps) {
	return (
		<ModelSelectorItem onSelect={() => onSelect(model.id)} value={model.id}>
			<ModelSelectorLogo className="size-5" provider={model.chefSlug} />
			<ModelSelectorName>{model.name}</ModelSelectorName>
			<ModelSelectorLogoGroup>
				{model.providers.map((provider) => (
					<ModelSelectorLogo key={provider} provider={provider} />
				))}
			</ModelSelectorLogoGroup>
			{selectedModel === model.id ? (
				<CheckIcon className="ml-auto size-4" />
			) : (
				<div className="ml-auto size-4" />
			)}
		</ModelSelectorItem>
	);
}

export type ComposerStreamingState = {
	active: boolean;
	text: string;
	userText: string;
	userMessageId?: string;
	assistantMessageId?: string;
	tools: StreamToolCall[];
	parts: AssistantMessagePart[];
	queuedFollowUps: QueuedFollowUp[];
	model?: string;
};

export type QueuedFollowUp = {
	requestId: string;
	userMessageId: string;
	assistantMessageId: string;
	text: string;
};

type PendingFollowUpRequest = {
	runId: string;
	snapshot: string;
};

export type StreamCommitPayload = {
	sessionId: string;
	createdSession: boolean;
	user: {
		id: string;
		role: "user";
		content: string;
	};
	assistant: {
		id: string;
		role: "assistant";
		content: string;
		model?: string | null;
		tools?: StreamToolCall[];
		parts?: AssistantMessagePart[];
	};
};

type ComposerProps = {
	projectId?: string;
	sessionId?: string | null;
	disabledReason?: string;
	onStreamingChange?: Dispatch<SetStateAction<ComposerStreamingState | null>>;
	onStreamCommit?: (payload: StreamCommitPayload) => void;
	onWorkspaceRefresh?: (sessionId: string) => void;
	inputText?: string;
	onInputTextChange?: (text: string) => void;
};

export function Composer({
	projectId,
	sessionId,
	disabledReason,
	onStreamingChange,
	onStreamCommit,
	onWorkspaceRefresh,
	inputText,
	onInputTextChange,
}: ComposerProps) {
	const [localText, setLocalText] = useState("");
	const text = inputText !== undefined ? inputText : localText;
	const setText =
		onInputTextChange !== undefined ? onInputTextChange : setLocalText;
	const [isStreaming, setIsStreaming] = useState(false);
	const [controlReady, setControlReady] = useState(false);
	const [controlPending, setControlPending] = useState(false);
	const [stopping, setStopping] = useState(false);
	const activeSessionIdRef = useRef<string | null>(sessionId ?? null);
	const shouldNavigateToSessionRef = useRef(false);
	const streamSettledRef = useRef(false);
	const isStreamingRef = useRef(false);
	const controlReadyRef = useRef(false);
	const controlPendingRef = useRef(false);
	const stoppingRef = useRef(false);
	const runIdRef = useRef<string | null>(null);
	const queuedFollowUpsRef = useRef<QueuedFollowUp[]>([]);
	const pendingFollowUpRef = useRef<PendingFollowUpRequest | null>(null);
	const preAckBoundaryIdsRef = useRef(new Set<string>());
	const committedAssistantIdsRef = useRef(new Set<string>());
	const userMessageIdRef = useRef<string | null>(null);
	const assistantMessageIdRef = useRef<string | null>(null);
	const partsRef = useRef<AssistantMessagePart[]>([]);
	const promptRef = useRef("");
	const textRef = useRef(text);
	useEffect(() => {
		textRef.current = text;
	}, [text]);
	const assistantTextRef = useRef("");
	const model = useUserPreferencesStore((state) => state.selectedModel);
	const setModel = useUserPreferencesStore((state) => state.setSelectedModel);
	const thinkingPreference = useUserPreferencesStore(
		(state) => state.thinkingLevel,
	);
	const setThinkingPreference = useUserPreferencesStore(
		(state) => state.setThinkingLevel,
	);
	const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
	const [messageError, setMessageError] = useState<string | null>(null);
	const navigate = useNavigate();
	const trpc = useTRPC();
	const modelsQuery = useQuery(trpc.providerAuth.models.queryOptions());
	const models = useMemo<Model[]>(() => {
		const fromServer = modelsQuery.data?.models ?? [];
		if (fromServer.length > 0) {
			return fromServer.map((m) => ({
				id: m.id,
				name: m.name,
				chef: m.providerName || m.provider,
				chefSlug: m.provider,
				providers: [m.provider],
				thinkingLevels: m.thinkingLevels,
			}));
		}
		// Keep built-in defaults while the catalog loads or when none are connected.
		if (modelsQuery.isPending || !modelsQuery.data) {
			return PROJECT_CODER_MODELS.map((m) => ({
				id: m.id,
				name: m.name,
				chef: m.providerName,
				chefSlug: m.provider,
				providers: [m.provider],
				thinkingLevels: m.thinkingLevels,
			}));
		}
		return [];
	}, [modelsQuery.data, modelsQuery.isPending]);
	const modelsByChef = useMemo(() => {
		const map = new Map<string, Model[]>();
		for (const modelOption of models) {
			const group = map.get(modelOption.chef);
			if (group) group.push(modelOption);
			else map.set(modelOption.chef, [modelOption]);
		}
		return map;
	}, [models]);
	useEffect(() => {
		if (models.length === 0) return;
		if (!models.some((m) => m.id === model)) {
			setModel(DEFAULT_PROJECT_CODER_MODEL);
		}
	}, [model, models, setModel]);
	const modelsLoading = modelsQuery.isLoading;

	function clearStreamingState(): void {
		isStreamingRef.current = false;
		controlReadyRef.current = false;
		controlPendingRef.current = false;
		stoppingRef.current = false;
		runIdRef.current = null;
		queuedFollowUpsRef.current = [];
		pendingFollowUpRef.current = null;
		preAckBoundaryIdsRef.current.clear();
		setIsStreaming(false);
		setControlReady(false);
		setControlPending(false);
		setStopping(false);
		onStreamingChange?.(null);
	}

	function emptyStreaming(prompt: string): ComposerStreamingState {
		return {
			active: true,
			text: "",
			userText: prompt,
			tools: [],
			parts: [],
			queuedFollowUps: [],
			model,
		};
	}

	function setControlPendingState(pending: boolean): void {
		controlPendingRef.current = pending;
		setControlPending(pending);
	}

	function projectQueuedFollowUps(next: QueuedFollowUp[]): void {
		queuedFollowUpsRef.current = next;
		onStreamingChange?.((previous) => {
			if (!previous) return previous;
			return { ...previous, queuedFollowUps: next };
		});
	}

	function consumeQueuedBoundary(
		requestId: string,
	): QueuedFollowUp | undefined {
		const queued = queuedFollowUpsRef.current.find(
			(item) => item.requestId === requestId,
		);
		if (queued) {
			projectQueuedFollowUps(
				queuedFollowUpsRef.current.filter(
					(item) => item.requestId !== requestId,
				),
			);
		} else if (pendingFollowUpRef.current) {
			preAckBoundaryIdsRef.current.add(requestId);
		}
		return queued;
	}

	function commitTurn(options: {
		sessionId: string;
		userMessageId: string;
		assistantMessageId: string;
		userText: string;
		content: string;
		parts: AssistantMessagePart[];
		tools: StreamToolCall[];
	}): void {
		if (committedAssistantIdsRef.current.has(options.assistantMessageId))
			return;
		committedAssistantIdsRef.current.add(options.assistantMessageId);
		onStreamCommit?.({
			sessionId: options.sessionId,
			createdSession:
				shouldNavigateToSessionRef.current &&
				committedAssistantIdsRef.current.size === 1,
			user: {
				id: options.userMessageId,
				role: "user",
				content: options.userText,
			},
			assistant: {
				id: options.assistantMessageId,
				role: "assistant",
				content: options.content,
				model,
				tools: options.tools,
				parts: options.parts,
			},
		});
	}

	function settleAfterStream(
		resolvedSessionId: string | undefined,
		done?: DonePayload,
	): void {
		if (streamSettledRef.current) {
			return;
		}
		streamSettledRef.current = true;

		const session = resolvedSessionId ?? activeSessionIdRef.current;
		const userMessageId = userMessageIdRef.current;
		const assistantMessageId =
			done?.assistantMessageId ?? assistantMessageIdRef.current;
		const sourceParts =
			partsRef.current.length > 0
				? partsRef.current
				: done?.parts && done.parts.length > 0
					? done.parts
					: [];
		const finalParts = finalizeAssistantParts(sourceParts);
		const assistantContent =
			(done?.content && done.content.length > 0
				? done.content
				: partsToText(finalParts) || assistantTextRef.current) || "";

		if (session && userMessageId && assistantMessageId) {
			commitTurn({
				sessionId: session,
				userMessageId,
				assistantMessageId,
				userText: promptRef.current,
				content: assistantContent,
				tools: partsToTools(finalParts),
				parts: finalParts,
			});
			if (done?.ok !== false) {
				onWorkspaceRefresh?.(session);
			}
		}

		if (done && done.ok === false && !assistantContent.trim()) {
			// error toast already fired from onError when present
		} else if (!done && !assistantContent.trim()) {
			toast.error("Agent stream ended before a response was received.");
		}

		clearStreamingState();

		if (shouldNavigateToSessionRef.current && projectId && session) {
			shouldNavigateToSessionRef.current = false;
			void navigate({
				to: "/project/$projectId/session/$sessionId",
				params: { projectId, sessionId: session },
			});
		}
	}

	async function startInitialPrompt(prompt: string): Promise<void> {
		if (!projectId) return;
		setText("");
		textRef.current = "";
		isStreamingRef.current = true;
		setIsStreaming(true);
		controlReadyRef.current = false;
		setControlReady(false);
		setControlPendingState(false);
		stoppingRef.current = false;
		setStopping(false);
		runIdRef.current = null;
		queuedFollowUpsRef.current = [];
		pendingFollowUpRef.current = null;
		preAckBoundaryIdsRef.current.clear();
		committedAssistantIdsRef.current = new Set();
		promptRef.current = prompt;
		assistantTextRef.current = "";
		partsRef.current = [];
		userMessageIdRef.current = null;
		assistantMessageIdRef.current = null;
		onStreamingChange?.(emptyStreaming(prompt));
		shouldNavigateToSessionRef.current = false;
		streamSettledRef.current = false;
		activeSessionIdRef.current = sessionId ?? null;

		let streamSessionId = sessionId ?? undefined;

		try {
			const thinkingLevel = effectiveThinkingLevel(
				thinkingPreference,
				models.find((m) => m.id === model)?.thinkingLevels,
			);
			await streamAgentRun(
				{
					projectId,
					sessionId: streamSessionId,
					message: prompt,
					model,
					...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
				},
				{
					onMeta: (meta) => {
						runIdRef.current = meta.runId;
						streamSessionId = meta.sessionId;
						activeSessionIdRef.current = meta.sessionId;
						userMessageIdRef.current = meta.userMessageId;
						assistantMessageIdRef.current = meta.assistantMessageId;
						if (meta.createdSession) {
							shouldNavigateToSessionRef.current = true;
						}
						onStreamingChange?.((previous) => {
							const base = previous ?? emptyStreaming(prompt);
							return {
								...base,
								active: true,
								userMessageId: meta.userMessageId,
								assistantMessageId: meta.assistantMessageId,
								model,
							};
						});
					},
					onControlReady: ({ runId }) => {
						if (runId !== runIdRef.current) return;
						controlReadyRef.current = true;
						setControlReady(true);
					},
					onTurnDone: (turn) => {
						const resolvedSessionId =
							activeSessionIdRef.current ?? streamSessionId;
						if (!resolvedSessionId) return;
						const turnParts = finalizeAssistantParts(turn.parts ?? []);
						commitTurn({
							sessionId: resolvedSessionId,
							userMessageId: turn.userMessageId,
							assistantMessageId: turn.assistantMessageId,
							userText: promptRef.current,
							content: turn.content,
							parts: turnParts,
							tools: turn.tools ?? partsToTools(turnParts),
						});
					},
					onTurnStart: (turn) => {
						const queued = consumeQueuedBoundary(turn.requestId);
						promptRef.current = queued?.text ?? turn.text;
						userMessageIdRef.current = turn.userMessageId;
						assistantMessageIdRef.current = turn.assistantMessageId;
						assistantTextRef.current = "";
						partsRef.current = [];
						onStreamingChange?.((previous) => ({
							...(previous ?? emptyStreaming(promptRef.current)),
							active: true,
							text: "",
							userText: promptRef.current,
							userMessageId: turn.userMessageId,
							assistantMessageId: turn.assistantMessageId,
							tools: [],
							parts: [],
							queuedFollowUps: queuedFollowUpsRef.current,
							model,
						}));
					},
					onQueueCancelled: ({ requestId }) => {
						consumeQueuedBoundary(requestId);
					},
					onDelta: (delta) => {
						if (!delta) {
							return;
						}
						assistantTextRef.current += delta;
						partsRef.current = appendAssistantTextDelta(
							partsRef.current,
							delta,
						);
						// Project once per callback from refs (server already batches).
						const nextParts = partsRef.current;
						const nextText = partsToText(nextParts);
						const nextTools = partsToTools(nextParts);
						onStreamingChange?.((previous) => {
							const base = previous ?? emptyStreaming(prompt);
							if (
								base.text === nextText &&
								base.parts === nextParts &&
								base.tools === nextTools
							) {
								return previous ?? base;
							}
							return {
								...base,
								active: true,
								text: nextText,
								parts: nextParts,
								tools: nextTools,
							};
						});
					},
					onAgent: (event, occurredAt) => {
						// Tool events stay immediate (server flushes text before tools).
						// Use the server-assigned occurrence time so optimistic + persisted
						// records share exact lifecycle timestamps.
						const nextParts = applyAgentToolEventToParts(
							partsRef.current,
							event,
							occurredAt,
						);
						if (!nextParts) {
							return;
						}
						partsRef.current = nextParts;
						const nextText = partsToText(nextParts);
						const nextTools = partsToTools(nextParts);
						onStreamingChange?.((previous) => {
							const base = previous ?? emptyStreaming(prompt);
							return {
								...base,
								active: true,
								parts: nextParts,
								tools: nextTools,
								text: nextText,
							};
						});
					},
					onError: (errorMessage) => {
						toast.error(errorMessage);
					},
					onDone: (done) => {
						const resolvedSessionId =
							activeSessionIdRef.current ?? streamSessionId;
						settleAfterStream(resolvedSessionId, done);
					},
				},
			);

			if (!streamSettledRef.current) {
				const resolvedSessionId = activeSessionIdRef.current ?? streamSessionId;
				settleAfterStream(resolvedSessionId);
			} else if (isStreamingRef.current) {
				clearStreamingState();
			}
		} catch (streamError) {
			clearStreamingState();
			toast.error(
				streamError instanceof Error
					? streamError.message
					: "Failed to run agent.",
			);
		}
	}

	async function queueFollowUp(snapshot: string): Promise<void> {
		const runId = runIdRef.current;
		const activeSessionId = activeSessionIdRef.current;
		if (
			!projectId ||
			!runId ||
			!activeSessionId ||
			!controlReadyRef.current ||
			controlPendingRef.current ||
			stoppingRef.current
		) {
			return;
		}

		setControlPendingState(true);
		const pendingRequest = { runId, snapshot };
		pendingFollowUpRef.current = pendingRequest;
		let failureMessage: string | null = null;
		try {
			const response = await sendAgentControl({
				action: "follow_up",
				projectId,
				sessionId: activeSessionId,
				runId,
				model,
				message: snapshot,
			});
			if (response.action !== "follow_up") {
				failureMessage = "Agent control returned an invalid response.";
			} else if (
				pendingFollowUpRef.current === pendingRequest &&
				runIdRef.current === runId &&
				isStreamingRef.current
			) {
				const boundaryArrivedBeforeAck = preAckBoundaryIdsRef.current.delete(
					response.requestId,
				);
				if (!boundaryArrivedBeforeAck) {
					projectQueuedFollowUps([
						...queuedFollowUpsRef.current,
						{
							requestId: response.requestId,
							userMessageId: response.userMessageId,
							assistantMessageId: response.assistantMessageId,
							text: snapshot,
						},
					]);
				}
				if (textRef.current === snapshot) {
					textRef.current = "";
					setText("");
				}
			}
		} catch (error) {
			failureMessage =
				error instanceof Error ? error.message : "Failed to queue message.";
		}
		if (
			failureMessage &&
			pendingFollowUpRef.current === pendingRequest &&
			runIdRef.current === runId &&
			isStreamingRef.current
		) {
			toast.error(failureMessage);
		}
		if (pendingFollowUpRef.current === pendingRequest) {
			pendingFollowUpRef.current = null;
			setControlPendingState(false);
		}
	}

	async function stopActiveRun(): Promise<void> {
		const runId = runIdRef.current;
		const activeSessionId = activeSessionIdRef.current;
		if (
			!projectId ||
			!runId ||
			!activeSessionId ||
			!controlReadyRef.current ||
			controlPendingRef.current ||
			stoppingRef.current
		) {
			return;
		}

		stoppingRef.current = true;
		setStopping(true);
		setControlPendingState(true);
		let failureMessage: string | null = null;
		try {
			const response = await sendAgentControl({
				action: "stop",
				projectId,
				sessionId: activeSessionId,
				runId,
			});
			if (response.action !== "stop") {
				failureMessage = "Agent control returned an invalid response.";
			}
		} catch (error) {
			failureMessage =
				error instanceof Error ? error.message : "Failed to stop agent.";
		}
		if (failureMessage) {
			stoppingRef.current = false;
			setStopping(false);
			toast.error(failureMessage);
		}
		setControlPendingState(false);
	}

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (disabledReason || controlPendingRef.current) return;

		const snapshot = textRef.current;
		if (isStreamingRef.current) {
			if (!controlReadyRef.current || stoppingRef.current) return;
			if (snapshot.trim()) {
				await queueFollowUp(snapshot);
			} else {
				await stopActiveRun();
			}
			return;
		}

		if (!snapshot.trim()) {
			setMessageError("Enter a message before sending.");
			return;
		}
		setMessageError(null);
		if (!projectId) {
			textRef.current = "";
			setText("");
			return;
		}
		await startInitialPrompt(snapshot);
	}

	function handleModelSelect(id: string): void {
		setModel(id);
		setModelSelectorOpen(false);
	}

	const selectedModel = models.find((modelOption) => modelOption.id === model);
	const selectedThinkingLevels = selectedModel?.thinkingLevels;
	const effectiveThinking = effectiveThinkingLevel(
		thinkingPreference,
		selectedThinkingLevels,
	);
	const thinkingOptions = selectedThinkingLevels ?? [];
	const thinkingSelectDisabled =
		Boolean(disabledReason) ||
		isStreaming ||
		thinkingOptions.length <= 1 ||
		effectiveThinking === undefined;
	const thinkingTriggerLabel =
		effectiveThinking === undefined
			? "Auto"
			: PI_THINKING_LEVEL_LABELS[effectiveThinking];
	const hasText = Boolean(text.trim());
	const isPending =
		controlPending || stopping || (isStreaming && !controlReady);
	const actionName = stopping
		? "Stopping"
		: isStreaming
			? !controlReady
				? "Starting"
				: hasText
					? "Queue message"
					: "Stop"
			: controlPending
				? "Sending"
				: "Submit";
	const isStopAction = stopping || (isStreaming && controlReady && !hasText);
	const submitDisabled =
		Boolean(disabledReason) ||
		modelsLoading ||
		models.length === 0 ||
		!models.some((m) => m.id === model) ||
		isPending ||
		(isStreaming ? !controlReady && !isPending : !hasText);
	const messageInvalid = Boolean(messageError);

	const modelLabel = selectedModel?.name ?? "Select model";

	return (
		<section className="mx-auto w-full max-w-3xl px-5 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
			<form className="w-full" onSubmit={handleSubmit} noValidate>
				<div className="flex items-end gap-2">
					<div className="flex shrink-0 self-end">
						<ModelSelector
							open={modelSelectorOpen}
							onOpenChange={setModelSelectorOpen}
						>
							<Tooltip>
								<TooltipTrigger
									render={
										<ModelSelectorTrigger
											render={
												<Button
													type="button"
													variant="outline"
													size="icon-lg"
													aria-label={modelLabel}
													disabled={
														Boolean(disabledReason) ||
														isStreaming ||
														models.length === 0
													}
													className={cn(
														"size-11 rounded-full bg-card shadow-xs",
														"transition-transform duration-150 ease-out",
														"active:scale-[0.97]",
														"motion-reduce:transition-none motion-reduce:active:scale-100",
													)}
												>
													{selectedModel?.chefSlug ? (
														<ModelSelectorLogo
															className="size-5"
															provider={selectedModel.chefSlug}
														/>
													) : (
														<span
															className="size-5 rounded-full bg-muted"
															aria-hidden
														/>
													)}
												</Button>
											}
										/>
									}
								/>
								<TooltipContent side="top">{modelLabel}</TooltipContent>
							</Tooltip>
							<ModelSelectorContent showCloseButton={false}>
								<ModelSelectorInput placeholder="Search models…" />
								<ModelSelectorList>
									<ModelSelectorEmpty>No model found.</ModelSelectorEmpty>
									{models.length === 0 ? (
										<div className="px-4 py-6 text-center text-sm text-muted-foreground">
											<p className="font-medium text-foreground">
												Nothing found
											</p>
											<p className="mt-1 text-xs text-pretty">
												Connect an AI provider in Settings to choose a model.
											</p>
										</div>
									) : (
										[...modelsByChef.entries()].map(([chef, chefModels]) => (
											<ModelSelectorGroup heading={chef} key={chef}>
												{chefModels.map((modelOption) => (
													<ModelItem
														key={modelOption.id}
														model={modelOption}
														onSelect={handleModelSelect}
														selectedModel={model}
													/>
												))}
											</ModelSelectorGroup>
										))
									)}
								</ModelSelectorList>
							</ModelSelectorContent>
						</ModelSelector>
					</div>

					<div className="relative min-w-0 flex-1">
						<Textarea
							aria-label="Message"
							name="message"
							value={text}
							placeholder="Ask Ditto to inspect the workspace…"
							required
							minLength={1}
							aria-invalid={messageInvalid || undefined}
							aria-describedby={
								messageInvalid ? "composer-message-error" : undefined
							}
							onChange={(event) => {
								textRef.current = event.currentTarget.value;
								setText(event.currentTarget.value);
								if (messageError) setMessageError(null);
							}}
							onKeyDown={handleTextareaKeyDown}
							className={cn(
								"min-h-11 max-h-48 w-full resize-none rounded-3xl border-border bg-card px-4 py-2 pr-24 text-sm shadow-xs md:text-sm",
								"field-sizing-content text-pretty leading-relaxed",
								"placeholder:text-muted-foreground/70",
							)}
						/>
						<div className="absolute right-2 bottom-2">
							<Select
								value={effectiveThinking ?? null}
								onValueChange={(value) => {
									if (isPiThinkingLevel(value)) {
										setThinkingPreference(value);
									}
								}}
								disabled={thinkingSelectDisabled}
							>
								<SelectTrigger
									size="sm"
									aria-label="Thinking level"
									className={cn(
										"h-auto gap-1 border-0 bg-transparent px-1.5 py-0.5 text-muted-foreground shadow-none",
										"hover:bg-transparent hover:text-foreground",
										"focus-visible:border-0 focus-visible:ring-1 focus-visible:ring-ring/40",
										"dark:bg-transparent dark:hover:bg-transparent",
										"disabled:opacity-40",
									)}
								>
									<SelectValue>{thinkingTriggerLabel}</SelectValue>
								</SelectTrigger>
								<SelectContent
									side="top"
									align="end"
									alignItemWithTrigger={false}
								>
									<SelectGroup>
										{thinkingOptions.map((level) => (
											<SelectItem key={level} value={level}>
												{PI_THINKING_LEVEL_LABELS[level]}
											</SelectItem>
										))}
									</SelectGroup>
								</SelectContent>
							</Select>
						</div>
					</div>

					<div className="flex shrink-0 self-end">
						<Tooltip>
							<TooltipTrigger
								render={
									<Button
										type="submit"
										variant={isStopAction ? "destructive" : "default"}
										size="icon-lg"
										aria-label={actionName}
										aria-busy={isPending || undefined}
										disabled={isPending || submitDisabled}
										className={cn(
											"size-11 rounded-full shadow-xs",
											"transition-transform duration-150 ease-out",
											"active:scale-[0.97]",
											"motion-reduce:transition-none motion-reduce:active:scale-100",
										)}
									>
										{isPending ? (
											<Spinner className="size-4" aria-hidden />
										) : (
											<span className="relative size-4" aria-hidden>
												<CornerDownLeftIcon
													className={cn(
														"absolute inset-0 size-4 transition-[opacity,transform,filter] duration-150 ease-out",
														"motion-reduce:transition-none",
														isStopAction
															? "scale-90 opacity-0 blur-[2px]"
															: "scale-100 opacity-100 blur-0",
													)}
												/>
												<SquareIcon
													className={cn(
														"absolute inset-0 size-4 transition-[opacity,transform,filter] duration-150 ease-out",
														"motion-reduce:transition-none",
														isStopAction
															? "scale-100 opacity-100 blur-0"
															: "scale-90 opacity-0 blur-[2px]",
													)}
												/>
											</span>
										)}
									</Button>
								}
							/>
							<TooltipContent side="top">{actionName}</TooltipContent>
						</Tooltip>
					</div>
				</div>
				{messageError ? (
					<p
						id="composer-message-error"
						className="mt-2 px-1 text-xs text-destructive"
						role="alert"
					>
						{messageError}
					</p>
				) : null}
			</form>
		</section>
	);
}
