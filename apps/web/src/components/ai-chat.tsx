/** biome-ignore-all lint/a11y/useSemanticElements: false positive */
/** biome-ignore-all lint/a11y/useAriaPropsForRole: false positive */
import { Link } from "@tanstack/react-router";
import {
	BotIcon,
	CodeIcon,
	FolderOpenIcon,
	LoaderCircleIcon,
	SparklesIcon,
	TerminalIcon,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
	lazy,
	type PointerEvent as ReactPointerEvent,
	Suspense,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { AssistantMarkdown } from "#/components/assistant-markdown";
import { ChatNavbar } from "#/components/chat-navbar";
import {
	Composer,
	type ComposerStreamingState,
	type QueuedFollowUp,
	type StreamCommitPayload,
} from "#/components/composer";
import { CopyButton } from "#/components/copy-button";
import { SessionToolsPane } from "#/components/session-tools-pane";
import { ToolCallGroup } from "#/components/tool-call-group";
import { Bubble, BubbleContent } from "#/components/ui/bubble";
import { Button, buttonVariants } from "#/components/ui/button";
import { Collapsible, CollapsibleTrigger } from "#/components/ui/collapsible";
import {
	Message,
	MessageContent,
	MessageFooter,
} from "#/components/ui/message";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
	useMessageScrollerScrollable,
} from "#/components/ui/message-scroller";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
} from "#/components/ui/sheet";
import { useIsMobile } from "#/hooks/use-mobile";
import type {
	AssistantMessagePart,
	StreamToolCall,
} from "#/lib/agent-message-parts";
import { partsToText, partsToTools } from "#/lib/agent-message-parts";
import { parseStoredParts } from "#/lib/agent-message-storage";
import {
	findActiveToolGroupIndex,
	groupAssistantParts,
} from "#/lib/agent-tool-presentation";
import {
	acknowledgeSessionMessages,
	listPendingSessionMessages,
	seedSessionMessages,
} from "#/lib/chat-session-cache";
import { cn } from "#/lib/utils";

const EditToolPart = lazy(() =>
	import("#/components/edit-tool-diff").then((m) => ({
		default: m.EditToolPart,
	})),
);

function EditToolSkeleton() {
	return (
		<div className="flex h-10 w-full items-center gap-2 rounded-md border bg-card px-3 text-muted-foreground text-sm">
			<LoaderCircleIcon className="size-3.5 shrink-0 animate-spin" />
			<span>Loading diff…</span>
		</div>
	);
}

type ChatMessage = {
	id: string | number;
	role: "user" | "assistant";
	content: string;
	createdAt?: Date | string | number | null;
	model?: string | null;
	/** pending | complete | failed — failed rows keep partial content/tools. */
	status?: "pending" | "complete" | "failed" | null;
	tools?: StreamToolCall[] | string | null;
	parts?: AssistantMessagePart[] | string | null;
};

type NormalizedChatMessage = Omit<ChatMessage, "tools" | "parts"> & {
	tools?: StreamToolCall[];
	parts?: AssistantMessagePart[];
};

const EMPTY_MESSAGES: ChatMessage[] = [];

type ChatProps = {
	projectId?: string;
	sessionId?: string | null;
	branchName?: string | null;
	gitExportEnabled?: boolean;
	disabledReason?: string;
	messages?: ChatMessage[];
	/** True when older pages remain on the server. */
	hasMoreHistory?: boolean;
	isLoadingMoreHistory?: boolean;
	/** Fetch the next older page (infinite query). */
	onLoadEarlier?: () => void;
	onWorkspaceRefresh?: (sessionId: string) => void;
};

/**
 * Compact top control + near-top auto-fetch for earlier history.
 * Must render under MessageScrollerProvider for scrollable state.
 * Does not force scroll-to-bottom; MessageScroller preserves prepend anchors.
 */
