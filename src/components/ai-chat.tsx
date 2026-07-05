import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangleIcon,
	BotIcon,
	BrushCleaningIcon,
	CheckCircle2Icon,
	CircleDotDashedIcon,
	EyeIcon,
	FilePenLineIcon,
	WrenchIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Streamdown } from "streamdown";
import { Composer } from "#/components/composer";
import { DiffReview } from "#/components/diff-review";
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
} from "#/components/ui/message-scroller";
import type { WorkspaceSessionSocketState } from "#/hooks/use-workspace-session-socket";
import { useTRPC } from "#/integrations/trpc/react";
import { cn } from "#/lib/utils";
import type { AgentRunEventType } from "#/lib/workspace-policy";

type ChatEvent = {
	id: number;
	type: AgentRunEventType;
	payload: string;
	runId?: string | null;
	createdAt?: Date | string | number | null;
};

type ChatProps = {
	projectId?: string;
	sessionId?: string | null;
	activeRunId?: string | null;
	disabledReason?: string;
	events?: ChatEvent[];
	socketState?: WorkspaceSessionSocketState;
};

type EventPayload = {
	role?: string;
	text?: string;
	message?: string;
	status?: string;
	reason?: string;
	command?: string;
	output?: string;
	path?: string;
	filePath?: string;
	tool?: string;
	toolName?: string;
	error?: string;
	schemaVersion?: number;
	artifactId?: string | null;
	changedFiles?: string[];
	byteLength?: number;
	hasArtifact?: boolean;
	truncated?: boolean;
	[key: string]: unknown;
};

type BubbleVariant =
	| "default"
	| "secondary"
	| "muted"
	| "outline"
	| "ghost"
	| "destructive";

type EventMeta = {
	align: "start" | "end";
	variant: BubbleVariant;
	isLog: boolean;
};

const eventTimeFormatter = new Intl.DateTimeFormat(undefined, {
	hour: "numeric",
	minute: "2-digit",
});

function parseEventPayload(payload: string): EventPayload {
	try {
		const parsed = JSON.parse(payload);

		return parsed && typeof parsed === "object" ? (parsed as EventPayload) : {};
	} catch {
		return { text: payload };
	}
}

function stringifyPayloadValue(value: unknown): string | null {
	if (typeof value === "string" && value.trim()) {
		return value;
	}

	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}

	return null;
}

function getEventText(event: ChatEvent, payload: EventPayload): string {
	const directText =
		stringifyPayloadValue(payload.text) ??
		stringifyPayloadValue(payload.message) ??
		stringifyPayloadValue(payload.output) ??
		stringifyPayloadValue(payload.error);

	if (directText) {
		return directText;
	}

	switch (event.type) {
		case "tool_started":
			return `Started ${payload.toolName ?? payload.tool ?? "tool"}.`;
		case "tool_finished":
			return `Finished ${payload.toolName ?? payload.tool ?? "tool"}.`;
		case "file_changed":
			return `Changed ${payload.filePath ?? payload.path ?? "a file"}.`;
		case "diff_ready":
			if (payload.hasArtifact === true) {
				return "Diff is ready.";
			}
			if (payload.truncated === true) {
				return "Diff too large to preview.";
			}
			if (typeof payload.error === "string" && payload.error.trim()) {
				return "Diff unavailable.";
			}
			return "No diff produced.";
		case "needs_input":
			return "Agent needs input.";
		case "lock_rejected":
			return "Run was rejected because another agent run is active.";
		case "done":
			return `Run ${payload.status ?? "finished"}.`;
		case "error":
			return `Error${payload.reason ? `: ${payload.reason}` : ""}.`;
		case "command_output":
			return payload.command ? `$ ${payload.command}` : "Command output.";
		case "message":
			return "Message event.";
		default:
			return "Workspace event.";
	}
}

function getEventMeta(event: ChatEvent, payload: EventPayload): EventMeta {
	if (event.type === "message" && payload.role === "user") {
		return {
			align: "end",
			variant: "default",
			isLog: false,
		};
	}

	if (event.type === "message" && payload.role === "system") {
		return {
			align: "start",
			variant: "secondary",
			isLog: false,
		};
	}

	if (event.type === "message") {
		return {
			align: "start",
			variant: "ghost",
			isLog: false,
		};
	}

	if (event.type === "error" || event.type === "lock_rejected") {
		return {
			align: "start",
			variant: "destructive",
			isLog: true,
		};
	}

	return {
		align: "start",
		variant: "muted",
		isLog: true,
	};
}

function formatEventTime(value: ChatEvent["createdAt"]): string | null {
	if (!value) {
		return null;
	}

	const date = value instanceof Date ? value : new Date(value);

	if (Number.isNaN(date.getTime())) {
		return null;
	}

	return eventTimeFormatter.format(date);
}

