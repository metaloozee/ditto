import { BrushCleaningIcon } from "lucide-react";
import { Composer } from "#/components/composer";
import {
	Conversation,
	ConversationContent,
	ConversationEmptyState,
} from "./ai-elements/conversation";

type ChatProps = {
	projectId?: string;
	sessionId?: string | null;
	activeRunId?: string | null;
	disabledReason?: string;
};

export function Chat({
	projectId,
	sessionId,
	activeRunId,
	disabledReason,
}: ChatProps) {
	return (
		<div className="relative mx-auto h-full w-full max-w-3xl p-3">
			<div className="flex h-full flex-col">
				<Conversation>
					<ConversationContent>
						<ConversationEmptyState
							icon={<BrushCleaningIcon className="size-12" />}
							title={
								projectId
									? "Ready for workspace instructions"
									: "Ready when you are"
							}
						/>
					</ConversationContent>
				</Conversation>
			</div>
			<Composer
				projectId={projectId}
				sessionId={sessionId}
				activeRunId={activeRunId}
				disabledReason={disabledReason}
			/>
		</div>
	);
}