function LoadEarlierHistory({
	hasMoreHistory,
	isLoadingMoreHistory,
	onLoadEarlier,
}: {
	hasMoreHistory?: boolean;
	isLoadingMoreHistory?: boolean;
	onLoadEarlier?: () => void;
}) {
	const scrollable = useMessageScrollerScrollable();
	const requestedRef = useRef(false);

	useEffect(() => {
		if (!hasMoreHistory || !onLoadEarlier) {
			requestedRef.current = false;
			return;
		}
		if (isLoadingMoreHistory) {
			return;
		}
		// start === false means the viewport is near the top.
		if (scrollable.start === false && !requestedRef.current) {
			requestedRef.current = true;
			onLoadEarlier();
			return;
		}
		if (scrollable.start !== false) {
			requestedRef.current = false;
		}
	}, [scrollable.start, hasMoreHistory, isLoadingMoreHistory, onLoadEarlier]);

	if (!hasMoreHistory) {
		return null;
	}

	return (
		<div className="flex justify-center pt-14 pb-1">
			<Button
				type="button"
				size="sm"
				variant="ghost"
				className="text-muted-foreground"
				disabled={isLoadingMoreHistory}
				onClick={() => {
					requestedRef.current = true;
					onLoadEarlier?.();
				}}
			>
				{isLoadingMoreHistory ? (
					<>
						<LoaderCircleIcon className="size-3.5 animate-spin" />
						Loading earlier messages…
					</>
				) : (
					"Load earlier messages"
				)}
			</Button>
		</div>
	);
}

function normalizeMessage(message: ChatMessage): NormalizedChatMessage {
	const parts =
		(Array.isArray(message.parts) ? message.parts : undefined) ??
		parseStoredParts(message.parts ?? message.tools, message.content);
	return {
		...message,
		parts,
		tools: parts ? partsToTools(parts) : undefined,
	};
}

type MessageOverlay = {
	sessionId: string;
	messages: ChatMessage[];
};

const messageTimeFormatter = new Intl.DateTimeFormat(undefined, {
	hour: "numeric",
	minute: "2-digit",
});

function formatMessageTime(value: ChatMessage["createdAt"]): string | null {
	if (!value) {
		return null;
	}

	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) {
		return null;
	}

	return messageTimeFormatter.format(date);
}

const SUGGESTIONS = [
	{
		icon: <CodeIcon className="size-4 text-blue-500" />,
		title: "Analyze codebase",
		description: "Inspect project files and technologies",
		prompt:
			"Please analyze the workspace structure and tell me what technologies are used.",
	},
	{
		icon: <TerminalIcon className="size-4 text-emerald-500" />,
		title: "Run unit tests",
		description: "Execute and check test suites",
		prompt: "Run all unit tests in the workspace and let me know the results.",
	},
	{
		icon: <SparklesIcon className="size-4 text-purple-500" />,
		title: "Scan syntax & lint",
		description: "Find lint warnings or type errors",
		prompt:
			"Run typecheck and linter, and let me know if there are any issues.",
	},
	{
		icon: <BotIcon className="size-4 text-amber-500" />,
		title: "Review changes",
		description: "Summarize the current git diff",
		prompt:
			"What are the current uncommitted changes in this branch? Please review them.",
	},
];

