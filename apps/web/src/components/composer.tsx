import { useNavigate } from "@tanstack/react-router";
import { CornerDownLeft, Square } from "lucide";
import { MorphIcon } from "morphicons/react";
import {
	type Dispatch,
	type FormEvent,
	type KeyboardEvent,
	type SetStateAction,
	useEffect,
	useRef,
	useState,
} from "react";
import { ModelSelectorLogo } from "#/components/ai-elements/model-selector";
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
import { toast } from "#/components/ui/toast";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#/components/ui/tooltip";
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
	FALLBACK_MODEL_THINKING_LEVELS,
	isSupportedThinkingLevel,
	PI_THINKING_LEVEL_LABELS,
	PROJECT_CODER_MODELS,
} from "#/lib/agent-models";
import {
	type DonePayload,
	sendAgentControl,
	streamAgentRun,
} from "#/lib/agent-stream-client";
import { useUserPreferencesStore } from "#/lib/user-preferences-store";
import { cn } from "#/lib/utils";

/** Strong ease-out (Emil) — snappy start, soft settle. Full class strings for Tailwind scan. */
const morphEaseClass = "ease-[cubic-bezier(0.23,1,0.32,1)]";
/** Controls settle into the card bar when entering narrow; off when wide. */
const controlSettleClass = cn(
	"motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1",
	"motion-safe:duration-200 motion-safe:fill-mode-both",
	"motion-safe:ease-[cubic-bezier(0.23,1,0.32,1)]",
	"@[420px]:animate-none",
);

const FIXED_MODEL = PROJECT_CODER_MODELS[0];

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
	const thinkingPreference = useUserPreferencesStore(
		(state) => state.thinkingLevel,
	);
	const setThinkingPreference = useUserPreferencesStore(
		(state) => state.setThinkingLevel,
	);
	const [messageError, setMessageError] = useState<string | null>(null);
	const navigate = useNavigate();

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
			model: DEFAULT_PROJECT_CODER_MODEL,
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
				model: DEFAULT_PROJECT_CODER_MODEL,
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
			toast.add({
				type: "error",
				description: "Agent stream ended before a response was received.",
			});
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
				FALLBACK_MODEL_THINKING_LEVELS,
			);
			await streamAgentRun(
				{
					projectId,
					sessionId: streamSessionId,
					message: prompt,
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
								model: DEFAULT_PROJECT_CODER_MODEL,
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
							model: DEFAULT_PROJECT_CODER_MODEL,
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
						toast.add({ type: "error", description: errorMessage });
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
			toast.add({
				type: "error",
				description:
					streamError instanceof Error
						? streamError.message
						: "Failed to run agent.",
			});
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
			toast.add({ type: "error", description: failureMessage });
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
			toast.add({ type: "error", description: failureMessage });
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

	const thinkingOptions = FALLBACK_MODEL_THINKING_LEVELS;
	const effectiveThinking = effectiveThinkingLevel(
		thinkingPreference,
		thinkingOptions,
	);
	const thinkingSelectDisabled = Boolean(disabledReason) || isStreaming;
	const thinkingTriggerLabel =
		effectiveThinking === undefined
			? PI_THINKING_LEVEL_LABELS[thinkingPreference]
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
		isPending ||
		(isStreaming ? !controlReady && !isPending : !hasText);
	const messageInvalid = Boolean(messageError);

	const modelLabel = FIXED_MODEL.name;

	return (
		<section className="@container mx-auto w-full min-w-0 max-w-3xl px-5 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-6">
			<form className="w-full" onSubmit={handleSubmit} noValidate>
				{/*
				  Narrow (<420px container): one card — textarea row, then
				  Model · Thinking · spacer · Send.
				  Wide: model | pill textarea + thinking | send (unchanged).
				*/}
				<div
					className={cn(
						"grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-end gap-y-1",
						"rounded-3xl border border-border bg-card shadow-xs",
						"transition-[background-color,border-color,box-shadow,border-radius,gap] duration-200",
						morphEaseClass,
						"motion-reduce:transition-none",
						"@[420px]:grid-cols-[auto_minmax(0,1fr)_auto] @[420px]:gap-2 @[420px]:gap-y-0",
						"@[420px]:rounded-none @[420px]:border-0 @[420px]:bg-transparent @[420px]:shadow-none",
					)}
				>
					<div className="relative col-span-4 min-w-0 @[420px]:col-span-1 @[420px]:col-start-2 @[420px]:row-start-1">
						<Textarea
							aria-label="Message"
							name="message"
							value={text}
							placeholder="Ask Ditto to inspect the workspace…"
							required
							minLength={1}
							disabled={Boolean(disabledReason)}
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
								"min-h-11 max-h-48 w-full resize-none rounded-3xl border-0 bg-transparent px-4 py-3 text-sm shadow-none md:text-sm",
								"dark:bg-transparent",
								"field-sizing-content text-pretty leading-relaxed",
								"placeholder:text-muted-foreground/70",
								"transition-[padding,background-color,box-shadow,border-color] duration-200",
								morphEaseClass,
								"motion-reduce:transition-none",
								"@[420px]:border @[420px]:border-border @[420px]:bg-card @[420px]:py-2 @[420px]:pr-24 @[420px]:shadow-xs",
								"@[420px]:dark:bg-card",
							)}
						/>
					</div>

					<div
						className={cn(
							"col-start-1 row-start-2 flex shrink-0 p-2 pt-0",
							"@[420px]:col-start-1 @[420px]:row-start-1 @[420px]:p-0",
							controlSettleClass,
						)}
					>
						<Tooltip>
							<TooltipTrigger
								render={
									<span
										role="img"
										aria-label={modelLabel}
										className={cn(
											"inline-flex size-9 items-center justify-center rounded-full border border-border bg-card shadow-xs @[420px]:size-11",
										)}
									>
										<ModelSelectorLogo
											className="size-5"
											provider={FIXED_MODEL.provider}
										/>
									</span>
								}
							/>
							<TooltipContent side="top">{modelLabel}</TooltipContent>
						</Tooltip>
					</div>

					<div
						className={cn(
							"col-start-2 row-start-2 flex items-center self-center pb-2",
							"transition-[margin,padding] duration-200 motion-reduce:transition-none",
							morphEaseClass,
							"motion-safe:delay-50",
							"@[420px]:col-start-2 @[420px]:row-start-1 @[420px]:z-10 @[420px]:mb-2 @[420px]:mr-2 @[420px]:justify-self-end @[420px]:self-end @[420px]:pb-0",
							controlSettleClass,
						)}
					>
						<Select
							value={effectiveThinking ?? null}
							onValueChange={(value) => {
								if (isSupportedThinkingLevel(value)) {
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

					<div
						className={cn(
							"col-start-4 row-start-2 flex shrink-0 p-2 pt-0",
							"@[420px]:col-start-3 @[420px]:row-start-1 @[420px]:p-0",
							"motion-safe:delay-75",
							controlSettleClass,
						)}
					>
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
											"size-9 rounded-full shadow-xs @[420px]:size-11",
											"transition-[transform,width,height] duration-200",
											morphEaseClass,
											"active:scale-[0.97] active:duration-150",
											"motion-reduce:transition-none motion-reduce:active:scale-100",
										)}
									>
										{isPending ? (
											<Spinner className="size-4" aria-hidden />
										) : (
											<MorphIcon
												icon={isStopAction ? Square : CornerDownLeft}
												className="size-4"
												spring="snappy"
											/>
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
