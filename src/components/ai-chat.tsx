import { Streamdown } from "streamdown";
import { Composer } from "#/components/composer";
import { Bubble, BubbleContent } from "#/components/ui/bubble";
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
import { cn } from "#/lib/utils";

type ChatMessage = {
	id: string | number;
	role: "user" | "assistant";
	content: string;
	createdAt?: Date | string | number | null;
	model?: string | null;
};

type ChatProps = {
	projectId?: string;
	sessionId?: string | null;
	disabledReason?: string;
	messages?: ChatMessage[];
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

function AssistantMarkdown({
	mode,
	text,
}: {
	mode: "static" | "streaming";
	text: string;
}) {
	return (
		<Streamdown
			className="prose prose-sm max-w-none text-sm/relaxed dark:prose-invert prose-pre:my-3 prose-pre:bg-card prose-code:text-[0.85em]"
			controls={{ code: { copy: true, download: false }, mermaid: false }}
			mode={mode}
			parseIncompleteMarkdown={mode === "streaming"}
		>
			{text}
		</Streamdown>
	);
}

function ChatEmptyState({ hasProject }: { hasProject: boolean }) {
	return (
		<div className="flex min-h-[40vh] flex-col items-center justify-center px-6 text-center">
			<div className="max-w-sm space-y-3">
				<p className="font-medium text-sm">
					{hasProject
						? "Start the first message for this workspace."
						: "Open a project to start chatting."}
				</p>
				<p className="text-balance text-muted-foreground text-xs/relaxed">
					Sent messages are stored in D1 and replayed here as a simple
					conversation history.
				</p>
			</div>
		</div>
	);
}

function MessageRow({ message }: { message: ChatMessage }) {
	const time = formatMessageTime(message.createdAt);

	return (
		<Message align={message.role === "user" ? "end" : "start"}>
			<MessageContent className="group">
				<Bubble
					align={message.role === "user" ? "end" : "start"}
					variant={message.role === "user" ? "default" : "secondary"}
				>
					<BubbleContent
						className="w-full max-w-none"
					>
						{message.role === "assistant" ? (
							<AssistantMarkdown mode="static" text={message.content} />
						) : (
							<p className="whitespace-pre-wrap text-sm/relaxed">
								{message.content}
							</p>
						)}
					</BubbleContent>
				</Bubble>
				<MessageFooter className="opacity-0 group-hover:opacity-100 transition-opacity duration-200">
					{message.role === "assistant" && message.model ? (
						<span>Model: {message.model}</span>
					) : null}
					{time ? <span className="tabular-nums">{time}</span> : null}
				</MessageFooter>
			</MessageContent>
		</Message>
	);
}

function EmptyConversation({ hasProject }: { hasProject: boolean }) {
	return <ChatEmptyState hasProject={hasProject} />;
}

export function Chat({
	projectId,
	sessionId,
	disabledReason,
	messages = [],
}: ChatProps) {
	const hasMessages = messages.length > 0;

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
								"mx-auto gap-4 max-w-2xl",
								!hasMessages && "justify-center",
							)}
						>
							{hasMessages ? (
								messages.map((message, index) => (
									<MessageScrollerItem
										key={message.id}
										messageId={`message-${message.id}`}
										className={cn("mt-0", index === 0 && "mt-20")}
										scrollAnchor={message.role === "user"}
									>
										<MessageRow message={message} />
									</MessageScrollerItem>
								))
							) : (
								<MessageScrollerItem messageId="empty-conversation">
									<EmptyConversation
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
						disabledReason={disabledReason}
					/>
				</MessageScroller>
			</MessageScrollerProvider>
		</div>
	);
}