function ChatEmptyState({
	hasProject,
	disabled = false,
	onSelectSuggestion,
}: {
	hasProject: boolean;
	disabled?: boolean;
	onSelectSuggestion?: (text: string) => void;
}) {
	if (!hasProject) {
		return (
			<div className="flex min-h-[45vh] flex-col items-center justify-center px-6 text-center">
				<div className="flex max-w-sm flex-col items-center gap-4 animate-in fade-in-50 slide-in-from-bottom-2 duration-300">
					<div className="flex size-14 items-center justify-center rounded-2xl border border-border/60 bg-muted/30 shadow-xs">
						<FolderOpenIcon className="size-6 text-muted-foreground/80" />
					</div>
					<div className="flex flex-col gap-1.5">
						<h2 className="font-semibold text-base text-foreground tracking-tight text-balance">
							No Active Project
						</h2>
						<p className="text-balance text-muted-foreground text-xs/relaxed">
							Open or select a project from the sidebar to start building,
							chatting, and executing commands with Ditto.
						</p>
					</div>
					<Link
						to="/"
						className={cn(
							buttonVariants({ variant: "default", size: "sm" }),
							"mt-2 cursor-pointer transition-transform active:scale-[0.98]",
						)}
					>
						Go to Dashboard
					</Link>
				</div>
			</div>
		);
	}

	return (
		<div className="flex min-h-[45vh] flex-col items-center justify-center px-6 text-center animate-in fade-in-50 slide-in-from-bottom-2 duration-300">
			<div className="flex max-w-xl flex-col items-center gap-3">
				<div className="flex size-14 items-center justify-center rounded-2xl border border-primary/10 bg-primary/5 dark:bg-primary/10 shadow-xs">
					<BotIcon className="size-6 text-primary" />
				</div>
				<div className="flex flex-col gap-1.5 mb-6">
					<h2 className="font-semibold text-xl text-foreground tracking-tight text-balance">
						How can Ditto help you today?
					</h2>
					<p className="text-pretty text-muted-foreground text-xs/relaxed max-w-md">
						Ask anything about your workspace. Ditto can run terminal commands,
						execute code, check tests, and inspect codebases.
					</p>
				</div>

				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 w-full max-w-lg">
					{SUGGESTIONS.map((item, idx) => (
						<button
							key={item.title}
							type="button"
							disabled={disabled}
							onClick={() => {
								if (disabled) return;
								onSelectSuggestion?.(item.prompt);
							}}
							className={cn(
								"flex items-start gap-3 rounded-xl border border-border/80 bg-card/40 p-3.5 text-left transition-[transform,colors,box-shadow] duration-200",
								disabled
									? "cursor-not-allowed opacity-50"
									: "hover:-translate-y-[1px] hover:border-foreground/20 hover:bg-card hover:shadow-xs active:scale-[0.97] cursor-pointer",
							)}
							style={{
								animationDelay: `${idx * 40}ms`,
							}}
						>
							<div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/50">
								{item.icon}
							</div>
							<div className="flex flex-col min-w-0">
								<span className="block font-medium text-xs text-foreground tracking-tight">
									{item.title}
								</span>
								<span className="block text-[11px] text-muted-foreground mt-0.5 leading-normal text-pretty">
									{item.description}
								</span>
							</div>
						</button>
					))}
				</div>
			</div>
		</div>
	);
}

function AssistantParts({
	parts,
	streaming = false,
}: {
	parts: AssistantMessagePart[];
	streaming?: boolean;
}) {
	if (parts.length === 0) {
		return (
			<p
				className={cn("text-muted-foreground text-sm", streaming && "shimmer")}
			>
				{streaming ? "Thinking…" : "No response was generated."}
			</p>
		);
	}

	const groups = groupAssistantParts(parts);
	const activeToolGroupIndex = findActiveToolGroupIndex(groups, streaming);

	return (
		<div className="flex w-full min-w-0 flex-col gap-3">
			{groups.map((group, index) => {
				if (group.type === "text") {
					return (
						<div key={group.id} className="w-full min-w-0">
							<AssistantMarkdown
								mode={streaming ? "streaming" : "static"}
								text={group.text}
							/>
						</div>
					);
				}

				if (group.type === "edit") {
					return (
						<div key={group.id} className="w-full min-w-0">
							<Suspense fallback={<EditToolSkeleton />}>
								<EditToolPart tool={group.tool} />
							</Suspense>
						</div>
					);
				}

				return (
					<div key={group.id} className="w-full min-w-0">
						<ToolCallGroup
							tools={group.tools}
							active={index === activeToolGroupIndex}
						/>
					</div>
				);
			})}
		</div>
	);
}