function isTurnAnchor(event: ChatEvent, payload: EventPayload): boolean {
	return event.type === "message" && payload.role === "user";
}

function getLatestNeedsInput(
	events: ChatEvent[],
	activeRunId: string | null | undefined,
): { runId: string; question: string } | null {
	for (const event of [...events].reverse()) {
		if (event.type !== "needs_input") {
			continue;
		}

		const payload = parseEventPayload(event.payload);
		const runId = activeRunId ?? stringifyPayloadValue(payload.runId);
		const question =
			stringifyPayloadValue(payload.question) ?? getEventText(event, payload);

		return runId ? { runId, question } : null;
	}

	return null;
}

function ActivityIcon({ type }: { type: ChatEvent["type"] }) {
	const className = "size-3.5";

	if (type === "error" || type === "lock_rejected") {
		return <AlertTriangleIcon className={className} />;
	}

	if (type === "tool_started") {
		return <CircleDotDashedIcon className={className} />;
	}

	if (type === "tool_finished") {
		return <WrenchIcon className={className} />;
	}

	if (type === "file_changed" || type === "diff_ready") {
		return <FilePenLineIcon className={className} />;
	}

	if (type === "done") {
		return <CheckCircle2Icon className={className} />;
	}

	return <BotIcon className={className} />;
}

function AssistantMarkdown({
	mode,
	text,
}: {
	mode: "static" | "streaming";
	text: string;
}) {
	return (
		<Streamdown
			className="prose prose-sm max-w-none dark:prose-invert prose-pre:my-3 prose-pre:bg-card prose-code:text-[0.85em] text-sm/relaxed"
			controls={{ code: { copy: true, download: false }, mermaid: false }}
			mode={mode}
			parseIncompleteMarkdown={mode === "streaming"}
		>
			{text}
		</Streamdown>
	);
}

function ActivityEventMessage({
	event,
	text,
	time,
	action,
}: {
	event: ChatEvent;
	text: string;
	time: string | null;
	action?: ReactNode;
}) {
	const isDestructive =
		event.type === "error" || event.type === "lock_rejected";

	return (
		<Message align="start">
			<MessageContent>
				<div
					className={cn(
						"flex w-full items-center justify-between gap-2 pb-2",
						isDestructive ? "text-destructive" : "text-muted-foreground",
					)}
				>
					<span className="flex min-w-0 items-center gap-1.5 font-mono text-[0.6875rem]">
						<ActivityIcon type={event.type} />
						<span className="truncate">{text}</span>
					</span>
					<span className="flex shrink-0 items-center gap-2">
						{action}
						{time ? (
							<span className="shrink-0 font-mono text-[0.6875rem] tabular-nums opacity-60">
								{time}
							</span>
						) : null}
					</span>
				</div>
				<hr className="m-0 border-t border-border/30" />
			</MessageContent>
		</Message>
	);
}

function DiffReadyReview({
	projectId,
	runId,
}: {
	projectId: string;
	runId: string;
}) {
	const [open, setOpen] = useState(false);

	return (
		<>
			<Button
				size="xs"
				variant="outline"
				type="button"
				onClick={() => setOpen(true)}
			>
				<EyeIcon />
				Review diff
			</Button>
			<DiffReview
				open={open}
				onOpenChange={setOpen}
				projectId={projectId}
				runId={runId}
			/>
		</>
	);
}

function ChatEventMessage({
	event,
	projectId,
	activeRunId,
}: {
	event: ChatEvent;
	projectId?: string;
	activeRunId?: string | null;
}) {
	const payload = parseEventPayload(event.payload);
	const meta = getEventMeta(event, payload);
	const text = getEventText(event, payload);
	const time = formatEventTime(event.createdAt);

	if (meta.isLog) {
		let action: ReactNode = null;
		if (event.type === "diff_ready" && payload.hasArtifact === true) {
			const runId = event.runId ?? activeRunId ?? null;
			if (projectId && runId) {
				action = <DiffReadyReview projectId={projectId} runId={runId} />;
			}
		}

		return (
			<ActivityEventMessage
				event={event}
				text={text}
				time={time}
				action={action}
			/>
		);
	}

	const isAssistant = event.type === "message" && payload.role === "assistant";

	return (
		<Message align={meta.align}>
			<MessageContent className="group">
				<Bubble align={meta.align} variant={meta.variant}>
					<BubbleContent
						className={cn(
							"text-pretty",
							isAssistant
								? "w-full max-w-none px-0 py-0"
								: "whitespace-pre-wrap",
						)}
					>
						{isAssistant ? (
							<AssistantMarkdown mode="static" text={text} />
						) : (
							text
						)}
					</BubbleContent>
				</Bubble>
				{time ? (
					<MessageFooter className="opacity-0 transition-opacity duration-200 group-hover:opacity-100">
						{time}
					</MessageFooter>
				) : null}
			</MessageContent>
		</Message>
	);
}

