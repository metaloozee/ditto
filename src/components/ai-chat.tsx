import { ChevronRightIcon, LoaderCircleIcon } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Task, TaskContent, TaskTrigger } from "#/components/ai-elements/task";
import { AssistantMarkdown } from "#/components/assistant-markdown";
import {
	Composer,
	type ComposerStreamingState,
	type StreamCommitPayload,
} from "#/components/composer";
import { Bubble, BubbleContent } from "#/components/ui/bubble";
import { Button } from "#/components/ui/button";
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
import type {
	AssistantMessagePart,
	StreamToolCall,
} from "#/lib/agent-message-parts";
import { partsToTools } from "#/lib/agent-message-parts";
import { parseStoredParts } from "#/lib/agent-message-storage";
import {
	formatToolCallLabel,
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
		<div className="flex justify-center pt-4 pb-1">
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

function ChatEmptyState({ hasProject }: { hasProject: boolean }) {
	return (
		<div className="flex min-h-[40vh] flex-col items-center justify-center px-6 text-center">
			<div className="max-w-sm flex flex-col gap-3">
				<p className="font-medium text-sm">
					{hasProject
						? "Start the first message for this workspace."
						: "Open a project to start chatting."}
				</p>
				<p className="text-balance text-muted-foreground text-xs/relaxed">
					{hasProject
						? "Messages are stored in D1; new prompts stream live agent output here."
						: "Sent messages are stored in D1 and replayed here as a simple conversation history."}
				</p>
			</div>
		</div>
	);
}

function ToolGroupPart({
	tools,
	streaming = false,
}: {
	tools: StreamToolCall[];
	streaming?: boolean;
}) {
	const working = tools.some((tool) => tool.status === "running");
	const title = working ? "Working" : "Worked";

	return (
		<Task defaultOpen={streaming && working}>
			<TaskTrigger title={title}>
				<div className="flex w-full cursor-pointer items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground">
					{working ? (
						<LoaderCircleIcon className="size-3.5 shrink-0 animate-spin" />
					) : null}
					<span className="min-w-0 flex-1 truncate font-medium">{title}</span>
					<ChevronRightIcon className="size-3.5 shrink-0 transition-transform group-data-[panel-open]:rotate-90" />
				</div>
			</TaskTrigger>
			<TaskContent>
				<div className="max-h-48 overflow-y-auto overscroll-contain pr-1">
					<ul className="flex flex-col gap-1">
						{tools.map((tool) => {
							const label = formatToolCallLabel(tool);
							const failed = tool.status === "error";
							return (
								<li
									key={tool.id}
									className={cn(
										"truncate font-mono text-[12px] leading-relaxed",
										failed ? "text-destructive" : "text-muted-foreground",
									)}
									title={label}
								>
									{label}
								</li>
							);
						})}
					</ul>
				</div>
			</TaskContent>
		</Task>
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
			<p className="text-muted-foreground text-sm">
				{streaming ? "Thinking…" : "No response was generated."}
			</p>
		);
	}

	const groups = groupAssistantParts(parts);

	return (
		<div className="flex w-full min-w-0 flex-col gap-3">
			{groups.map((group) => {
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
						<ToolGroupPart tools={group.tools} streaming={streaming} />
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

		return (
			<Message align="start">
				<MessageContent className="group w-full max-w-none">
					<AssistantParts parts={parts} />
					{message.status === "failed" ? (
						<p className="mt-1 text-destructive text-xs">
							Response interrupted — partial output saved.
						</p>
					) : null}
					<MessageFooter className="px-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
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
						<p className="whitespace-pre-wrap text-sm/relaxed">
							{message.content}
						</p>
					</BubbleContent>
				</Bubble>
				<MessageFooter className="opacity-0 transition-opacity duration-200 group-hover:opacity-100">
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
	const [bridgeSessionId, setBridgeSessionId] = useState<string | null>(null);
	// Bumps when session-cache module state changes so memos re-read overlays.
	const [cacheEpoch, setCacheEpoch] = useState(0);

	const cacheSessionId = sessionId ?? bridgeSessionId;
	const normalizedServerMessages = useMemo(
		() => messages.map(normalizeMessage),
		[messages],
	);

	// After server messages refresh, drop matching optimistic cache entries.
	// Acknowledgement uses all loaded server IDs (flattened infinite pages).
	useEffect(() => {
		if (!cacheSessionId || messages.length === 0) {
			return;
		}
		const removed = acknowledgeSessionMessages(
			cacheSessionId,
			messages.map((message) => message.id),
		);
		if (removed) {
			setCacheEpoch((epoch) => epoch + 1);
		}
	}, [cacheSessionId, messages]);

	// cacheEpoch forces recompute when acknowledge/seed mutates module cache.
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
	const hasStreamingTail = showOptimisticUser || showStreamingAssistant;
	const hasMessages =
		displayMessages.length > 0 || showOptimisticUser || showStreamingAssistant;

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

	return (
		<div className="relative mx-auto h-full w-full">
			<MessageScrollerProvider
				autoScroll
				defaultScrollPosition="last-anchor"
				scrollPreviousItemPeek={64}
			>
				<MessageScroller>
					<MessageScrollerViewport>
						<MessageScrollerContent
							className={cn(
								"mx-auto max-w-2xl gap-4",
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
												index === 0 && !hasMoreHistory && "mt-20",
												index === 0 && hasMoreHistory && "mt-2",
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
											className={cn(
												"mt-0",
												displayMessages.length === 0 && "mt-20",
												!showStreamingAssistant && "mb-20",
											)}
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
												"mt-0",
												displayMessages.length === 0 &&
													!showOptimisticUser &&
													"mt-20",
												"mb-20",
											)}
										>
											<StreamingAssistantRow streaming={streaming} />
										</MessageScrollerItem>
									) : null}
								</>
							) : (
								<MessageScrollerItem messageId="empty-conversation">
									<ChatEmptyState
										hasProject={Boolean(projectId || sessionId)}
									/>
								</MessageScrollerItem>
							)}
						</MessageScrollerContent>
					</MessageScrollerViewport>
					<MessageScrollerButton className="mb-40" />
					<Composer
						projectId={projectId}
						sessionId={sessionId}
						branchName={branchName}
						gitExportEnabled={gitExportEnabled}
						disabledReason={disabledReason}
						onStreamingChange={setStreaming}
						onStreamCommit={handleStreamCommit}
						onWorkspaceRefresh={onWorkspaceRefresh}
					/>
				</MessageScroller>
			</MessageScrollerProvider>
		</div>
	);
}