function StreamingAssistantRow({
	streaming,
}: {
	streaming: ComposerStreamingState;
}) {
	return (
		<Message align="start">
			<MessageContent className="group w-full max-w-none">
				<AssistantParts parts={streaming.parts} streaming />
			</MessageContent>
		</Message>
	);
}

/** Collapse long user bubbles so a 10k-word paste doesn't own the thread. */
const LONG_USER_MESSAGE_CHARS = 600;
/** Strong ease-out (Emil) — snappy start, soft settle. */
const LONG_MSG_EASE = "cubic-bezier(0.23,1,0.32,1)";

function UserMessageBody({ text }: { text: string }) {
	const [open, setOpen] = useState(false);

	if (text.length <= LONG_USER_MESSAGE_CHARS) {
		return <p className="whitespace-pre-wrap text-sm/relaxed">{text}</p>;
	}

	return (
		<Collapsible className="w-full min-w-0" open={open} onOpenChange={setOpen}>
			<div className="relative">
				<div
					className={cn(
						"overflow-hidden transition-[max-height] duration-200 motion-reduce:transition-none",
						open ? "max-h-[min(200vh,120rem)]" : "max-h-36",
					)}
					style={{ transitionTimingFunction: LONG_MSG_EASE }}
				>
					<p className="whitespace-pre-wrap text-sm/relaxed">{text}</p>
				</div>
				<div
					aria-hidden
					className={cn(
						"pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-secondary to-transparent transition-opacity duration-200 motion-reduce:transition-none",
						open ? "opacity-0" : "opacity-100",
					)}
					style={{ transitionTimingFunction: LONG_MSG_EASE }}
				/>
				<div
					className={cn(
						"flex justify-center transition-[padding] duration-200 motion-reduce:transition-none",
						open ? "pt-1.5" : "absolute inset-x-0 bottom-0 pb-1",
					)}
					style={{ transitionTimingFunction: LONG_MSG_EASE }}
				>
					<CollapsibleTrigger
						aria-label={open ? "Show less" : "Show more"}
						className={cn(
							buttonVariants({ variant: "ghost", size: "xs" }),
							"relative z-10 bg-secondary/80 text-secondary-foreground backdrop-blur-[2px]",
							"transition-[transform,background-color,opacity] duration-150 ease-out",
							"hover:bg-secondary active:scale-[0.97]",
							"motion-reduce:transition-none motion-reduce:active:scale-100",
						)}
					>
						<span className="relative inline-grid place-items-center">
							<span
								className={cn(
									"col-start-1 row-start-1 transition-[opacity,transform,filter] duration-150 ease-out motion-reduce:transition-none",
									open
										? "scale-95 opacity-0 blur-[2px]"
										: "scale-100 opacity-100 blur-0",
								)}
							>
								Show more
							</span>
							<span
								aria-hidden={!open}
								className={cn(
									"col-start-1 row-start-1 transition-[opacity,transform,filter] duration-150 ease-out motion-reduce:transition-none",
									open
										? "scale-100 opacity-100 blur-0"
										: "scale-95 opacity-0 blur-[2px]",
								)}
							>
								Show less
							</span>
						</span>
					</CollapsibleTrigger>
				</div>
			</div>
		</Collapsible>
	);
}

function QueuedFollowUpRow({ queued }: { queued: QueuedFollowUp }) {
	return (
		<Message align="end">
			<MessageContent className="group">
				<Bubble align="end" variant="secondary">
					<BubbleContent className="w-full max-w-none">
						<UserMessageBody text={queued.text} />
					</BubbleContent>
				</Bubble>
				<MessageFooter>
					<span className="text-muted-foreground">Queued</span>
				</MessageFooter>
			</MessageContent>
		</Message>
	);
}

