import { useNavigate } from "@tanstack/react-router";
import {
	CheckIcon,
	CornerDownLeftIcon,
	GitBranchIcon,
	SquareIcon,
} from "lucide-react";
import {
	type Dispatch,
	type FormEvent,
	type KeyboardEvent,
	type SetStateAction,
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
import { SessionGitActions } from "#/components/session-git-actions";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupTextarea,
} from "#/components/ui/input-group";
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
	PROJECT_CODER_MODELS,
	type ProjectCoderModelSpecifier,
} from "#/lib/agent-models";
import {
	type DonePayload,
	sendAgentControl,
	streamAgentRun,
} from "#/lib/agent-stream-client";
import { useUserPreferencesStore } from "#/lib/user-preferences-store";

const models = PROJECT_CODER_MODELS.map((model) => ({
	chef: model.providerName,
	chefSlug: model.provider,
	id: model.id,
	name: model.name,
	providers: [model.provider],
})) satisfies Model[];

const modelsByChef = new Map<string, Model[]>();
for (const modelOption of models) {
	const group = modelsByChef.get(modelOption.chef);
	if (group) {
		group.push(modelOption);
	} else {
		modelsByChef.set(modelOption.chef, [modelOption]);
	}
}

interface Model {
	chef: string;
	chefSlug: string;
	id: ProjectCoderModelSpecifier;
	name: string;
	providers: string[];
}

interface ModelItemProps {
	model: Model;
	onSelect: (id: ProjectCoderModelSpecifier) => void;
	selectedModel: ProjectCoderModelSpecifier;
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
	branchName?: string | null;
	gitExportEnabled?: boolean;
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
	branchName,
	gitExportEnabled = false,
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
	textRef.current = text;
	const assistantTextRef = useRef("");
	const model = useUserPreferencesStore((state) => state.selectedModel);
	const setModel = useUserPreferencesStore((state) => state.setSelectedModel);
	const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
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
			await streamAgentRun(
				{
					projectId,
					sessionId: streamSessionId,
					message: prompt,
					model,
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
				throw new Error("Agent control returned an invalid response.");
			}
			if (
				pendingFollowUpRef.current !== pendingRequest ||
				runIdRef.current !== runId ||
				!isStreamingRef.current
			) {
				return;
			}
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
		} catch (error) {
			if (
				pendingFollowUpRef.current !== pendingRequest ||
				runIdRef.current !== runId ||
				!isStreamingRef.current
			) {
				return;
			}
			toast.error(
				error instanceof Error ? error.message : "Failed to queue message.",
			);
		} finally {
			if (pendingFollowUpRef.current === pendingRequest) {
				pendingFollowUpRef.current = null;
				setControlPendingState(false);
			}
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
		try {
			const response = await sendAgentControl({
				action: "stop",
				projectId,
				sessionId: activeSessionId,
				runId,
			});
			if (response.action !== "stop") {
				throw new Error("Agent control returned an invalid response.");
			}
		} catch (error) {
			stoppingRef.current = false;
			setStopping(false);
			toast.error(
				error instanceof Error ? error.message : "Failed to stop agent.",
			);
		} finally {
			setControlPendingState(false);
		}
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

		if (!snapshot.trim()) return;
		if (!projectId) {
			textRef.current = "";
			setText("");
			return;
		}
		await startInitialPrompt(snapshot);
	}

	function handleModelSelect(id: ProjectCoderModelSpecifier): void {
		setModel(id);
		setModelSelectorOpen(false);
	}

	const selectedModel = models.find((modelOption) => modelOption.id === model);
	const hasText = Boolean(text.trim());
	const actionName = stopping
		? "Stopping"
		: isStreaming
			? !controlReady
				? "Starting"
				: hasText
					? "Queue message"
					: "Stop"
			: "Submit";
	const submitDisabled =
		Boolean(disabledReason) ||
		controlPending ||
		stopping ||
		(isStreaming ? !controlReady : !hasText);

	return (
		<section className="mx-auto flex w-full max-w-3xl flex-col justify-end gap-5 px-2 pb-2">
			<div className="flex flex-col items-center justify-center gap-1 rounded-lg border bg-card p-1 shadow-sm">
				<form
					className="w-full rounded-lg bg-background"
					onSubmit={handleSubmit}
				>
					<InputGroup className="overflow-hidden">
						<InputGroupTextarea
							aria-label="Message"
							className="field-sizing-content max-h-48 min-h-16"
							name="message"
							onChange={(event) => {
								textRef.current = event.currentTarget.value;
								setText(event.currentTarget.value);
							}}
							onKeyDown={handleTextareaKeyDown}
							value={text}
							placeholder="Ask Ditto to inspect the workspace..."
						/>
						<InputGroupAddon
							align="block-end"
							className="justify-between gap-1"
						>
							<ModelSelector
								open={modelSelectorOpen}
								onOpenChange={setModelSelectorOpen}
							>
								<ModelSelectorTrigger
									render={
										<InputGroupButton
											aria-label="Select model"
											disabled={Boolean(disabledReason) || isStreaming}
										>
											{selectedModel?.chefSlug ? (
												<ModelSelectorLogo
													className="size-3.5"
													provider={selectedModel.chefSlug}
												/>
											) : null}
											{selectedModel?.name ? (
												<ModelSelectorName>
													{selectedModel.name}
												</ModelSelectorName>
											) : null}
										</InputGroupButton>
									}
								/>
								<ModelSelectorContent showCloseButton={false}>
									<ModelSelectorInput placeholder="Search models..." />
									<ModelSelectorList>
										<ModelSelectorEmpty>No model found.</ModelSelectorEmpty>
										{[...modelsByChef.entries()].map(([chef, chefModels]) => (
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
										))}
									</ModelSelectorList>
								</ModelSelectorContent>
							</ModelSelector>
							<InputGroupButton
								aria-label={actionName}
								disabled={submitDisabled}
								size="icon-sm"
								type="submit"
								variant="default"
							>
								{isStreaming && controlReady && !hasText ? (
									<SquareIcon aria-hidden />
								) : (
									<CornerDownLeftIcon aria-hidden />
								)}
							</InputGroupButton>
						</InputGroupAddon>
					</InputGroup>
				</form>
				<div className="flex w-full flex-wrap items-center justify-between gap-2 px-2 py-0.5 text-muted-foreground">
					<div className="flex min-w-0 items-center gap-1.5 text-[11px]">
						<GitBranchIcon className="size-3 shrink-0" aria-hidden />
						<p
							className="truncate font-medium"
							title={branchName?.trim() || undefined}
						>
							{branchName?.trim() || "—"}
						</p>
					</div>
					{gitExportEnabled && projectId && sessionId ? (
						<SessionGitActions
							projectId={projectId}
							sessionId={sessionId}
							disabled={Boolean(disabledReason) || isStreaming}
						/>
					) : null}
				</div>
			</div>
		</section>
	);
}
