import type {
	AssistantMessagePart,
	StreamToolCall,
} from "#/lib/agent-stream-client";

export type CachedChatMessage = {
	id: string | number;
	role: "user" | "assistant";
	content: string;
	createdAt?: Date | string | number | null;
	model?: string | null;
	tools?: StreamToolCall[];
	parts?: AssistantMessagePart[];
};

const sessionMessages = new Map<string, CachedChatMessage[]>();

function mergeById(
	existing: CachedChatMessage[],
	incoming: CachedChatMessage[],
): CachedChatMessage[] {
	const byId = new Map(
		existing.map((message) => [String(message.id), message]),
	);
	for (const message of incoming) {
		byId.set(String(message.id), message);
	}
	return [...byId.values()];
}

export function seedSessionMessages(
	sessionId: string,
	messages: CachedChatMessage[],
): void {
	const current = sessionMessages.get(sessionId) ?? [];
	sessionMessages.set(sessionId, mergeById(current, messages));
}

export function readSessionMessages(sessionId: string): CachedChatMessage[] {
	return sessionMessages.get(sessionId) ?? [];
}

export function listPendingSessionMessages(
	sessionId: string,
	serverMessages: Array<{ id: string | number }>,
): CachedChatMessage[] {
	const cached = readSessionMessages(sessionId);
	if (cached.length === 0) {
		return [];
	}

	const serverIds = new Set(
		serverMessages.map((message) => String(message.id)),
	);
	return cached.filter((message) => !serverIds.has(String(message.id)));
}