function MessageRow({ message }: { message: NormalizedChatMessage }) {
	const time = formatMessageTime(message.createdAt);

	if (message.role === "assistant") {
		const parts =
			message.parts ??
			(message.content
				? ([
						{
							type: "text",
							id: `legacy-${message.id}`,
							text: message.content,
						},
					] as AssistantMessagePart[])
				: []);
		const copyText = partsToText(parts) || message.content;

		return (
			<Message align="start">
				<MessageContent className="group w-full max-w-none">
					<AssistantParts parts={parts} />
					{message.status === "failed" ? (
						<p className="mt-1 text-destructive text-xs">
							Response interrupted — partial output saved.
						</p>
					) : null}
					<MessageFooter className="gap-1.5 px-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100">
						{copyText ? <CopyButton value={copyText} /> : null}
						{message.model ? <span>Model: {message.model}</span> : null}
						{time ? <span className="tabular-nums">{time}</span> : null}
					</MessageFooter>
				</MessageContent>
			</Message>
		);
	}

	return (
		<Message align="end">
			<MessageContent className="group">
				<Bubble align="end" variant="secondary">
					<BubbleContent className="w-full max-w-none">
						<UserMessageBody text={message.content} />
					</BubbleContent>
				</Bubble>
				<MessageFooter className="gap-1.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100">
					{message.content ? <CopyButton value={message.content} /> : null}
					{time ? <span className="tabular-nums">{time}</span> : null}
				</MessageFooter>
			</MessageContent>
		</Message>
	);
}

function mergeMessages(
	serverMessages: NormalizedChatMessage[],
	overlay: MessageOverlay | null,
	activeSessionId: string | null | undefined,
): NormalizedChatMessage[] {
	if (!overlay) {
		return serverMessages;
	}

	const sessionMatches =
		!activeSessionId || overlay.sessionId === activeSessionId;
	if (!sessionMatches) {
		return serverMessages;
	}

	const serverIds = new Set(
		serverMessages.map((message) => String(message.id)),
	);
	const extras: NormalizedChatMessage[] = [];
	for (const message of overlay.messages) {
		if (!serverIds.has(String(message.id))) {
			extras.push(normalizeMessage(message));
		}
	}
	if (extras.length === 0) {
		return serverMessages;
	}

	return [...serverMessages, ...extras];
}

function pendingOverlay(
	activeSessionId: string | null | undefined,
	serverMessages: ChatMessage[],
): MessageOverlay | null {
	if (!activeSessionId) {
		return null;
	}
	const pending = listPendingSessionMessages(activeSessionId, serverMessages);
	if (pending.length === 0) {
		return null;
	}
	return { sessionId: activeSessionId, messages: pending };
}

