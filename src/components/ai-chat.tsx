import { BrushCleaningIcon } from "lucide-react";
import { Composer } from "#/components/composer";
import {
	Conversation,
	ConversationContent,
	ConversationEmptyState,
} from "./ai-elements/conversation";

export function Chat({ conversationId }: { conversationId: string }) {
	return (
		<div
			className="max-w-3xl mx-auto p-6 relative size-full"
			data-conversation-id={conversationId}
		>
			<div className="flex flex-col h-full">
				<Conversation>
					<ConversationContent>
						<ConversationEmptyState
							icon={<BrushCleaningIcon className="size-12" />}
							title="Ready when you are"
						/>
					</ConversationContent>
				</Conversation>
			</div>
			<Composer />
		</div>
	);
}