function TransientAssistantMessage({ text }: { text: string }) {
	return (
		<Message align="start">
			<MessageContent>
				<Bubble align="start" variant="ghost">
					<BubbleContent className="w-full max-w-none px-0 py-0">
						<AssistantMarkdown mode="streaming" text={text} />
					</BubbleContent>
				</Bubble>
				<MessageFooter>Streaming live</MessageFooter>
			</MessageContent>
		</Message>
	);
}

function NeedsInputCard({
	projectId,
	sessionId,
	runId,
	question,
}: {
	projectId?: string;
	sessionId?: string | null;
	runId: string;
	question: string;
}) {
	const [answer, setAnswer] = useState("");
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const answerMutation = useMutation(
		trpc.workspace.answerRunQuestion.mutationOptions(),
	);

	async function submitAnswer() {
		if (!answer.trim()) {
			return;
		}

		await answerMutation.mutateAsync({ runId, answer });
		setAnswer("");

		if (projectId) {
			await queryClient.invalidateQueries(
				trpc.workspace.get.queryFilter({
					projectId,
					sessionId: sessionId ?? undefined,
				}),
			);
		}
	}

	return (
		<Message align="start">
			<MessageContent>
				<div className="rounded-xl border border-primary/30 bg-card p-3 text-sm shadow-sm">
					<p className="font-medium text-foreground">Agent needs input</p>
					<p className="mt-1 text-muted-foreground text-xs leading-relaxed">
						{question}
					</p>
					<div className="mt-3 flex gap-2">
						<input
							className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-xs outline-none focus:border-primary"
							onChange={(event) => setAnswer(event.currentTarget.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									void submitAnswer();
								}
							}}
							placeholder="Answer and resume the run"
							value={answer}
						/>
						<button
							className="rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground text-xs disabled:opacity-50"
							disabled={answerMutation.isPending || !answer.trim()}
							onClick={() => void submitAnswer()}
							type="button"
						>
							Answer
						</button>
					</div>
				</div>
			</MessageContent>
		</Message>
	);
}

function ChatEmptyState({ hasProject }: { hasProject: boolean }) {
	return (
		<div className="flex min-h-full flex-col items-center justify-center gap-3 px-6 pb-32 text-center">
			<div className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
				<BrushCleaningIcon className="size-7" />
			</div>
			<div className="flex flex-col gap-1">
				<h1 className="text-balance font-medium text-sm">
					{hasProject
						? "Ready for workspace instructions"
						: "Ready when you are"}
				</h1>
				<p className="max-w-sm text-muted-foreground text-pretty text-xs/relaxed">
					Send a message to start a conversation. Messages and workspace events
					will appear here.
				</p>
			</div>
		</div>
	);
}

export function Chat({
	projectId,
	sessionId,
	activeRunId,
	disabledReason,
	events = [],
	socketState,
}: ChatProps) {
	const hasEvents = events.length > 0;
	const liveAssistantText =
		activeRunId && socketState?.liveRunId === activeRunId
			? socketState.assistantText
			: "";
	const needsInput =
		socketState?.needsInput ?? getLatestNeedsInput(events, activeRunId);

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
							aria-busy={Boolean(activeRunId)}
							className={cn(
								"gap-4 max-w-2xl mx-auto",
								!hasEvents && "justify-center",
							)}
						>
							{hasEvents ? (
								events.map((event, index) => {
									const payload = parseEventPayload(event.payload);

									return (
										<MessageScrollerItem
											key={event.id}
											messageId={`event-${event.id}`}
											scrollAnchor={isTurnAnchor(event, payload)}
											className={cn("mt-0", index === 0 && "mt-20")}
										>
											<ChatEventMessage
												event={event}
												projectId={projectId}
												activeRunId={activeRunId}
											/>
										</MessageScrollerItem>
									);
								})
							) : (
								<MessageScrollerItem messageId="empty-conversation">
									<ChatEmptyState hasProject={Boolean(projectId)} />
								</MessageScrollerItem>
							)}
							{liveAssistantText ? (
								<MessageScrollerItem messageId="live-assistant">
									<TransientAssistantMessage text={liveAssistantText} />
								</MessageScrollerItem>
							) : null}
							{needsInput ? (
								<MessageScrollerItem
									messageId={`needs-input-${needsInput.runId}`}
								>
									<NeedsInputCard
										projectId={projectId}
										sessionId={sessionId}
										runId={needsInput.runId}
										question={needsInput.question}
									/>
								</MessageScrollerItem>
							) : null}
						</MessageScrollerContent>
					</MessageScrollerViewport>
					<MessageScrollerButton className="mb-40" />
					<Composer
						projectId={projectId}
						sessionId={sessionId}
						activeRunId={activeRunId}
						disabledReason={disabledReason}
					/>
				</MessageScroller>
			</MessageScrollerProvider>
		</div>
	);
}