export function Chat({
	projectId,
	sessionId,
	branchName,
	gitExportEnabled = false,
	disabledReason,
	messages = EMPTY_MESSAGES,
	hasMoreHistory = false,
	isLoadingMoreHistory = false,
	onLoadEarlier,
	onWorkspaceRefresh,
}: ChatProps) {
	const [streaming, setStreaming] = useState<ComposerStreamingState | null>(
		null,
	);
	const [inputText, setInputText] = useState("");
	const [bridgeSessionId, setBridgeSessionId] = useState<string | null>(null);
	// Bumps when session-cache module state changes so memos re-read overlays.
	const [cacheEpoch, setCacheEpoch] = useState(0);

	const cacheSessionId = sessionId ?? bridgeSessionId;
	const normalizedServerMessages = useMemo(
		() => messages.map(normalizeMessage),
		[messages],
	);

	// Prune confirmed optimistic entries when server ids change.
	// Display already filters via listPending; this only trims module cache.
	const ackIdsKey = messages.map((message) => String(message.id)).join("\0");
	const lastAckRef = useRef<{ sessionId: string; idsKey: string } | null>(null);
	useEffect(() => {
		if (!cacheSessionId || messages.length === 0) return;
		if (
			lastAckRef.current?.sessionId === cacheSessionId &&
			lastAckRef.current?.idsKey === ackIdsKey
		) {
			return;
		}
		lastAckRef.current = { sessionId: cacheSessionId, idsKey: ackIdsKey };
		acknowledgeSessionMessages(
			cacheSessionId,
			messages.map((message) => message.id),
		);
	}, [ackIdsKey, cacheSessionId, messages]);

	// cacheEpoch forces recompute when seed mutates module cache.
	const overlay = useMemo(() => {
		void cacheEpoch;
		return pendingOverlay(cacheSessionId, messages);
	}, [cacheSessionId, messages, cacheEpoch]);
	const displayMessages = useMemo(
		() => mergeMessages(normalizedServerMessages, overlay, cacheSessionId),
		[normalizedServerMessages, overlay, cacheSessionId],
	);
	const displayIds = useMemo(
		() => new Set(displayMessages.map((message) => String(message.id))),
		[displayMessages],
	);

	const showOptimisticUser =
		Boolean(streaming?.active) &&
		Boolean(streaming?.userText) &&
		(!streaming?.userMessageId ||
			!displayIds.has(String(streaming.userMessageId)));
	const showStreamingAssistant =
		Boolean(streaming?.active) &&
		(!streaming?.assistantMessageId ||
			!displayIds.has(String(streaming.assistantMessageId)));
	const queuedFollowUps = streaming?.queuedFollowUps ?? [];
	const hasStreamingTail =
		showOptimisticUser || showStreamingAssistant || queuedFollowUps.length > 0;
	const hasMessages =
		displayMessages.length > 0 ||
		showOptimisticUser ||
		showStreamingAssistant ||
		queuedFollowUps.length > 0;

	function handleStreamCommit(payload: StreamCommitPayload): void {
		seedSessionMessages(payload.sessionId, [
			payload.user,
			{
				...payload.assistant,
				parts: payload.assistant.parts,
				tools: payload.assistant.tools,
			},
		]);
		setBridgeSessionId(payload.sessionId);
		setCacheEpoch((epoch) => epoch + 1);
	}

	const [toolsOpen, setToolsOpen] = useState(false);
	// Pixel width of the desktop tools rail; null until first open measures the shell.
	const [toolsWidthPx, setToolsWidthPx] = useState<number | null>(null);
	const [toolsResizing, setToolsResizing] = useState(false);
	const toolsShellRef = useRef<HTMLDivElement>(null);
	const isMobile = useIsMobile();
	const reduceMotion = useReducedMotion();
	const toolsEnabled = Boolean(projectId && sessionId && !disabledReason);

	// Close tools when workspace becomes unavailable so the pane does not
	// silently reopen after readiness returns.
	useEffect(() => {
		if (disabledReason) {
			setToolsOpen(false);
		}
	}, [disabledReason]);
	const desktopToolsVisible =
		toolsEnabled && toolsOpen && Boolean(projectId && sessionId) && !isMobile;
	// Drawer ease (Emil/Ionic). Instant while dragging or reduce-motion.
	const toolsPaneTransition = {
		duration: reduceMotion || toolsResizing ? 0 : 0.2,
		ease: [0.32, 0.72, 0, 1] as const,
	};

	useLayoutEffect(() => {
		if (!desktopToolsVisible || toolsWidthPx != null) return;
		const shell = toolsShellRef.current?.offsetWidth ?? 0;
		if (shell <= 0) return;
		setToolsWidthPx(Math.round(shell * 0.68));
	}, [desktopToolsVisible, toolsWidthPx]);

	const onToolsResizePointerDown = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			if (toolsWidthPx == null) return;
			event.preventDefault();
			const handle = event.currentTarget;
			const startX = event.clientX;
			const startWidth = toolsWidthPx;
			const shell = toolsShellRef.current?.offsetWidth ?? 0;
			const minWidth = shell * 0.4;
			const maxWidth = shell * 0.78;
			handle.setPointerCapture(event.pointerId);
			setToolsResizing(true);

			const onMove = (moveEvent: PointerEvent) => {
				const next = startWidth + (startX - moveEvent.clientX);
				setToolsWidthPx(
					Math.round(Math.min(maxWidth, Math.max(minWidth, next))),
				);
			};
			const onUp = (upEvent: PointerEvent) => {
				handle.releasePointerCapture(upEvent.pointerId);
				handle.removeEventListener("pointermove", onMove);
				handle.removeEventListener("pointerup", onUp);
				handle.removeEventListener("pointercancel", onUp);
				setToolsResizing(false);
			};
			handle.addEventListener("pointermove", onMove);
			handle.addEventListener("pointerup", onUp);
			handle.addEventListener("pointercancel", onUp);
		},
		[toolsWidthPx],
	);

	const chatColumn = (
		<div className="mx-auto flex h-full min-h-0 w-full min-w-0 flex-col">
			<ChatNavbar
				projectId={projectId}
				sessionId={sessionId}
				branchName={branchName}
				gitExportEnabled={gitExportEnabled}
				disabled={Boolean(disabledReason) || Boolean(streaming?.active)}
				toolsOpen={toolsOpen}
				onToolsOpenChange={setToolsOpen}
			/>
			<MessageScrollerProvider
				autoScroll
				defaultScrollPosition="last-anchor"
				scrollPreviousItemPeek={64}
			>
				<MessageScroller className="h-auto min-h-0 flex-1">
					<MessageScrollerViewport>
						<MessageScrollerContent
							className={cn(
								"mx-auto w-full max-w-2xl gap-4 px-5 sm:px-6",
								!hasMessages && "justify-center",
							)}
						>
							{hasMessages ? (
								<>
									<LoadEarlierHistory
										hasMoreHistory={hasMoreHistory}
										isLoadingMoreHistory={isLoadingMoreHistory}
										onLoadEarlier={onLoadEarlier}
									/>
									{displayMessages.map((message, index) => (
										<MessageScrollerItem
											key={message.id}
											messageId={`message-${message.id}`}
											className={cn(
												"m-0",
												index === displayMessages.length - 1 &&
													!hasStreamingTail &&
													"mb-20",
											)}
											scrollAnchor={message.role === "user"}
										>
											<MessageRow message={message} />
										</MessageScrollerItem>
									))}
									{showOptimisticUser && streaming ? (
										<MessageScrollerItem
											messageId="streaming-user"
											className={cn("m-0", !showStreamingAssistant && "mb-20")}
											scrollAnchor
										>
											<MessageRow
												message={{
													id: streaming.userMessageId ?? "streaming-user",
													role: "user",
													content: streaming.userText,
												}}
											/>
										</MessageScrollerItem>
									) : null}
									{showStreamingAssistant && streaming ? (
										<MessageScrollerItem
											messageId="streaming-assistant"
											className={cn(
												"m-0",
												queuedFollowUps.length === 0 && "mb-20",
											)}
										>
											<StreamingAssistantRow streaming={streaming} />
										</MessageScrollerItem>
									) : null}
									{queuedFollowUps.length > 0 ? (
										<>
											<output className="sr-only" aria-live="polite">
												{queuedFollowUps.length} message
												{queuedFollowUps.length === 1 ? "" : "s"} queued
											</output>
											{queuedFollowUps.map((queued, index) => (
												<MessageScrollerItem
													key={queued.requestId}
													messageId={`queued-${queued.requestId}`}
													className={cn(
														"m-0",
														index === queuedFollowUps.length - 1 && "mb-20",
													)}
													scrollAnchor
												>
													<QueuedFollowUpRow queued={queued} />
												</MessageScrollerItem>
											))}
										</>
									) : null}
								</>
							) : (
								<MessageScrollerItem messageId="empty-conversation">
									<ChatEmptyState
										hasProject={Boolean(projectId || sessionId)}
										disabled={Boolean(disabledReason)}
										onSelectSuggestion={(prompt) => {
											setInputText(prompt);
											setTimeout(() => {
												const textarea = document.querySelector(
													'textarea[name="message"]',
												) as HTMLTextAreaElement | null;
												textarea?.focus();
											}, 50);
										}}
									/>
								</MessageScrollerItem>
							)}
						</MessageScrollerContent>
					</MessageScrollerViewport>
					<div className="relative shrink-0">
						<MessageScrollerButton className="data-[direction=end]:bottom-full data-[direction=end]:mb-2" />
						<Composer
							projectId={projectId}
							sessionId={sessionId}
							disabledReason={disabledReason}
							onStreamingChange={setStreaming}
							onStreamCommit={handleStreamCommit}
							onWorkspaceRefresh={onWorkspaceRefresh}
							inputText={inputText}
							onInputTextChange={setInputText}
						/>
					</div>
				</MessageScroller>
			</MessageScrollerProvider>
		</div>
	);

	return (
		<div
			ref={toolsShellRef}
			className="flex h-full min-h-0 w-full min-w-0 overflow-hidden"
		>
			{/* Chat always flex-1; tools rail width tween is what expands/collapses it. */}
			<div className="min-h-0 min-w-0 flex-1">{chatColumn}</div>
			{/* Clipped-width rail: outer width animates, inner stays fixed so content
			    doesn't reflow mid-tween. Avoids flex-grow/minSize threshold snaps. */}
			<AnimatePresence initial={false}>
				{desktopToolsVisible &&
				toolsWidthPx != null &&
				projectId &&
				sessionId ? (
					<motion.aside
						key="desktop-tools"
						initial={{ width: 0 }}
						animate={{ width: toolsWidthPx }}
						exit={{ width: 0 }}
						transition={toolsPaneTransition}
						className="relative h-full shrink-0 overflow-hidden"
					>
						<div
							className="absolute inset-y-0 right-0 flex h-full"
							style={{ width: toolsWidthPx }}
						>
							{/* Drag the left edge to resize */}
							<div
								role="separator"
								aria-orientation="vertical"
								aria-label="Resize tools panel"
								tabIndex={0}
								onPointerDown={onToolsResizePointerDown}
								className={cn(
									"relative z-20 w-0 shrink-0 cursor-col-resize touch-none border-0 bg-transparent",
									"after:absolute after:inset-y-0 after:left-0 after:w-3 after:translate-x-[-50%] after:bg-transparent after:transition-colors",
									"hover:after:bg-border/50 active:after:bg-border/70",
									"focus-visible:outline-none focus-visible:ring-0",
								)}
							/>
							<div className="h-full min-h-0 min-w-0 flex-1 p-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
								<SessionToolsPane
									projectId={projectId}
									sessionId={sessionId}
									className="h-full"
									onClose={() => setToolsOpen(false)}
								/>
							</div>
						</div>
					</motion.aside>
				) : null}
			</AnimatePresence>
			{toolsEnabled && projectId && sessionId ? (
				<Sheet open={toolsOpen && isMobile} onOpenChange={setToolsOpen}>
					<SheetContent
						side="right"
						showCloseButton={false}
						className="flex w-full flex-col gap-0 bg-transparent p-2 data-[side=right]:w-[min(100%,48rem)] data-[side=right]:sm:max-w-none"
					>
						<SheetHeader className="sr-only">
							<SheetTitle>Session tools</SheetTitle>
						</SheetHeader>
						{toolsOpen && isMobile ? (
							<SessionToolsPane
								projectId={projectId}
								sessionId={sessionId}
								className="h-full"
								onClose={() => setToolsOpen(false)}
							/>
						) : null}
					</SheetContent>
				</Sheet>
			) : null}
		</div>
	);
}
